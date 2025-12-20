import { getDefined } from "../utils";

import { generateEmbedding } from "./embedding";
import { query } from "./vectordb/readClient";

// Default chunk size for splitting documents (~2000 characters for more content)
const DEFAULT_CHUNK_SIZE = 2000;

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
 * Search documents in a workspace using vector similarity with LanceDB
 */
export async function searchDocuments(
  workspaceId: string,
  queryText: string,
  topN: number = 5
): Promise<SearchResult[]> {
  if (!queryText || queryText.trim().length === 0) {
    return [];
  }

  const apiKey = getDefined(
    process.env.GEMINI_API_KEY,
    "GEMINI_API_KEY is not set"
  );

  // Generate embedding for the query
  let queryEmbedding: number[];
  try {
    queryEmbedding = await generateEmbedding(
      queryText.trim(),
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

  // Query LanceDB for document snippets
  // For docs grain, workspaceId is used as agentId
  const results = await query(workspaceId, "docs", {
    vector: queryEmbedding,
    filter: `workspaceId = '${workspaceId}'`, // Safety filter to ensure workspace isolation
    limit: topN,
  });

  // Map query results to SearchResult format
  const searchResults: SearchResult[] = results.map((result) => {
    // Calculate similarity from distance
    // LanceDB returns distance (lower is more similar)
    // Convert to similarity score (higher is more similar)
    // Using 1 / (1 + distance) to convert distance to similarity
    const similarity =
      result.distance !== undefined ? 1 / (1 + result.distance) : 0;

    return {
      snippet: result.content,
      documentName: (result.metadata?.documentName as string) || "",
      documentId: (result.metadata?.documentId as string) || "",
      folderPath: (result.metadata?.folderPath as string) || "",
      similarity,
    };
  });

  return searchResults;
}
