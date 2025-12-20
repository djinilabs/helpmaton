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
 * Escape a string value for use in LanceDB SQL filter expressions
 * Escapes single quotes by doubling them (SQL standard)
 * @param value - String value to escape
 * @returns Escaped string safe for use in SQL filter
 */
function escapeSqlString(value: string): string {
  // Escape single quotes by doubling them (SQL standard)
  // This prevents SQL injection in filter expressions
  return value.replace(/'/g, "''");
}

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
 * Uses iterative query-and-delete to handle documents with more snippets than the query limit
 *
 * Since LanceDB doesn't support offset-based pagination, we use an iterative approach:
 * 1. Query a batch of snippets (up to MAX_QUERY_LIMIT)
 * 2. Delete that batch via queue
 * 3. Query again - deleted snippets won't appear once deletion completes
 * 4. Repeat until no more snippets are found
 *
 * We track seen IDs to avoid duplicate deletions in case queries return
 * the same results before deletions complete (since deletions are async via queue).
 *
 * Maximum document size is enforced during indexing (MAX_DOCUMENT_SNIPPETS),
 * so this should handle at most ~10 batches (10,000 snippets / 1,000 limit).
 *
 * @param workspaceId - Workspace ID (used as agentId for docs grain)
 * @param documentId - Document ID
 */
export async function deleteDocumentSnippets(
  workspaceId: string,
  documentId: string
): Promise<void> {
  try {
    // Escape documentId to prevent SQL injection
    const escapedDocumentId = escapeSqlString(documentId);
    const filter = `documentId = '${escapedDocumentId}'`;

    const allRecordIds: string[] = [];
    const seenIds = new Set<string>();
    let batchNumber = 0;
    const maxBatches = Math.ceil(MAX_DOCUMENT_SNIPPETS / MAX_QUERY_LIMIT); // Safety limit

    // Collect all snippet IDs by querying in batches
    // Since LanceDB doesn't support offset pagination, we query repeatedly
    // and track seen IDs to avoid duplicates
    while (batchNumber < maxBatches) {
      const results = await query(workspaceId, "docs", {
        filter,
        limit: MAX_QUERY_LIMIT,
      });

      if (results.length === 0) {
        // No more snippets found
        break;
      }

      // Filter out IDs we've already seen
      const newIds = results
        .map((result) => result.id)
        .filter((id) => !seenIds.has(id));

      if (newIds.length === 0) {
        // All results were duplicates - deletions may still be processing
        // Wait a bit and try one more time
        await new Promise((resolve) => setTimeout(resolve, 500));
        const retryResults = await query(workspaceId, "docs", {
          filter,
          limit: MAX_QUERY_LIMIT,
        });
        const retryNewIds = retryResults
          .map((result) => result.id)
          .filter((id) => !seenIds.has(id));
        if (retryNewIds.length === 0) {
          // Still no new IDs, we're done
          break;
        }
        // Found new IDs in retry, add them
        retryNewIds.forEach((id) => {
          seenIds.add(id);
          allRecordIds.push(id);
        });
        break;
      }

      // Add new IDs to our collection
      newIds.forEach((id) => {
        seenIds.add(id);
        allRecordIds.push(id);
      });

      batchNumber++;

      // If we got fewer results than the limit, we've likely collected all snippets
      // Query one more time to be absolutely sure (handles edge case of exactly MAX_QUERY_LIMIT remaining)
      if (results.length < MAX_QUERY_LIMIT) {
        const finalResults = await query(workspaceId, "docs", {
          filter,
          limit: MAX_QUERY_LIMIT,
        });
        const finalNewIds = finalResults
          .map((result) => result.id)
          .filter((id) => !seenIds.has(id));
        if (finalNewIds.length > 0) {
          finalNewIds.forEach((id) => {
            seenIds.add(id);
            allRecordIds.push(id);
          });
        }
        break;
      }
    }

    if (allRecordIds.length === 0) {
      console.log(
        `[Document Indexing] No snippets found to delete for document ${documentId}`
      );
      return;
    }

    if (batchNumber >= maxBatches) {
      console.warn(
        `[Document Indexing] Reached maximum batch limit (${maxBatches}) while collecting snippet IDs for document ${documentId}. Collected ${allRecordIds.length} IDs, but there may be more. This should not happen if document size validation (MAX_DOCUMENT_SNIPPETS=${MAX_DOCUMENT_SNIPPETS}) is working correctly.`
      );
    }

    console.log(
      `[Document Indexing] Found ${
        allRecordIds.length
      } snippets to delete for document ${documentId}${
        batchNumber > 1
          ? ` (collected across ${batchNumber} query batches)`
          : ""
      }`
    );

    // Send single delete operation with all collected record IDs
    // SQS message size limit is 256KB. With IDs like "doc-123:0" (~10-15 chars each),
    // we can fit ~17,000 IDs in a single message, which is well above MAX_DOCUMENT_SNIPPETS
    await sendWriteOperation({
      operation: "delete",
      agentId: workspaceId, // For docs grain, workspaceId is used as agentId
      temporalGrain: "docs",
      workspaceId, // Include workspaceId for message group ID
      data: {
        recordIds: allRecordIds,
      },
    });

    console.log(
      `[Document Indexing] Successfully queued deletion of ${allRecordIds.length} snippets for document ${documentId}`
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
