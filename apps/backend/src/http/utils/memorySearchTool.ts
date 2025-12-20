import { tool } from "ai";
import { z } from "zod";

import { searchMemory } from "../../utils/memory/searchMemory";
import type { TemporalGrain } from "../../utils/vectordb/types";

/**
 * Create a search_memory tool for agents
 * Allows agents to search their factual memory across different time grains and ranges
 */
export function createSearchMemoryTool(agentId: string, workspaceId: string) {
  const searchMemoryParamsSchema = z.object({
    grain: z
      .enum(["working", "daily", "weekly", "monthly", "quarterly", "yearly"])
      .default("working")
      .describe(
        "The time grain to search. Options: 'working' (most recent events - default), 'daily' (day summaries), 'weekly' (week summaries), 'monthly', 'quarterly', or 'yearly'. Note: 'docs' grain is for document search, not memory search. Defaults to 'working' if not specified."
      ),
    minimumDaysAgo: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
        "Minimum number of days ago to search from (0 = today). Defaults to 0."
      ),
    maximumDaysAgo: z
      .number()
      .int()
      .min(0)
      .default(365)
      .describe(
        "Maximum number of days ago to search from. Defaults to 365 (1 year)."
      ),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(10)
      .describe(
        "Maximum number of results to return. Defaults to 10, maximum is 100."
      ),
    queryText: z
      .string()
      .optional()
      .describe(
        "Optional text query for semantic search. If provided, will search for similar content. If not provided, returns most recent events."
      ),
  });

  type SearchMemoryArgs = z.infer<typeof searchMemoryParamsSchema>;

  return tool({
    description:
      "Search the agent's factual memory. Returns the most recent events prefixed by the date when they happened. Use this to recall past conversations, facts, and important information.",
    parameters: searchMemoryParamsSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      const typedArgs = args as SearchMemoryArgs;
      const { grain, minimumDaysAgo, maximumDaysAgo, maxResults, queryText } =
        typedArgs;

      // Ensure parameters have default values if undefined and are valid numbers
      const effectiveGrain = (grain || "working") as TemporalGrain;

      // Parse and validate numeric parameters with proper defaults
      let effectiveMinimumDaysAgo = 0;
      let effectiveMaximumDaysAgo = 365;
      let effectiveMaxResults = 10;

      try {
        effectiveMinimumDaysAgo = Number.isFinite(minimumDaysAgo)
          ? Math.max(0, Math.floor(minimumDaysAgo))
          : 0;
        effectiveMaximumDaysAgo = Number.isFinite(maximumDaysAgo)
          ? Math.max(0, Math.floor(maximumDaysAgo))
          : 365;
        effectiveMaxResults = Number.isFinite(maxResults)
          ? Math.max(1, Math.min(100, Math.floor(maxResults)))
          : 10;
      } catch (error) {
        console.error(
          "[Memory Search Tool] Parameter validation error:",
          error
        );
        // Continue with defaults
      }

      try {
        const results = await searchMemory({
          agentId,
          workspaceId,
          grain: effectiveGrain,
          minimumDaysAgo: effectiveMinimumDaysAgo,
          maximumDaysAgo: effectiveMaximumDaysAgo,
          maxResults: effectiveMaxResults,
          queryText,
        });

        // Calculate date range for context
        let cutoffDateStr = "unknown";
        try {
          const now = new Date();
          const cutoffDate = new Date(now);
          cutoffDate.setDate(cutoffDate.getDate() - effectiveMaximumDaysAgo);

          // Validate the date is valid before converting to ISO string
          if (!isNaN(cutoffDate.getTime())) {
            cutoffDateStr = cutoffDate.toISOString().split("T")[0];
          }
        } catch (dateError) {
          console.error(
            "[Memory Search Tool] Date calculation error:",
            dateError
          );
        }

        // Determine next grain suggestion
        const grainHierarchy: Record<
          string,
          { next: string; description: string } | null
        > = {
          working: { next: "daily", description: "day summaries" },
          daily: { next: "weekly", description: "week summaries" },
          weekly: { next: "monthly", description: "month summaries" },
          monthly: { next: "quarterly", description: "quarter summaries" },
          quarterly: { next: "yearly", description: "year summaries" },
          yearly: null,
        };

        const nextGrainInfo = grainHierarchy[effectiveGrain];
        const suggestionText = nextGrainInfo
          ? `\n\nℹ️  Search cut-off: ${cutoffDateStr} (${effectiveMaximumDaysAgo} days ago). To search older memories, try grain="${nextGrainInfo.next}" (${nextGrainInfo.description}).`
          : `\n\nℹ️  Search cut-off: ${cutoffDateStr} (${effectiveMaximumDaysAgo} days ago). You're searching the highest grain level (yearly).`;

        if (results.length === 0) {
          return `No memories found for the specified criteria.${suggestionText}`;
        }

        // Format results with date prefixes
        const formattedResults = results.map(
          (result) => `[${result.date}] ${result.content}`
        );

        return formattedResults.join("\n\n") + suggestionText;
      } catch (error) {
        console.error("[Memory Search Tool] Error:", error);
        return `Error searching memory: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}
