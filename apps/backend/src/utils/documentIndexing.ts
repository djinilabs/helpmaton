import { splitDocumentIntoSnippets } from "./documentSearch";
import { getDocument } from "./s3";
import { sendWriteOperation } from "./vectordb/queueClient";
import { query } from "./vectordb/readClient";
import type { RawFactData } from "./vectordb/types";

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

  // Create raw fact data (without embeddings) to queue for async processing
  const rawFacts: RawFactData[] = [];

  for (let snippetIndex = 0; snippetIndex < snippets.length; snippetIndex++) {
    const snippetText = snippets[snippetIndex];
    const snippetId = `${documentId}:${snippetIndex}`;

    rawFacts.push({
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
    });
  }

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
 * Delete all snippets for a document from the vector database
 * First queries LanceDB to find all snippet IDs, then sends delete operation
 * @param workspaceId - Workspace ID (used as agentId for docs grain)
 * @param documentId - Document ID
 */
export async function deleteDocumentSnippets(
  workspaceId: string,
  documentId: string
): Promise<void> {
  try {
    // Query LanceDB to find all snippets for this document
    // Use a filter to find all records with matching documentId in metadata
    const results = await query(workspaceId, "docs", {
      filter: `documentId = '${documentId}'`,
      limit: 10000, // Large limit to get all snippets (documents shouldn't have more than this)
    });

    if (results.length === 0) {
      console.log(
        `[Document Indexing] No snippets found to delete for document ${documentId}`
      );
      return;
    }

    // Extract record IDs from query results
    const recordIds = results.map((result) => result.id);

    console.log(
      `[Document Indexing] Found ${recordIds.length} snippets to delete for document ${documentId}`
    );

    // Send delete operation to queue
    await sendWriteOperation({
      operation: "delete",
      agentId: workspaceId, // For docs grain, workspaceId is used as agentId
      temporalGrain: "docs",
      workspaceId, // Include workspaceId for message group ID
      data: {
        recordIds,
      },
    });

    console.log(
      `[Document Indexing] Successfully queued deletion of ${recordIds.length} snippets for document ${documentId}`
    );
  } catch (error) {
    // Log error but don't throw - deletion should not block document operations
    console.error(
      `[Document Indexing] Failed to delete snippets for document ${documentId}:`,
      error instanceof Error
        ? {
            message: error.message,
            stack: error.stack,
            name: error.name,
          }
        : String(error)
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
