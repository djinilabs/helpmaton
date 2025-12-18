import { getWorkspaceApiKey } from "../../http/utils/agentUtils";
import { getDefined } from "../../utils";
import { generateEmbedding } from "../embedding";
import { query } from "../vectordb/readClient";
import type { TemporalGrain } from "../vectordb/types";

export interface SearchMemoryOptions {
  agentId: string;
  workspaceId: string;
  grain: TemporalGrain;
  minimumDaysAgo?: number;
  maximumDaysAgo?: number;
  maxResults?: number;
  queryText?: string; // Optional text query for semantic search
}

export interface SearchMemoryResult {
  content: string;
  date: string; // Formatted date prefix
  timestamp: string; // ISO timestamp
  metadata?: Record<string, unknown>;
}

/**
 * Search memory across a time range
 * Returns results prefixed with the date when they happened
 */
export async function searchMemory(
  options: SearchMemoryOptions
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

  console.log(
    `[Memory Search] Searching memory for agent ${agentId}, grain ${grain}, minDays: ${minimumDaysAgo}, maxDays: ${maximumDaysAgo}, maxResults: ${maxResults}`
  );

  // Calculate date range from days ago
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - maximumDaysAgo);
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() - minimumDaysAgo);

  console.log(
    `[Memory Search] Date range: ${startDate.toISOString()} to ${endDate.toISOString()}`
  );

  // For working memory, we can't filter by time string, so we'll query all and filter by timestamp
  if (grain === "working") {
    return searchWorkingMemory(
      agentId,
      workspaceId,
      startDate,
      endDate,
      maxResults,
      queryText
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
    try {
      // Get API key for embedding generation
      const workspaceApiKey = await getWorkspaceApiKey(workspaceId, "google");
      const apiKey =
        workspaceApiKey ||
        getDefined(process.env.GEMINI_API_KEY, "GEMINI_API_KEY is not set");

      const queryEmbedding = await generateEmbedding(
        queryText.trim(),
        apiKey,
        undefined,
        undefined
      );
      queryOptions.vector = queryEmbedding;
    } catch (error) {
      console.error(
        "[Memory Search] Failed to generate query embedding:",
        error
      );
      // Continue without semantic search
    }
  }

  // Query the database
  console.log(
    `[Memory Search] Querying database for agent ${agentId}, grain ${grain}`
  );
  const results = await query(agentId, grain, queryOptions);
  console.log(
    `[Memory Search] Found ${results.length} results for agent ${agentId}, grain ${grain}`
  );

  // Format results with date prefixes
  return results.map((result) => {
    const timestamp = new Date(result.timestamp);
    const datePrefix = formatDatePrefix(timestamp);
    return {
      content: result.content,
      date: datePrefix,
      timestamp: result.timestamp,
      metadata: result.metadata,
    };
  });
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
  queryText?: string
): Promise<SearchMemoryResult[]> {
  const queryOptions: Parameters<typeof query>[2] = {
    limit: maxResults,
    temporalFilter: {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    },
  };

  // If queryText is provided, generate embedding and do semantic search
  if (queryText && queryText.trim().length > 0) {
    try {
      // Get API key for embedding generation
      const workspaceApiKey = await getWorkspaceApiKey(workspaceId, "google");
      const apiKey =
        workspaceApiKey ||
        getDefined(process.env.GEMINI_API_KEY, "GEMINI_API_KEY is not set");

      const queryEmbedding = await generateEmbedding(
        queryText.trim(),
        apiKey,
        undefined,
        undefined
      );
      queryOptions.vector = queryEmbedding;
    } catch (error) {
      console.error(
        "[Memory Search] Failed to generate query embedding:",
        error
      );
      // Continue without semantic search
    }
  }

  // Query working memory
  console.log(
    `[Memory Search] Querying working memory for agent ${agentId}, date range: ${startDate.toISOString()} to ${endDate.toISOString()}`
  );
  const results = await query(agentId, "working", queryOptions);
  console.log(
    `[Memory Search] Found ${results.length} results in working memory for agent ${agentId}`
  );

  // Format results with date prefixes
  return results.map((result) => {
    const timestamp = new Date(result.timestamp);
    const datePrefix = formatDatePrefix(timestamp);
    return {
      content: result.content,
      date: datePrefix,
      timestamp: result.timestamp,
      metadata: result.metadata,
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
