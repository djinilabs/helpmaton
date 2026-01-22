/**
 * Exa.ai API tools for agents
 * Provides search tool with category support and credit management
 */

import { tool } from "ai";
import { z } from "zod";

import { database } from "../../tables/database";
import { exaSearch, extractExaCost, type ExaSearchCategory } from "../../utils/exa";
import {
  reserveExaCredits,
  adjustExaCreditReservation,
} from "../../utils/exaCredits";
import { incrementSearchRequestBucket } from "../../utils/requestTracking";
import type { AugmentedContext } from "../../utils/workspaceCreditContext";

/**
 * Create Exa.ai search tool
 * Searches using Exa.ai with category-specific search
 * @param workspaceId - Workspace ID
 * @param context - Augmented Lambda context for transaction creation (optional)
 * @param agentId - Agent ID (optional, for transaction tracking)
 * @param conversationId - Conversation ID (optional, for transaction tracking)
 */
export function createExaSearchTool(
  workspaceId: string,
  context?: AugmentedContext,
  agentId?: string,
  conversationId?: string
) {
  const searchParamsSchema = z.object({
    category: z
      .enum([
        "company",
        "research paper",
        "news",
        "pdf",
        "github",
        "tweet",
        "personal site",
        "people",
        "financial report",
      ])
      .describe(
        "REQUIRED: The search category. Must be one of: 'company', 'research paper', 'news', 'pdf', 'github', 'tweet', 'personal site', 'people', 'financial report'. This determines the type of content to search for."
      ),
    query: z
      .string()
      .min(1, "query is required and cannot be empty")
      .describe(
        "REQUIRED: The search query. This MUST be a non-empty string containing what you want to search for. Example: 'latest AI research' or 'Apple Inc financial reports'"
      ),
    num_results: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(10)
      .describe(
        "OPTIONAL: Number of search results to return (1-100, default: 10). Use a smaller number for focused searches, larger for comprehensive research."
      ),
  });

  type SearchArgs = z.infer<typeof searchParamsSchema>;

  const description =
    "Search the web using Exa.ai with category-specific search. This tool allows you to search for specific types of content (companies, research papers, news, PDFs, GitHub repos, tweets, personal sites, people, or financial reports). Use this when you need to find specialized content that matches a specific category. CRITICAL REQUIREMENTS: (1) You MUST provide both 'category' and 'query' parameters - they are REQUIRED and cannot be empty. (2) The 'category' parameter must be one of the valid categories: 'company', 'research paper', 'news', 'pdf', 'github', 'tweet', 'personal site', 'people', 'financial report'. (3) The 'query' parameter must be a non-empty string. (4) When the user asks you to search for something in a specific category, IMMEDIATELY call this tool with both required parameters. Example: If user says 'search for AI research papers', call search with {category: 'research paper', query: 'AI research'}. Example: If user wants company information, call search with {category: 'company', query: 'Apple Inc'}. The search results include titles, URLs, content snippets, and relevance scores. Note: This tool charges based on usage (cost varies by number of results).";

  return tool({
    description,
    parameters: searchParamsSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any, { abortSignal }: { abortSignal?: AbortSignal } = {}) => {
      // Validate required parameters
      if (!args || typeof args !== "object") {
        return "Error: search requires both 'category' and 'query' parameters. Please provide both parameters.";
      }

      const typedArgs = args as SearchArgs;
      const { category, query, num_results } = typedArgs;

      // Validate category parameter
      if (!category || typeof category !== "string") {
        return "Error: search requires a 'category' parameter. Must be one of: 'company', 'research paper', 'news', 'pdf', 'github', 'tweet', 'personal site', 'people', 'financial report'. Example: {category: 'news', query: 'latest AI developments'}";
      }

      // Validate query parameter
      if (!query || typeof query !== "string" || query.trim().length === 0) {
        return "Error: search requires a non-empty 'query' parameter. Please provide a search query string. Example: {category: 'news', query: 'latest AI developments'}";
      }

      // Log tool call
      console.log("[Tool Call] search (Exa)", {
        toolName: "search",
        provider: "exa",
        arguments: { category, query, num_results },
        workspaceId,
        agentId,
        conversationId,
      });

      const db = await database();
      let reservationId: string | undefined;

      try {
        // Always reserve credits (Exa is pay-as-you-go, no free tier)
        if (!context) {
          throw new Error(
            "Context not available for Exa credit transactions (search)"
          );
        }
        const reservation = await reserveExaCredits(
          db,
          workspaceId,
          0.01, // Estimate: $0.01 per call (conservative)
          3, // maxRetries
          context,
          agentId,
          conversationId
        );
        reservationId = reservation.reservationId;
        console.log("[search] Reserved credits:", {
          workspaceId,
          reservationId,
          reservedAmount: reservation.reservedAmount,
        });

        // Make Exa API call
        const searchResponse = await exaSearch(
          query,
          category as ExaSearchCategory,
          {
            num_results,
            signal: abortSignal,
          }
        );

        // Extract cost from API response
        const actualCostDollars = extractExaCost(searchResponse);

        // Track the call (after successful API call - we only track successful calls)
        // If tracking fails, log error but don't fail the tool call since API succeeded
        try {
          await incrementSearchRequestBucket(workspaceId);
        } catch (trackingError) {
          console.error("[search] Failed to track Exa API call usage", {
            workspaceId,
            reservationId,
            error: trackingError,
          });
          // Continue execution - tracking failure is a logging issue, not a correctness issue
        }

        // Adjust credits if we reserved them
        // Note: reservationId is set for all calls (pay-as-you-go)
        if (
          reservationId &&
          reservationId !== "byok" &&
          reservationId !== "zero-cost" &&
          reservationId !== "deduction-disabled"
        ) {
          if (!context) {
            throw new Error(
              "Context not available for Exa credit transactions (search adjustment)"
            );
          }
          await adjustExaCreditReservation(
            db,
            reservationId,
            workspaceId,
            actualCostDollars,
            context,
            "search",
            3, // maxRetries
            agentId,
            conversationId
          );
          console.log("[search] Adjusted credits:", {
            workspaceId,
            reservationId,
            actualCostDollars,
          });
        }

        // Format search results
        const results = searchResponse.results || [];
        let resultText = `Found ${results.length} search result${
          results.length !== 1 ? "s" : ""
        } for "${query}" in category "${category}":\n\n`;

        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          resultText += `${i + 1}. **${result.title}**\n`;
          resultText += `   URL: ${result.url}\n`;
          if (result.published_date) {
            resultText += `   Published: ${result.published_date}\n`;
          }
          if (result.author) {
            resultText += `   Author: ${result.author}\n`;
          }
          if (result.text) {
            resultText += `   ${result.text}\n`;
          }
          if (result.score !== undefined) {
            resultText += `   (Relevance score: ${result.score.toFixed(2)})\n`;
          }
          resultText += `\n`;
        }

        // Calculate cost and embed in result (will be parsed out when formatting)
        // Use improved marker format: __HM_TOOL_COST__:8000 (less likely to conflict with content)
        const costUsd = Math.ceil(actualCostDollars * 1_000_000); // Convert to millionths
        resultText += `\n\n__HM_TOOL_COST__:${costUsd}`;

        // Log tool result
        console.log("[Tool Result] search (Exa)", {
          toolName: "search",
          provider: "exa",
          resultCount: results.length,
          costDollars: actualCostDollars,
          workspaceId,
          agentId,
          conversationId,
        });

        return resultText;
      } catch (error) {
        // Do not refund on tool failures; consume reservation instead
        if (
          reservationId &&
          reservationId !== "byok" &&
          reservationId !== "zero-cost" &&
          reservationId !== "deduction-disabled"
        ) {
          try {
            await db["credit-reservations"].delete(
              `credit-reservations/${reservationId}`
            );
            console.log("[search] Removed reservation after error:", {
              workspaceId,
              reservationId,
            });
          } catch (cleanupError) {
            console.error("[search] Error removing reservation:", {
              workspaceId,
              reservationId,
              error:
                cleanupError instanceof Error
                  ? cleanupError.message
                  : String(cleanupError),
            });
          }
        }

        const errorMessage = `Error searching with Exa.ai: ${
          error instanceof Error ? error.message : String(error)
        }`;
        console.error("[Tool Error] search (Exa)", {
          toolName: "search",
          provider: "exa",
          error: error instanceof Error ? error.message : String(error),
          arguments: { category, query, num_results },
          workspaceId,
          agentId,
          conversationId,
        });
        return errorMessage;
      }
    },
  });
}

