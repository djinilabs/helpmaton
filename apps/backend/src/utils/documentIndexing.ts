import { splitDocumentIntoSnippets } from "./documentSearch";
import { getDocument } from "./s3";
import { MAX_QUERY_LIMIT } from "./vectordb/config";
import { sendWriteOperation } from "./vectordb/queueClient";
import { query } from "./vectordb/readClient";
import type { RawFactData } from "./vectordb/types";

/**
 * Maximum number of snippets allowed per document
 * This prevents documents from exceeding query limits and ensures complete deletion
 * With default chunk size of 1000 characters, this allows ~10MB documents
 */
export const MAX_DOCUMENT_SNIPPETS = 10000;

/**
 * Index a document by splitting it into snippets and queuing them for embedding generation
 * @param workspaceId - Workspace ID (used as agentId for docs grain)
 * @param documentId - Document ID
 * @param content - Document content (text)
 * @param metadata - Document metadata (name, folderPath)
 */
export async function indexDocument(
  workspaceId: string,
  documentId: string,
  content: string,
  metadata: {
    documentName: string;
    folderPath: string;
  }
): Promise<void> {
  // Split document into snippets
  const snippets = splitDocumentIntoSnippets(content);

  if (snippets.length === 0) {
    console.log(
      `[Document Indexing] No snippets to index for document ${documentId}`
    );
    return;
  }

  // Validate document size - reject documents that would exceed deletion limit
  if (snippets.length > MAX_DOCUMENT_SNIPPETS) {
    const error = new Error(
      `Document "${metadata.documentName}" exceeds maximum size limit. Document has ${snippets.length} snippets, but maximum allowed is ${MAX_DOCUMENT_SNIPPETS}. Please split the document into smaller files.`
    );
    console.error(
      `[Document Indexing] Document size validation failed for ${documentId}:`,
      error.message
    );
    throw error;
  }

  // Create raw fact data (without embeddings) to queue for async processing
  const rawFacts: RawFactData[] = [];

  for (let snippetIndex = 0; snippetIndex < snippets.length; snippetIndex++) {
    const snippetText = snippets[snippetIndex];
    const snippetId = `${documentId}:${snippetIndex}`;

    const rawFact: RawFactData = {
      id: snippetId,
      content: snippetText,
      timestamp: new Date().toISOString(),
      metadata: {
        documentId,
        documentName: metadata.documentName,
        folderPath: metadata.folderPath,
        workspaceId,
      },
      // Cache key format: workspaceId:documentId:snippetHash
      // We don't need to hash the snippet here since the queue handler will handle it
    };

    rawFacts.push(rawFact);
  }

  // Log all content and metadata for each snippet
  console.log(
    `[Document Indexing] Document split into ${rawFacts.length} snippets for document ${documentId}:`
  );
  rawFacts.forEach((fact, index) => {
    console.log(
      `[Document Indexing] Snippet ${index + 1}/${rawFacts.length}:`,
      {
        id: fact.id,
        content: fact.content,
        timestamp: fact.timestamp,
        metadata: fact.metadata,
        contentLength: fact.content.length,
      }
    );
  });

  // Queue write operation to SQS with raw facts (embeddings will be generated async)
  console.log(
    `[Document Indexing] Queuing ${rawFacts.length} snippets to SQS for document ${documentId} in workspace ${workspaceId}`
  );
  await sendWriteOperation({
    operation: "insert",
    agentId: workspaceId, // For docs grain, workspaceId is used as agentId
    temporalGrain: "docs",
    workspaceId, // Include workspaceId for API key lookup in queue handler
    data: {
      rawFacts,
    },
  });

  console.log(
    `[Document Indexing] Successfully queued ${rawFacts.length} snippets for document ${documentId}`
  );
}

/**
 * Create a dummy vector for querying LanceDB
 * LanceDB requires a vector for queries, so we use a dummy vector with small random values
 * This ensures we get results (zero vector might return no results)
 */
function createDummyVector(dimension: number = 768): number[] {
  return new Array(dimension).fill(0).map(() => Math.random() * 0.01);
}

/**
 * Query all snippets in a workspace and filter by documentId in memory
 * Since LanceDB filters don't work reliably (schema issues), we query all documents
 * and filter by documentId in memory. Each workspace has its own isolated database.
 */
async function querySnippetsByDocumentId(
  workspaceId: string,
  documentId: string,
  dummyVector: number[],
  limit: number
): Promise<string[]> {
  const results = await query(workspaceId, "docs", {
    vector: dummyVector,
    limit,
  });

  // Filter results by documentId in memory
  return results
    .filter((result) => result.metadata?.documentId === documentId)
    .map((result) => result.id);
}

/**
 * Delete all snippets for a document from the vector database
 *
 * Since LanceDB filters don't work reliably (schema issues), we query all documents
 * and filter by documentId in memory. Each workspace has its own isolated database.
 *
 * Algorithm:
 * 1. Query snippets in batches of MAX_QUERY_LIMIT
 * 2. Delete each batch immediately after collecting it
 * 3. Continue querying until no new IDs are found
 *
 * This ensures subsequent queries return different results, allowing us to collect
 * all snippets even when there are more than MAX_QUERY_LIMIT snippets.
 *
 * @param workspaceId - Workspace ID (used as agentId for docs grain)
 * @param documentId - Document ID
 */
export async function deleteDocumentSnippets(
  workspaceId: string,
  documentId: string
): Promise<void> {
  try {
    const dummyVector = createDummyVector();
    const seenIds = new Set<string>();
    const maxBatches = Math.ceil(MAX_DOCUMENT_SNIPPETS / MAX_QUERY_LIMIT);
    let totalDeleted = 0;

    // Query and delete snippets in batches
    // Delete each batch immediately so subsequent queries (after async processing) return different results
    // Continue querying all batches to ensure we collect all IDs, even if deletions are still processing
    for (let batchNumber = 0; batchNumber < maxBatches; batchNumber++) {
      const snippetIds = await querySnippetsByDocumentId(
        workspaceId,
        documentId,
        dummyVector,
        MAX_QUERY_LIMIT
      );

      // Filter out IDs we've already seen and queued for deletion
      const newIds = snippetIds.filter((id) => !seenIds.has(id));

      // Mark all IDs from this query as seen (even duplicates) to avoid re-processing
      snippetIds.forEach((id) => seenIds.add(id));

      // Delete new IDs immediately (async via SQS)
      // Even if deletions haven't processed yet, we continue querying all batches
      // to ensure we collect all IDs that exist at query time
      if (newIds.length > 0) {
        // SQS message size limit is 256KB. With IDs like "doc-123:0" (~10-15 chars each),
        // we can fit ~17,000 IDs in a single message, which is well above MAX_QUERY_LIMIT
        await sendWriteOperation({
          operation: "delete",
          agentId: workspaceId, // For docs grain, workspaceId is used as agentId
          temporalGrain: "docs",
          workspaceId, // Include workspaceId for message group ID
          data: {
            recordIds: newIds,
          },
        });

        totalDeleted += newIds.length;
      }

      // If we got fewer results than the limit, we've likely found all snippets
      // Query one more time to handle edge case of exactly MAX_QUERY_LIMIT remaining
      if (snippetIds.length < MAX_QUERY_LIMIT) {
        const finalSnippetIds = await querySnippetsByDocumentId(
          workspaceId,
          documentId,
          dummyVector,
          MAX_QUERY_LIMIT
        );
        const finalNewIds = finalSnippetIds.filter((id) => !seenIds.has(id));
        if (finalNewIds.length > 0) {
          finalSnippetIds.forEach((id) => seenIds.add(id));
          await sendWriteOperation({
            operation: "delete",
            agentId: workspaceId,
            temporalGrain: "docs",
            workspaceId,
            data: {
              recordIds: finalNewIds,
            },
          });
          totalDeleted += finalNewIds.length;
        }
        break;
      }
    }

    if (totalDeleted > 0) {
      console.log(
        `[Document Indexing] Deleted ${totalDeleted} snippets for document ${documentId}`
      );
    }
  } catch (error) {
    // Log error but don't throw - deletion should not block document operations
    console.error(
      `[Document Indexing] Failed to delete snippets for document ${documentId}:`,
      error instanceof Error ? error.message : String(error)
    );
    // Don't throw - allow document deletion to proceed even if vector DB deletion fails
  }
}

/**
 * Update a document by deleting old snippets and indexing new content
 * @param workspaceId - Workspace ID (used as agentId for docs grain)
 * @param documentId - Document ID
 * @param content - New document content (text)
 * @param metadata - Document metadata (name, folderPath)
 */
export async function updateDocument(
  workspaceId: string,
  documentId: string,
  content: string,
  metadata: {
    documentName: string;
    folderPath: string;
  }
): Promise<void> {
  // First delete old snippets
  await deleteDocumentSnippets(workspaceId, documentId);

  // Then index new content
  await indexDocument(workspaceId, documentId, content, metadata);
}

/**
 * Index a document from S3 by fetching content and indexing it
 * @param workspaceId - Workspace ID (used as agentId for docs grain)
 * @param documentId - Document ID
 * @param s3Key - S3 key for the document
 * @param metadata - Document metadata (name, folderPath)
 */
export async function indexDocumentFromS3(
  workspaceId: string,
  documentId: string,
  s3Key: string,
  metadata: {
    documentName: string;
    folderPath: string;
  }
): Promise<void> {
  try {
    // Fetch document content from S3
    const contentBuffer = await getDocument(workspaceId, documentId, s3Key);
    const content = contentBuffer.toString("utf-8");

    // Index the document
    await indexDocument(workspaceId, documentId, content, metadata);
  } catch (error) {
    // Log error but don't throw - indexing should not block document operations
    console.error(
      `[Document Indexing] Failed to index document ${documentId} from S3:`,
      error instanceof Error
        ? {
            message: error.message,
            stack: error.stack,
            name: error.name,
          }
        : String(error)
    );
    // Don't throw - allow document operations to proceed even if indexing fails
  }
}
