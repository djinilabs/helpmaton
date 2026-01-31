import { split } from "llm-splitter";

import { database } from "../tables";
import type { DatabaseSchema } from "../tables/schema";

import { generateEmbeddingWithUsage, resolveEmbeddingApiKey } from "./embedding";
import {
  adjustEmbeddingCreditReservation,
  refundEmbeddingCredits,
  reserveEmbeddingCredits,
} from "./embeddingCredits";
import { query } from "./vectordb/readClient";
import type { AugmentedContext } from "./workspaceCreditContext";

// Default chunk size for splitting documents (llm-splitter default: 1000)
const DEFAULT_CHUNK_SIZE = 1000;
// Default chunk overlap (llm-splitter default: 200)
const DEFAULT_CHUNK_OVERLAP = 200;

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

export interface SearchDocumentsOptions {
  db?: DatabaseSchema;
  context?: AugmentedContext;
  agentId?: string;
  conversationId?: string;
}

/**
 * Split document content into text snippets using llm-splitter
 * Uses recursive splitting strategy suitable for markdown documents
 * @param content - Document content to split
 * @param chunkSize - Optional chunk size (defaults to 1000, llm-splitter default)
 * @param chunkOverlap - Optional chunk overlap (defaults to calculated value: 20% of chunkSize, max 200, always less than chunkSize)
 * @param chunkStrategy - Optional chunk strategy: "paragraph" or "character" (defaults to "paragraph" if content has paragraph breaks, otherwise "character")
 * @returns Array of text snippets
 */
export function splitDocumentIntoSnippets(
  content: string,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
  chunkOverlap?: number,
  chunkStrategy?: "paragraph" | "character",
): string[] {
  if (!content || content.trim().length === 0) {
    return [];
  }

  // Calculate overlap - must be less than chunk size
  // Use provided overlap, or calculate: 20% of chunk size, but not more than DEFAULT_CHUNK_OVERLAP
  const calculatedOverlap = Math.min(
    Math.floor(chunkSize * 0.2),
    DEFAULT_CHUNK_OVERLAP,
    Math.max(1, chunkSize - 1), // Ensure overlap is always less than chunk size
  );
  const finalChunkOverlap =
    chunkOverlap !== undefined
      ? Math.min(chunkOverlap, Math.max(1, chunkSize - 1))
      : calculatedOverlap;

  // Check if content has paragraph breaks
  const hasParagraphs = /\n\s*\n/.test(content);

  // Use provided strategy or determine based on content structure
  const finalChunkStrategy =
    chunkStrategy !== undefined
      ? chunkStrategy
      : hasParagraphs
        ? "paragraph"
        : "character";

  // Use llm-splitter with appropriate splitter based on content structure
  const chunks = split(content, {
    chunkSize,
    chunkOverlap: finalChunkOverlap,
    // Use paragraph-based splitter for markdown if paragraphs exist
    // Otherwise use character-based splitting
    splitter:
      finalChunkStrategy === "paragraph"
        ? (text: string) => text.split(/\n\s*\n/)
        : (text: string) => text.split(""), // Character-based for content without paragraphs
    chunkStrategy: finalChunkStrategy,
  });

  // Extract text from chunks (Chunk.text can be string, string[], or null)
  const snippets: string[] = [];
  for (const chunk of chunks) {
    if (chunk.text === null) {
      continue; // Skip null chunks
    }
    if (typeof chunk.text === "string") {
      const trimmed = chunk.text.trim();
      if (trimmed.length > 0) {
        snippets.push(trimmed);
      }
    } else if (Array.isArray(chunk.text)) {
      // If text is an array, join it appropriately
      const separator = finalChunkStrategy === "paragraph" ? "\n\n" : "";
      const joined = chunk.text.join(separator).trim();
      if (joined.length > 0) {
        snippets.push(joined);
      }
    }
  }

  return snippets;
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
  topN: number = 5,
  options?: SearchDocumentsOptions,
): Promise<SearchResult[]> {
  if (!queryText || queryText.trim().length === 0) {
    return [];
  }

  const trimmedQuery = queryText.trim();
  const { apiKey, usesByok } = await resolveEmbeddingApiKey(workspaceId);

  const hasCreditContext =
    !!options?.context &&
    typeof options.context.addWorkspaceCreditTransaction === "function";
  const db =
    options?.db ?? (hasCreditContext ? await database() : undefined);
  let reservationId: string | undefined;

  if (db && hasCreditContext) {
    const reservation = await reserveEmbeddingCredits({
      db,
      workspaceId,
      text: trimmedQuery,
      usesByok,
      context: options.context,
      agentId: options.agentId,
      conversationId: options.conversationId,
    });
    reservationId = reservation.reservationId;
  }

  // Generate embedding for the query
  let queryEmbedding: number[];
  try {
    const embeddingResult = await generateEmbeddingWithUsage(
      trimmedQuery,
      apiKey,
      undefined,
      undefined,
    );
    queryEmbedding = embeddingResult.embedding;

    if (db && hasCreditContext && reservationId) {
      try {
        await adjustEmbeddingCreditReservation({
          db,
          reservationId,
          workspaceId,
          usage: embeddingResult.usage,
          context: options!.context!,
          agentId: options?.agentId,
          conversationId: options?.conversationId,
        });
      } catch (adjustError) {
        console.error(
          "[searchDocuments] Failed to adjust embedding credit reservation:",
          adjustError,
        );
      }
    }
  } catch (error) {
    console.error(
      "[searchDocuments] Failed to generate query embedding:",
      error,
    );
    if (db && hasCreditContext && reservationId) {
      try {
        await refundEmbeddingCredits({
          db,
          reservationId,
          workspaceId,
          context: options!.context!,
          agentId: options?.agentId,
          conversationId: options?.conversationId,
        });
      } catch (refundError) {
        console.error(
          "[searchDocuments] Failed to refund embedding credits:",
          refundError,
        );
      }
    }
    throw error;
  }

  // Query LanceDB for document snippets
  // For docs grain, workspaceId is used as agentId
  // No filter needed - each workspace has its own isolated database at vectordb/{workspaceId}/docs/
  const results = await query(workspaceId, "docs", {
    vector: queryEmbedding,
    limit: topN,
  });

  // Map query results to SearchResult format
  const searchResults: SearchResult[] = results.map((result) => {
    // Calculate similarity from distance
    // LanceDB uses L2 (Euclidean) distance by default
    // Distance range: [0, ∞) where 0 = identical vectors, larger = more different
    // Convert to similarity score [0, 1] where 1 = identical, 0 = very different
    // Formula: similarity = 1 / (1 + distance)
    // This formula is appropriate for L2 distance:
    // - When distance = 0 (identical): similarity = 1
    // - As distance increases: similarity approaches 0
    // - The +1 prevents division by zero and provides a smooth curve
    // Note: If LanceDB distance metric changes (e.g., to cosine distance),
    // this conversion formula may need to be updated accordingly
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
