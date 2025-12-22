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

  // Log summary information (without exposing document content)
  const totalContentLength = rawFacts.reduce(
    (sum, fact) => sum + fact.content.length,
    0
  );
  console.log(
    `[Document Indexing] Document split into ${rawFacts.length} snippets for document ${documentId} (total content length: ${totalContentLength} characters)`
  );

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
 * Query all snippets for a specific document from the vector database
 * Uses filter-based query (without vector similarity) to find all snippets matching documentId.
 * Falls back to scanning all records if filter doesn't work.
 *
 * @param workspaceId - Workspace ID (used as agentId for docs grain)
 * @param documentId - Document ID to filter by
 * @param limit - Maximum number of results to return per query
 * @returns Array of snippet IDs matching the documentId
 */
async function querySnippetsByDocumentId(
  workspaceId: string,
  documentId: string,
  limit: number
): Promise<string[]> {
  try {
    // First, try using a filter without vector similarity search
    // This is the most efficient approach if filters work correctly
    const results = await query(workspaceId, "docs", {
      filter: `documentId = '${documentId.replace(/'/g, "''")}'`, // Escape single quotes in documentId
      limit,
    });

    // Filter results by documentId in memory as a safety check
    // (in case the filter didn't work correctly)
    return results
      .filter((result) => result.metadata?.documentId === documentId)
      .map((result) => result.id);
  } catch (filterError) {
    // If filter-based query fails, fall back to scanning all records without vector similarity
    console.warn(
      `[Document Indexing] Filter-based query failed for document ${documentId}, falling back to full scan:`,
      filterError instanceof Error ? filterError.message : String(filterError)
    );

    // Query all records without vector similarity (no vector, no filter)
    // This returns records in an arbitrary order, but we can filter by documentId in memory
    const results = await query(workspaceId, "docs", {
      limit,
    });

    // Filter results by documentId in memory
    return results
      .filter((result) => result.metadata?.documentId === documentId)
      .map((result) => result.id);
  }
}

/**
 * Delete all snippets for a document from the vector database
 *
 * Uses filter-based queries (without vector similarity) to find all snippets matching documentId.
 * Queries in batches until no more snippets are found, ensuring complete deletion even when
 * there are more than MAX_QUERY_LIMIT snippets.
 *
 * Algorithm:
 * 1. Query snippets matching documentId in batches of MAX_QUERY_LIMIT
 * 2. Delete each batch immediately after collecting it
 * 3. Continue querying until no new IDs are found
 *
 * This approach queries without vector similarity, so it's not limited to the K nearest neighbors
 * and can find all snippets regardless of workspace size.
 *
 * @param workspaceId - Workspace ID (used as agentId for docs grain)
 * @param documentId - Document ID
 * @param throwOnError - If true, throw errors instead of swallowing them. Defaults to false.
 *                       Use true for updates (to prevent duplicates), false for deletions (orphaned snippets are acceptable).
 */
export async function deleteDocumentSnippets(
  workspaceId: string,
  documentId: string,
  throwOnError: boolean = false
): Promise<void> {
  try {
    const seenIds = new Set<string>();
    const maxBatches = Math.ceil(MAX_DOCUMENT_SNIPPETS / MAX_QUERY_LIMIT);
    let totalDeleted = 0;
    let consecutiveEmptyBatches = 0;
    const MAX_CONSECUTIVE_EMPTY = 2; // Stop after 2 consecutive empty batches

    // Query and delete snippets in batches
    // Continue until we've checked all possible batches or get consecutive empty results
    for (let batchNumber = 0; batchNumber < maxBatches; batchNumber++) {
      const snippetIds = await querySnippetsByDocumentId(
        workspaceId,
        documentId,
        MAX_QUERY_LIMIT
      );

      // Filter out IDs we've already seen and queued for deletion
      const newIds = snippetIds.filter((id) => !seenIds.has(id));

      // Mark all IDs from this query as seen (even duplicates) to avoid re-processing
      snippetIds.forEach((id) => seenIds.add(id));

      // Delete new IDs immediately (async via SQS)
      if (newIds.length > 0) {
        consecutiveEmptyBatches = 0; // Reset counter when we find new IDs
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
        console.log(
          `[Document Indexing] Batch ${batchNumber + 1}: Found ${
            newIds.length
          } new snippets to delete (${totalDeleted} total)`
        );
      } else {
        consecutiveEmptyBatches++;
        // If we get consecutive empty batches, we've likely found all snippets
        // This handles the case where filter-based queries return results in a consistent order
        if (consecutiveEmptyBatches >= MAX_CONSECUTIVE_EMPTY) {
          console.log(
            `[Document Indexing] Stopping after ${consecutiveEmptyBatches} consecutive empty batches`
          );
          break;
        }
      }

      // If we got fewer results than the limit, we've likely found all snippets
      // But continue for one more batch to handle edge cases
      if (snippetIds.length < MAX_QUERY_LIMIT) {
        // Query one more time to handle edge case of exactly MAX_QUERY_LIMIT remaining
        const finalSnippetIds = await querySnippetsByDocumentId(
          workspaceId,
          documentId,
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
          console.log(
            `[Document Indexing] Final batch: Found ${finalNewIds.length} additional snippets (${totalDeleted} total)`
          );
        }
        break;
      }
    }

    if (totalDeleted > 0) {
      console.log(
        `[Document Indexing] Successfully deleted ${totalDeleted} snippets for document ${documentId}`
      );
    } else {
      console.log(
        `[Document Indexing] No snippets found to delete for document ${documentId}`
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `[Document Indexing] Failed to delete snippets for document ${documentId}:`,
      errorMessage
    );

    // For updates, throw errors to prevent duplicate snippets
    // For deletions, swallow errors (orphaned snippets are acceptable)
    if (throwOnError) {
      throw error;
    }
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
  // Throw on error to prevent duplicate snippets (old + new) in the index
  await deleteDocumentSnippets(workspaceId, documentId, true);

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
