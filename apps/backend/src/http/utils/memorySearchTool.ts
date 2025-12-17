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
      .describe(
        "The time grain to search. 'working' for most recent events, 'daily' for day summaries, 'weekly' for week summaries, etc."
      ),
    minimumDaysAgo: z
      .number()
      .int()
      .min(0)
      .optional()
      .default(0)
      .describe(
        "Minimum number of days ago to search from (0 = today). Defaults to 0."
      ),
    maximumDaysAgo: z
      .number()
      .int()
      .min(0)
      .optional()
      .default(365)
      .describe(
        "Maximum number of days ago to search from. Defaults to 365 (1 year)."
      ),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
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
      try {
        const results = await searchMemory({
          agentId,
          workspaceId,
          grain: grain as TemporalGrain,
          minimumDaysAgo,
          maximumDaysAgo,
          maxResults,
          queryText,
        });

        if (results.length === 0) {
          return "No memories found for the specified criteria.";
        }

        // Format results with date prefixes
        const formattedResults = results.map(
          (result) => `[${result.date}] ${result.content}`
        );

        return formattedResults.join("\n\n");
      } catch (error) {
        console.error("[Memory Search Tool] Error:", error);
        return `Error searching memory: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}
