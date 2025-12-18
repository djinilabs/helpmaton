import { createHash } from "node:crypto";

import { database } from "../tables";
import { getDefined } from "../utils";

import {
  generateEmbedding,
  getEmbedding,
  hasEmbedding,
  clearWorkspaceCache as clearEmbeddingCache,
} from "./embedding";
import { getDocument, buildS3Key, normalizeFolderPath } from "./s3";

// Default chunk size for splitting documents (~2000 characters for more content)
const DEFAULT_CHUNK_SIZE = 2000;

// Default indexing timeout (5 minutes)
const DEFAULT_INDEXING_TIMEOUT_MS = 5 * 60 * 1000;

// Cache for document content and snippets
// Key format: `${workspaceId}:${documentId}`
// Value: { content: string, snippets: string[], lastModified: number }
interface DocumentCacheEntry {
  content: string;
  snippets: string[];
  lastModified: number;
}
const documentCache = new Map<string, DocumentCacheEntry>();

// Promise-based locking mechanism to prevent concurrent indexing for the same workspace
// Key: workspaceId
// Value: Promise that resolves when indexing is complete
const indexingPromises = new Map<string, Promise<void>>();

/**
 * Generate a hash for a snippet to use as cache key
 */
function hashSnippet(text: string): string {
  return createHash("sha256").update(text).digest("hex").substring(0, 16);
}

/**
 * Get cache key for a document snippet
 */
function getSnippetCacheKey(
  workspaceId: string,
  documentId: string,
  snippetText: string
): string {
  const snippetHash = hashSnippet(snippetText);
  return `${workspaceId}:${documentId}:${snippetHash}`;
}

/**
 * Get cache key for a document
 */
function getDocumentCacheKey(workspaceId: string, documentId: string): string {
  return `${workspaceId}:${documentId}`;
}

/**
 * Clear cache for a specific workspace (optional utility)
 */
export function clearWorkspaceCache(workspaceId: string): void {
  // Clear embedding cache
  clearEmbeddingCache(workspaceId);

  const docKeysToDelete: string[] = [];
  for (const key of Array.from(documentCache.keys())) {
    if (key.startsWith(`${workspaceId}:`)) {
      docKeysToDelete.push(key);
    }
  }
  for (const key of docKeysToDelete) {
    documentCache.delete(key);
  }

  console.log(
    `[documentSearch] Cleared document cache for workspace: ${workspaceId} (${docKeysToDelete.length} documents)`
  );
}

export interface DocumentSnippet {
  text: string;
  documentId: string;
  documentName: string;
  folderPath: string;
}

export interface SearchResult {
  snippet: string;
  documentName: string;
  documentId: string;
  folderPath: string;
  similarity: number;
}

/**
 * Split document content into text snippets
 * Combines multiple paragraphs together to create larger snippets (up to chunkSize)
 * Only splits if a single paragraph exceeds chunkSize
 */
export function splitDocumentIntoSnippets(
  content: string,
  chunkSize: number = DEFAULT_CHUNK_SIZE
): string[] {
  if (!content || content.trim().length === 0) {
    return [];
  }

  const snippets: string[] = [];

  // Split by paragraphs (double newlines or single newline followed by content)
  // This captures both markdown-style paragraphs and regular text paragraphs
  const paragraphs = content
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) {
    // If no paragraphs found, split by character count
    let start = 0;
    while (start < content.length) {
      const end = Math.min(start + chunkSize, content.length);
      const chunk = content.slice(start, end).trim();
      if (chunk.length > 0) {
        snippets.push(chunk);
      }
      start = end;
    }
    return snippets;
  }

  // Combine paragraphs into chunks
  let currentChunk: string[] = [];
  let currentLength = 0;

  for (const paragraph of paragraphs) {
    const paragraphLength = paragraph.length;

    // If a single paragraph exceeds chunkSize, split it first
    if (paragraphLength > chunkSize) {
      // Save current chunk if it has content
      if (currentChunk.length > 0) {
        snippets.push(currentChunk.join("\n\n"));
        currentChunk = [];
        currentLength = 0;
      }

      // Split the large paragraph
      let start = 0;
      while (start < paragraphLength) {
        let end = start + chunkSize;

        // Try to break at sentence boundaries if possible
        if (end < paragraphLength) {
          const lastPeriod = paragraph.lastIndexOf(".", end);
          const lastNewline = paragraph.lastIndexOf("\n", end);
          const breakPoint = Math.max(lastPeriod, lastNewline);

          if (breakPoint > start + chunkSize * 0.5) {
            // Use sentence/line break if it's not too early
            end = breakPoint + 1;
          }
        }

        const chunk = paragraph.slice(start, end).trim();
        if (chunk.length > 0) {
          snippets.push(chunk);
        }
        start = end;
      }
      continue;
    }

    // Check if adding this paragraph would exceed chunkSize
    const separatorLength = currentChunk.length > 0 ? 2 : 0; // "\n\n" separator
    if (
      currentLength + separatorLength + paragraphLength > chunkSize &&
      currentChunk.length > 0
    ) {
      // Save current chunk and start a new one
      snippets.push(currentChunk.join("\n\n"));
      currentChunk = [paragraph];
      currentLength = paragraphLength;
    } else {
      // Add paragraph to current chunk
      currentChunk.push(paragraph);
      currentLength += separatorLength + paragraphLength;
    }
  }

  // Add the last chunk if it has content
  if (currentChunk.length > 0) {
    snippets.push(currentChunk.join("\n\n"));
  }

  return snippets.filter((s) => s.length > 0);
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error("Vectors must have the same length");
  }

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    magnitudeA += vecA[i] * vecA[i];
    magnitudeB += vecB[i] * vecB[i];
  }

  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Search documents in a workspace using vector similarity
 * Uses promise-based locking to ensure only one indexing operation per workspace at a time
 */
export async function searchDocuments(
  workspaceId: string,
  query: string,
  topN: number = 5
): Promise<SearchResult[]> {
  if (!query || query.trim().length === 0) {
    return [];
  }

  // Check if indexing is already in progress for this workspace
  const existingIndexingPromise = indexingPromises.get(workspaceId);
  if (existingIndexingPromise) {
    await existingIndexingPromise;
  }

  const apiKey = getDefined(
    process.env.GEMINI_API_KEY,
    "GEMINI_API_KEY is not set"
  );

  // Get database instance
  const db = await database();

  // Query all documents for this workspace
  const documents = await db["workspace-document"].query({
    IndexName: "byWorkspaceId",
    KeyConditionExpression: "workspaceId = :workspaceId",
    ExpressionAttributeValues: {
      ":workspaceId": workspaceId,
    },
  });

  if (documents.items.length === 0) {
    return [];
  }

  // Generate embedding for the query
  let queryEmbedding: number[];
  try {
    queryEmbedding = await generateEmbedding(
      query.trim(),
      apiKey,
      undefined,
      undefined
    );
  } catch (error) {
    console.error(
      "[searchDocuments] Failed to generate query embedding:",
      error
    );
    throw error;
  }

  // Check if we need to do indexing (if no indexing promise exists)
  if (!indexingPromises.has(workspaceId)) {
    // Get timeout from environment variable or use default
    const timeoutMs = process.env.INDEXING_TIMEOUT_MS
      ? parseInt(process.env.INDEXING_TIMEOUT_MS, 10)
      : DEFAULT_INDEXING_TIMEOUT_MS;

    // Start indexing with promise-based locking
    const indexingPromise = (async () => {
      try {
        await performIndexing(
          workspaceId,
          documents.items as Array<{
            pk: string;
            name: string;
            filename: string;
            s3Key: string;
            folderPath: string;
          }>,
          apiKey,
          timeoutMs
        );
      } catch (error) {
        console.error(`[searchDocuments] Error during indexing:`, error);
        throw error;
      } finally {
        // Remove the promise from the map when done
        indexingPromises.delete(workspaceId);
      }
    })();

    // Store the promise so other requests can wait for it
    indexingPromises.set(workspaceId, indexingPromise);

    // Wait for indexing to complete
    await indexingPromise;
  }

  // Now perform the search using cached embeddings
  return performSearch(workspaceId, query, queryEmbedding, topN);
}

/**
 * Perform indexing: fetch documents, split into snippets, generate embeddings
 * This is the actual work that needs to be synchronized per workspace
 * Implements parallel embedding generation with global timeout
 */
async function performIndexing(
  workspaceId: string,
  documents: Array<{
    pk: string;
    name: string;
    filename: string;
    s3Key: string;
    folderPath: string;
  }>,
  apiKey: string,
  timeoutMs: number
): Promise<void> {
  // Create AbortController for global timeout
  const abortController = new AbortController();
  const signal = abortController.signal;

  // Set up timeout
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, timeoutMs);

  // Track which documents/snippets were not processed due to timeout
  const unprocessedDocuments: string[] = [];
  const unprocessedSnippets: Array<{
    documentName: string;
    snippetIndex: number;
  }> = [];

  try {
    // Process all documents: fetch content, split into snippets
    const documentSnippets: Array<{
      documentId: string;
      documentName: string;
      snippetText: string;
      snippetCacheKey: string;
      snippetIndex: number;
    }> = [];

    for (let docIndex = 0; docIndex < documents.length; docIndex++) {
      // Check if aborted
      if (signal.aborted) {
        break;
      }

      const doc = documents[docIndex];

      try {
        // Extract document ID from primary key
        const documentId = doc.pk.replace(
          `workspace-documents/${workspaceId}/`,
          ""
        );

        // Check document cache first
        const docCacheKey = getDocumentCacheKey(workspaceId, documentId);
        const cachedDoc = documentCache.get(docCacheKey);
        let contentText: string;
        let snippets: string[];

        if (cachedDoc) {
          contentText = cachedDoc.content;
          snippets = cachedDoc.snippets;
        } else {
          // Validate s3Key exists
          if (!doc.s3Key || doc.s3Key.trim().length === 0) {
            console.error(
              `[performIndexing] Document ${doc.name} has no s3Key, skipping`
            );
            continue;
          }

          // Fetch document content from S3
          let content: Buffer;
          try {
            content = await getDocument(workspaceId, documentId, doc.s3Key);
          } catch (error) {
            console.error(
              `[performIndexing] Failed to fetch document ${doc.name} from S3:`,
              error
            );
            if (error instanceof Error && "Key" in error) {
              const attemptedKey = (error as { Key?: string }).Key;
              console.error(
                `[performIndexing] Attempted S3 key: ${attemptedKey}`
              );
              console.error(
                `[performIndexing] Document s3Key in database: ${doc.s3Key}`
              );
              console.error(
                `[performIndexing] Document filename: ${doc.filename}`
              );
              console.error(
                `[performIndexing] Document folderPath: ${doc.folderPath}`
              );

              // Try to reconstruct the S3 key using buildS3Key as a fallback
              // This matches exactly how uploadDocument constructs the key
              if (doc.filename) {
                // Normalize folder path the same way uploadDocument does
                const normalizedPath = normalizeFolderPath(
                  doc.folderPath || ""
                );
                const reconstructedKey = buildS3Key(
                  workspaceId,
                  normalizedPath,
                  doc.filename
                );

                if (reconstructedKey !== doc.s3Key) {
                  try {
                    content = await getDocument(
                      workspaceId,
                      documentId,
                      reconstructedKey
                    );
                  } catch (reconstructError) {
                    console.error(
                      `[performIndexing] Reconstructed key also failed:`,
                      reconstructError
                    );
                    // Continue with other documents
                    continue;
                  }
                } else {
                  // Keys match, so the issue is the file doesn't exist
                  console.error(
                    `[performIndexing] Reconstructed key matches stored key, file likely doesn't exist in S3`
                  );
                  continue;
                }
              } else {
                // No filename to reconstruct with
                continue;
              }
            } else {
              // Unknown error, continue with other documents
              continue;
            }
          }

          // Only reach here if content was successfully fetched
          contentText = content.toString("utf-8");

          // Split document into snippets
          snippets = splitDocumentIntoSnippets(contentText);

          // Cache the document content and snippets
          documentCache.set(docCacheKey, {
            content: contentText,
            snippets,
            lastModified: Date.now(),
          });
        }

        // Collect all snippets that need embeddings
        for (
          let snippetIndex = 0;
          snippetIndex < snippets.length;
          snippetIndex++
        ) {
          // Check if aborted
          if (signal.aborted) {
            break;
          }

          const snippetText = snippets[snippetIndex];
          const snippetCacheKey = getSnippetCacheKey(
            workspaceId,
            documentId,
            snippetText
          );

          // Skip if embedding is already cached
          if (hasEmbedding(snippetCacheKey)) {
            continue;
          }

          documentSnippets.push({
            documentId,
            documentName: doc.name,
            snippetText,
            snippetCacheKey,
            snippetIndex,
          });
        }
      } catch (error) {
        console.error(
          `[performIndexing] Failed to process document ${doc.name}:`,
          error
        );
        unprocessedDocuments.push(doc.name);
        // Continue with other documents
      }
    }

    // Check if aborted before starting parallel embedding generation
    if (signal.aborted) {
      throw new Error(
        `Indexing timeout reached (${timeoutMs}ms). Processed ${documentSnippets.length} snippets before timeout.`
      );
    }

    // Generate embeddings in parallel using Promise.allSettled
    const embeddingPromises = documentSnippets.map(
      async ({ documentName, snippetText, snippetCacheKey, snippetIndex }) => {
        // Check if aborted before each embedding generation
        if (signal.aborted) {
          unprocessedSnippets.push({ documentName, snippetIndex });
          throw new Error("Operation aborted");
        }

        try {
          // Log snippet when calculating embedding
          const snippetPreview =
            snippetText.length > 200
              ? snippetText.substring(0, 200) + "..."
              : snippetText;
          console.log(
            `[performIndexing] Calculating embedding for snippet from "${documentName}": "${snippetPreview}"`
          );

          // Generate embedding (result not used, but generation has side effects like caching)
          // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Embedding generation has side effects
          const embedding = await generateEmbedding(
            snippetText,
            apiKey,
            snippetCacheKey,
            signal
          );
          return { success: true, documentName, snippetIndex };
        } catch (error) {
          // Check if it's an abort error
          if (error instanceof Error && error.message === "Operation aborted") {
            unprocessedSnippets.push({ documentName, snippetIndex });
            throw error;
          }

          console.error(
            `[performIndexing] Failed to generate embedding for snippet ${
              snippetIndex + 1
            } in document ${documentName}:`,
            error
          );
          unprocessedSnippets.push({ documentName, snippetIndex });
          return { success: false, documentName, snippetIndex, error };
        }
      }
    );

    // Wait for all embeddings to complete (or fail)
    const results = await Promise.allSettled(embeddingPromises);

    // Check if we were aborted during execution
    if (signal.aborted) {
      const successful = results.filter(
        (r) => r.status === "fulfilled" && r.value.success === true
      ).length;
      const failed = results.length - successful;
      console.error(
        `[performIndexing] Indexing aborted. Successfully processed ${successful} embeddings, ${failed} failed or aborted.`
      );
      if (unprocessedDocuments.length > 0) {
        console.error(
          `[performIndexing] Unprocessed documents: ${unprocessedDocuments.join(
            ", "
          )}`
        );
      }
      if (unprocessedSnippets.length > 0) {
        console.error(
          `[performIndexing] Unprocessed snippets: ${unprocessedSnippets.length} from various documents`
        );
      }
      throw new Error(
        `Indexing timeout reached (${timeoutMs}ms). Successfully processed ${successful} embeddings before timeout.`
      );
    }
  } catch (error) {
    // If it's an abort error, provide more context
    if (error instanceof Error && error.message === "Operation aborted") {
      throw new Error(
        `Indexing timeout reached (${timeoutMs}ms) for workspace: ${workspaceId}`
      );
    }
    throw error;
  } finally {
    // Clear timeout
    clearTimeout(timeoutId);
  }
}

/**
 * Perform the actual search using cached embeddings
 */
async function performSearch(
  workspaceId: string,
  query: string,
  queryEmbedding: number[],
  topN: number
): Promise<SearchResult[]> {
  // Get all cached embeddings for this workspace
  const snippetEmbeddings: Array<{
    snippet: DocumentSnippet;
    embedding: number[];
  }> = [];

  // Get database instance to find documents
  const db = await database();
  const documents = await db["workspace-document"].query({
    IndexName: "byWorkspaceId",
    KeyConditionExpression: "workspaceId = :workspaceId",
    ExpressionAttributeValues: {
      ":workspaceId": workspaceId,
    },
  });

  // Reconstruct embeddings from cache
  for (const doc of documents.items) {
    const documentId = doc.pk.replace(
      `workspace-documents/${workspaceId}/`,
      ""
    );
    const docCacheKey = getDocumentCacheKey(workspaceId, documentId);
    const cachedDoc = documentCache.get(docCacheKey);

    if (cachedDoc) {
      for (const snippetText of cachedDoc.snippets) {
        const snippetCacheKey = getSnippetCacheKey(
          workspaceId,
          documentId,
          snippetText
        );
        const embedding = getEmbedding(snippetCacheKey);

        if (embedding) {
          snippetEmbeddings.push({
            snippet: {
              text: snippetText,
              documentId,
              documentName: doc.name,
              folderPath: doc.folderPath,
            },
            embedding,
          });
        }
      }
    }
  }

  if (snippetEmbeddings.length === 0) {
    return [];
  }

  // Calculate similarity scores
  const results: SearchResult[] = snippetEmbeddings.map(
    ({ snippet, embedding }) => {
      const similarity = cosineSimilarity(queryEmbedding, embedding);
      return {
        snippet: snippet.text,
        documentName: snippet.documentName,
        documentId: snippet.documentId,
        folderPath: snippet.folderPath,
        similarity,
      };
    }
  );

  // Sort by similarity (descending) and return top N
  results.sort((a, b) => b.similarity - a.similarity);
  const topResults = results.slice(0, topN);

  return topResults;
}
