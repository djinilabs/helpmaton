import { database } from "../../tables";
import type { DatabaseSchema } from "../../tables/schema";
import { generateEmbeddingWithUsage, resolveEmbeddingApiKey } from "../embedding";
import {
  adjustEmbeddingCreditReservation,
  EMBEDDING_TOOL_CALLS,
  refundEmbeddingCredits,
  reserveEmbeddingCredits,
} from "../embeddingCredits";
import { MAX_QUERY_LIMIT } from "../vectordb/config";
import { getRecordById, query } from "../vectordb/readClient";
import type { TemporalGrain } from "../vectordb/types";
import type { AugmentedContext } from "../workspaceCreditContext";

export interface SearchMemoryOptions {
  agentId: string;
  workspaceId: string;
  grain: TemporalGrain;
  minimumDaysAgo?: number;
  maximumDaysAgo?: number;
  maxResults?: number;
  queryText?: string; // Optional text query for semantic search
  db?: DatabaseSchema;
  context?: AugmentedContext;
  conversationId?: string;
}

export interface SearchMemoryResult {
  id: string;
  content: string;
  date: string; // Formatted date prefix
  timestamp: string; // ISO timestamp
  metadata?: Record<string, unknown>;
  similarity?: number;
}

/**
 * Search memory across a time range
 * Returns results prefixed with the date when they happened
 */
export async function searchMemory(
  options: SearchMemoryOptions,
): Promise<SearchMemoryResult[]> {
  const {
    agentId,
    workspaceId,
    grain,
    minimumDaysAgo = 0,
    maximumDaysAgo = 365,
    maxResults = 10,
    queryText,
  } = options;

  // Reject docs grain - it's for document search, not memory search
  if (grain === "docs") {
    throw new Error(
      "The 'docs' grain is for document search, not memory search. Use document search tools instead.",
    );
  }

  console.log(
    `[Memory Search] Searching memory for agent ${agentId}, grain ${grain}, minDays: ${minimumDaysAgo}, maxDays: ${maximumDaysAgo}, maxResults: ${maxResults}`,
  );

  // Calculate date range from days ago
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - maximumDaysAgo);
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() - minimumDaysAgo);

  console.log(
    `[Memory Search] Date range: ${startDate.toISOString()} to ${endDate.toISOString()}`,
  );

  // For working memory, we can't filter by time string, so we'll query all and filter by timestamp
  if (grain === "working") {
    return searchWorkingMemory(
      agentId,
      workspaceId,
      startDate,
      endDate,
      maxResults,
      queryText,
      {
        db: options.db,
        context: options.context,
        conversationId: options.conversationId,
      },
    );
  }

  // For other grains, we need to determine which time strings to query
  // This is a simplified approach - in practice, we might need to query multiple time strings
  // For now, we'll query the database and filter by timestamp
  const queryOptions: Parameters<typeof query>[2] = {
    limit: maxResults,
    temporalFilter: {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    },
  };

  // If queryText is provided, generate embedding and do semantic search
  if (queryText && queryText.trim().length > 0) {
    const trimmedQuery = queryText.trim();
    const hasCreditContext =
      !!options.context &&
      typeof options.context.addWorkspaceCreditTransaction === "function";
    const db = options.db ?? (hasCreditContext ? await database() : undefined);
    let reservationId: string | undefined;
    try {
      const { apiKey, usesByok } = await resolveEmbeddingApiKey(workspaceId);
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

      const embeddingResult = await generateEmbeddingWithUsage(
        trimmedQuery,
        apiKey,
        undefined,
        undefined,
      );
      queryOptions.vector = embeddingResult.embedding;

      if (db && hasCreditContext && reservationId) {
        try {
          await adjustEmbeddingCreditReservation({
            db,
            reservationId,
            workspaceId,
            usage: embeddingResult.usage,
            generationId: embeddingResult.id,
            context: options.context!,
            agentId: options.agentId,
            conversationId: options.conversationId,
            toolCall: EMBEDDING_TOOL_CALLS.memorySearch,
            description: "Memory search embeddings",
          });
        } catch (adjustError) {
          console.error(
            "[Memory Search] Failed to adjust embedding credit reservation:",
            adjustError,
          );
        }
      }
    } catch (error) {
      console.error(
        "[Memory Search] Failed to generate query embedding:",
        error,
      );
      if (db && hasCreditContext && reservationId) {
        try {
          await refundEmbeddingCredits({
            db,
            reservationId,
            workspaceId,
            context: options.context!,
            agentId: options.agentId,
            conversationId: options.conversationId,
            toolCall: EMBEDDING_TOOL_CALLS.memorySearch,
            description: "Memory search embeddings",
          });
        } catch (refundError) {
          console.error(
            "[Memory Search] Failed to refund embedding credits:",
            refundError,
          );
        }
      }
      // Continue without semantic search
    }
  }

  // Query the database
  console.log(
    `[Memory Search] Querying database for agent ${agentId}, grain ${grain}`,
  );
  const results = await query(agentId, grain, queryOptions);
  console.log(
    `[Memory Search] Found ${results.length} results for agent ${agentId}, grain ${grain}`,
  );

  // Format results with date prefixes
  return results.map((result) => {
    const timestamp = new Date(result.timestamp);
    const datePrefix = formatDatePrefix(timestamp);
    const similarity =
      result.distance !== undefined ? 1 / (1 + result.distance) : undefined;
    return {
      id: result.id,
      content: result.content,
      date: datePrefix,
      timestamp: result.timestamp,
      metadata: result.metadata,
      similarity,
    };
  });
}

export async function getMemoryRecord(options: {
  agentId: string;
  grain: TemporalGrain;
  recordId: string;
}): Promise<SearchMemoryResult | null> {
  const { agentId, grain, recordId } = options;
  const record = await getRecordById(agentId, grain, recordId);
  if (!record) {
    return null;
  }

  const timestamp = new Date(record.timestamp);
  const datePrefix = formatDatePrefix(timestamp);
  const similarity =
    record.distance !== undefined ? 1 / (1 + record.distance) : undefined;

  return {
    id: record.id,
    content: record.content,
    date: datePrefix,
    timestamp: record.timestamp,
    metadata: record.metadata,
    similarity,
  };
}

/**
 * Search working memory (no time string filtering)
 */
async function searchWorkingMemory(
  agentId: string,
  workspaceId: string,
  startDate: Date,
  endDate: Date,
  maxResults: number,
  queryText?: string,
  options?: Pick<SearchMemoryOptions, "db" | "context" | "conversationId">,
): Promise<SearchMemoryResult[]> {
  const hasQueryText = Boolean(queryText && queryText.trim().length > 0);
  const queryOptions: Parameters<typeof query>[2] = {
    limit: hasQueryText ? maxResults : MAX_QUERY_LIMIT,
    temporalFilter: {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    },
  };

  // If queryText is provided, generate embedding and do semantic search
  if (hasQueryText) {
    const trimmedQuery = queryText!.trim();
    const creditContext = options?.context;
    const hasCreditContext =
      !!creditContext &&
      typeof creditContext.addWorkspaceCreditTransaction === "function";
    const db =
      options?.db ?? (hasCreditContext ? await database() : undefined);
    const conversationId = options?.conversationId;
    let reservationId: string | undefined;
    try {
      const { apiKey, usesByok } = await resolveEmbeddingApiKey(workspaceId);
      if (db && hasCreditContext) {
        const reservation = await reserveEmbeddingCredits({
          db,
          workspaceId,
          text: trimmedQuery,
          usesByok,
          context: creditContext,
          agentId,
          conversationId,
        });
        reservationId = reservation.reservationId;
      }

      const embeddingResult = await generateEmbeddingWithUsage(
        trimmedQuery,
        apiKey,
        undefined,
        undefined,
      );
      queryOptions.vector = embeddingResult.embedding;

      if (db && hasCreditContext && reservationId) {
        try {
          await adjustEmbeddingCreditReservation({
            db,
            reservationId,
            workspaceId,
            usage: embeddingResult.usage,
            generationId: embeddingResult.id,
            context: creditContext!,
            agentId,
            conversationId,
            toolCall: EMBEDDING_TOOL_CALLS.memorySearch,
            description: "Memory search embeddings",
          });
        } catch (adjustError) {
          console.error(
            "[Memory Search] Failed to adjust embedding credit reservation:",
            adjustError,
          );
        }
      }
    } catch (error) {
      console.error(
        "[Memory Search] Failed to generate query embedding:",
        error,
      );
      if (db && hasCreditContext && reservationId) {
        try {
          await refundEmbeddingCredits({
            db,
            reservationId,
            workspaceId,
            context: creditContext!,
            agentId,
            conversationId,
            toolCall: EMBEDDING_TOOL_CALLS.memorySearch,
            description: "Memory search embeddings",
          });
        } catch (refundError) {
          console.error(
            "[Memory Search] Failed to refund embedding credits:",
            refundError,
          );
        }
      }
      // Continue without semantic search
    }
  }

  // Query working memory
  console.log(
    `[Memory Search] Querying working memory for agent ${agentId}, date range: ${startDate.toISOString()} to ${endDate.toISOString()}`,
  );
  const results = await query(agentId, "working", queryOptions);
  console.log(
    `[Memory Search] Found ${results.length} results in working memory for agent ${agentId}`,
  );

  const orderedResults = hasQueryText
    ? results
    : results
        .slice()
        .sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        )
        .slice(0, maxResults);

  // Format results with date prefixes
  return orderedResults.map((result) => {
    const timestamp = new Date(result.timestamp);
    const datePrefix = formatDatePrefix(timestamp);
    const similarity =
      result.distance !== undefined ? 1 / (1 + result.distance) : undefined;
    return {
      id: result.id,
      content: result.content,
      date: datePrefix,
      timestamp: result.timestamp,
      metadata: result.metadata,
      similarity,
    };
  });
}

/**
 * Format a date as a prefix string (YYYY-MM-DD)
 */
function formatDatePrefix(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
