/**
 * Tavily API tools for agents
 * Provides search and fetch tools with daily limit checks and credit management
 */

import { tool } from "ai";
import { z } from "zod";

import { database } from "../../tables/database";
import {
  checkTavilyDailyLimit,
  incrementTavilyCallBucket,
} from "../../utils/requestTracking";
import {
  tavilySearch,
  tavilyExtract,
  extractCreditsUsed,
} from "../../utils/tavily";
import {
  reserveTavilyCredits,
  adjustTavilyCreditReservation,
  refundTavilyCredits,
  calculateTavilyCost,
} from "../../utils/tavilyCredits";
import type { AugmentedContext } from "../../utils/workspaceCreditContext";

/**
 * Create web search tool
 * Searches the web for current information
 * @param workspaceId - Workspace ID
 * @param context - Augmented Lambda context for transaction creation (optional)
 * @param agentId - Agent ID (optional, for transaction tracking)
 * @param conversationId - Conversation ID (optional, for transaction tracking)
 */
export function createTavilySearchTool(
  workspaceId: string,
  context?: AugmentedContext,
  agentId?: string,
  conversationId?: string
) {
  const searchParamsSchema = z.object({
    query: z
      .string()
      .min(1, "query is required and cannot be empty")
      .describe(
        "REQUIRED: The search query. This MUST be a non-empty string containing what you want to search for. Example: 'latest news about AI' or 'Python tutorial for beginners'"
      ),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .default(5)
      .describe(
        "OPTIONAL: Maximum number of search results to return (1-10, default: 5). Use a smaller number for focused searches, larger for comprehensive research."
      ),
  });

  type SearchArgs = z.infer<typeof searchParamsSchema>;

  const description =
    "Search the web for current information, news, articles, and other web content. Use this when you need up-to-date information that isn't in your training data or when you need to find specific websites or resources. CRITICAL REQUIREMENTS: (1) You MUST provide the 'query' parameter - it is REQUIRED and cannot be empty. (2) The 'query' parameter must be a non-empty string containing what you want to search for. (3) The 'max_results' parameter is optional (defaults to 5 if not provided). (4) When the user asks you to search for something, IMMEDIATELY call this tool with the required 'query' parameter. Example: If user says 'search for latest AI news', call search_web with {query: 'latest AI news'}. Example: If user wants 10 results, call search_web with {query: 'Python tutorials', max_results: 10}. The search results include titles, URLs, content snippets, and relevance scores.";

  return tool({
    description,
    parameters: searchParamsSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      // Validate required parameters
      if (!args || typeof args !== "object") {
        return "Error: search_web requires a 'query' parameter. Please provide a search query string.";
      }

      const typedArgs = args as SearchArgs;
      const { query, max_results } = typedArgs;

      // Validate query parameter
      if (!query || typeof query !== "string" || query.trim().length === 0) {
        return "Error: search_web requires a non-empty 'query' parameter. Please provide a search query string. Example: {query: 'latest news about AI'}";
      }

      // Log tool call
      console.log("[Tool Call] search_web", {
        toolName: "search_web",
        arguments: { query, max_results },
        workspaceId,
      });

      const db = await database();
      let reservationId: string | undefined;

      try {
        // Check daily limit
        const limitCheck = await checkTavilyDailyLimit(workspaceId);
        const { withinFreeLimit, callCount } = limitCheck;

        console.log("[search_web] Daily limit check:", {
          workspaceId,
          withinFreeLimit,
          callCount,
        });

        // always charge credits (pay-as-you-go, no free tier)
        const shouldReserveCredits = !withinFreeLimit;

        if (shouldReserveCredits) {
          if (!context) {
            throw new Error(
              "Context not available for Tavily credit transactions (search_web)"
            );
          }
          const reservation = await reserveTavilyCredits(
            db,
            workspaceId,
            1, // Estimate: 1 credit per call
            3, // maxRetries
            context,
            agentId,
            conversationId
          );
          reservationId = reservation.reservationId;
          console.log("[search_web] Reserved credits:", {
            workspaceId,
            reservationId,
            reservedAmount: reservation.reservedAmount,
          });
        }

        // Make Tavily API call
        const searchResponse = await tavilySearch(query, {
          max_results,
        });

        // Extract usage from API response
        const actualCreditsUsed = extractCreditsUsed(searchResponse);

        // Track the call (after successful API call - we only track successful calls)
        // If tracking fails, log error but don't fail the tool call since API succeeded
        try {
          await incrementTavilyCallBucket(workspaceId);
        } catch (trackingError) {
          console.error("[search_web] Failed to track Tavily API call usage", {
            workspaceId,
            reservationId,
            error: trackingError,
          });
          // Continue execution - tracking failure is a logging issue, not a correctness issue
        }

        // Create transaction for free tier users (when no reservation was made)
        // This ensures all API usage is tracked, even for free tier
        if (!reservationId && context) {
          const actualCost = calculateTavilyCost(actualCreditsUsed);
          context.addWorkspaceCreditTransaction({
            workspaceId,
            agentId: agentId || undefined,
            conversationId: conversationId || undefined,
            source: "tool-execution",
            supplier: "tavily",
            tool_call: "search_web",
            description: `Tavily API call: search_web - actual cost (free tier)`,
            amountMillionthUsd: -actualCost, // Negative for debit (deducting from workspace)
          });
          console.log("[search_web] Created transaction for free tier:", {
            workspaceId,
            actualCreditsUsed,
            actualCost,
          });
        }

        // Adjust credits if we reserved them
        // Note: reservationId is only set for paid tiers that exceeded free limit and reserved credits
        if (
          reservationId &&
          reservationId !== "byok" &&
          reservationId !== "zero-cost"
        ) {
          if (!context) {
            throw new Error(
              "Context not available for Tavily credit transactions (search_web adjustment)"
            );
          }
          await adjustTavilyCreditReservation(
            db,
            reservationId,
            workspaceId,
            actualCreditsUsed,
            context,
            "search_web",
            3, // maxRetries
            agentId,
            conversationId
          );
          console.log("[search_web] Adjusted credits:", {
            workspaceId,
            reservationId,
            actualCreditsUsed,
          });
        }

        // Format search results
        const results = searchResponse.results || [];
        let resultText = `Found ${results.length} search result${
          results.length !== 1 ? "s" : ""
        } for "${query}":\n\n`;

        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          resultText += `${i + 1}. **${result.title}**\n`;
          resultText += `   URL: ${result.url}\n`;
          resultText += `   ${result.content}\n`;
          if (result.score !== undefined) {
            resultText += `   (Relevance score: ${result.score.toFixed(2)})\n`;
          }
          resultText += `\n`;
        }

        // Add answer if available
        if (searchResponse.answer) {
          resultText += `\n**Summary Answer:**\n${searchResponse.answer}\n`;
        }

        // Calculate cost and embed in result (will be parsed out when formatting)
        const costUsd = calculateTavilyCost(actualCreditsUsed);
        resultText += `\n\n[TOOL_COST:${costUsd}]`;

        // Log tool result
        console.log("[Tool Result] search_web", {
          toolName: "search_web",
          resultCount: results.length,
          creditsUsed: actualCreditsUsed,
          costUsd,
        });

        return resultText;
      } catch (error) {
        // Refund credits if API call failed and we reserved them
        if (
          reservationId &&
          reservationId !== "byok" &&
          reservationId !== "zero-cost"
        ) {
          try {
            if (!context) {
              throw new Error(
                "Context not available for Tavily credit transactions (search_web refund)"
              );
            }
            await refundTavilyCredits(
              db,
              reservationId,
              workspaceId,
              context,
              "search_web",
              3,
              agentId,
              conversationId
            );
            console.log("[search_web] Refunded credits due to error:", {
              workspaceId,
              reservationId,
            });
          } catch (refundError) {
            console.error("[search_web] Error refunding credits:", {
              workspaceId,
              reservationId,
              error:
                refundError instanceof Error
                  ? refundError.message
                  : String(refundError),
            });
          }
        }

        const errorMessage = `Error searching the web: ${
          error instanceof Error ? error.message : String(error)
        }`;
        console.error("[Tool Error] search_web", {
          toolName: "search_web",
          error: error instanceof Error ? error.message : String(error),
          arguments: { query, max_results },
        });
        return errorMessage;
      }
    },
  });
}

/**
 * Create web fetch tool
 * Extracts and summarizes content from a URL
 * @param workspaceId - Workspace ID
 * @param context - Augmented Lambda context for transaction creation (optional)
 * @param agentId - Agent ID (optional, for transaction tracking)
 * @param conversationId - Conversation ID (optional, for transaction tracking)
 */
export function createTavilyFetchTool(
  workspaceId: string,
  context?: AugmentedContext,
  agentId?: string,
  conversationId?: string
) {
  const fetchParamsSchema = z.object({
    url: z
      .string()
      .url("url must be a valid URL")
      .describe(
        "REQUIRED: The URL to extract content from. This MUST be a valid URL starting with http:// or https://. Example: 'https://example.com/article'"
      ),
  });

  type FetchArgs = z.infer<typeof fetchParamsSchema>;

  const description =
    "Extract and summarize content from a web page URL using Tavily extract API. This tool allows you to get the main content, title, and metadata from any web page. Use this when you need to read and understand the content of a specific webpage. CRITICAL REQUIREMENTS: (1) You MUST provide the 'url' parameter - it is REQUIRED and cannot be empty. (2) The 'url' parameter must be a valid URL starting with http:// or https://. (3) When the user asks you to fetch or read content from a URL, IMMEDIATELY call this tool with the required 'url' parameter. Example: If user says 'fetch content from https://example.com/article', call fetch_web with {url: 'https://example.com/article'}. Example: If user provides a URL, call fetch_web with {url: 'https://news.example.com/story'}. The tool extracts the main text content, title, and optionally images from the page.";

  return tool({
    description,
    parameters: fetchParamsSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      // Validate required parameters
      if (!args || typeof args !== "object") {
        return "Error: fetch_web requires a 'url' parameter. Please provide a valid URL string.";
      }

      const typedArgs = args as FetchArgs;
      const { url } = typedArgs;

      // Validate url parameter
      if (!url || typeof url !== "string" || url.trim().length === 0) {
        return "Error: fetch_web requires a non-empty 'url' parameter. Please provide a valid URL starting with http:// or https://. Example: {url: 'https://example.com/article'}";
      }

      // Basic URL validation
      try {
        new URL(url);
      } catch {
        return "Error: fetch_web requires a valid URL. The 'url' parameter must be a valid URL starting with http:// or https://. Example: {url: 'https://example.com/article'}";
      }

      // Log tool call
      console.log("[Tool Call] fetch_web", {
        toolName: "fetch_web",
        arguments: { url },
        workspaceId,
      });

      const db = await database();
      let reservationId: string | undefined;

      try {
        // Check daily limit
        const limitCheck = await checkTavilyDailyLimit(workspaceId);
        const { withinFreeLimit, callCount } = limitCheck;

        console.log("[fetch_web] Daily limit check:", {
          workspaceId,
          withinFreeLimit,
          callCount,
        });

        const shouldReserveCredits = !withinFreeLimit;

        if (shouldReserveCredits) {
          if (!context) {
            throw new Error(
              "Context not available for Tavily credit transactions (fetch_web)"
            );
          }
          const reservation = await reserveTavilyCredits(
            db,
            workspaceId,
            1, // Estimate: 1 credit per call
            3, // maxRetries
            context,
            agentId,
            conversationId
          );
          reservationId = reservation.reservationId;
          console.log("[fetch_web] Reserved credits:", {
            workspaceId,
            reservationId,
            reservedAmount: reservation.reservedAmount,
          });
        }

        // Make Tavily API call
        const extractResponse = await tavilyExtract(url);

        // Extract usage from API response
        const actualCreditsUsed = extractCreditsUsed(extractResponse);

        // Track the call (after successful API call - we only track successful calls)
        // If tracking fails, log error but don't fail the tool call since API succeeded
        try {
          await incrementTavilyCallBucket(workspaceId);
        } catch (trackingError) {
          console.error("[fetch_web] Failed to track Tavily API call usage", {
            workspaceId,
            reservationId,
            error: trackingError,
          });
          // Continue execution - tracking failure is a logging issue, not a correctness issue
        }

        // Create transaction for free tier users (when no reservation was made)
        // This ensures all API usage is tracked, even for free tier
        if (!reservationId && context) {
          const actualCost = calculateTavilyCost(actualCreditsUsed);
          context.addWorkspaceCreditTransaction({
            workspaceId,
            agentId: agentId || undefined,
            conversationId: conversationId || undefined,
            source: "tool-execution",
            supplier: "tavily",
            tool_call: "fetch_web",
            description: `Tavily API call: fetch_web - actual cost (free tier)`,
            amountMillionthUsd: -actualCost, // Negative for debit (deducting from workspace)
          });
          console.log("[fetch_web] Created transaction for free tier:", {
            workspaceId,
            actualCreditsUsed,
            actualCost,
          });
        }

        // Adjust credits if we reserved them
        // Note: reservationId is only set for paid tiers that exceeded free limit and reserved credits
        if (
          reservationId &&
          reservationId !== "byok" &&
          reservationId !== "zero-cost"
        ) {
          if (!context) {
            throw new Error(
              "Context not available for Tavily credit transactions (fetch_web adjustment)"
            );
          }
          await adjustTavilyCreditReservation(
            db,
            reservationId,
            workspaceId,
            actualCreditsUsed,
            context,
            "fetch_web",
            3, // maxRetries
            agentId,
            conversationId
          );
          console.log("[fetch_web] Adjusted credits:", {
            workspaceId,
            reservationId,
            actualCreditsUsed,
          });
        }

        // Format extracted content
        let resultText = `**Content extracted from ${url}:**\n\n`;

        if (extractResponse.title) {
          resultText += `**Title:** ${extractResponse.title}\n\n`;
        }

        resultText += `**Content:**\n${extractResponse.content}\n`;

        if (extractResponse.images && extractResponse.images.length > 0) {
          resultText += `\n**Images found:** ${extractResponse.images.length}\n`;
          extractResponse.images.slice(0, 5).forEach((imageUrl, index) => {
            resultText += `${index + 1}. ${imageUrl}\n`;
          });
        }

        // Calculate cost and embed in result (will be parsed out when formatting)
        const costUsd = calculateTavilyCost(actualCreditsUsed);
        resultText += `\n\n[TOOL_COST:${costUsd}]`;

        // Log tool result
        console.log("[Tool Result] fetch_web", {
          toolName: "fetch_web",
          url,
          creditsUsed: actualCreditsUsed,
          costUsd,
        });

        return resultText;
      } catch (error) {
        // Refund credits if API call failed and we reserved them
        if (
          reservationId &&
          reservationId !== "byok" &&
          reservationId !== "zero-cost"
        ) {
          try {
            if (!context) {
              throw new Error(
                "Context not available for Tavily credit transactions (fetch_web refund)"
              );
            }
            await refundTavilyCredits(
              db,
              reservationId,
              workspaceId,
              context,
              "fetch_web",
              3,
              agentId,
              conversationId
            );
            console.log("[fetch_web] Refunded credits due to error:", {
              workspaceId,
              reservationId,
            });
          } catch (refundError) {
            console.error("[fetch_web] Error refunding credits:", {
              workspaceId,
              reservationId,
              error:
                refundError instanceof Error
                  ? refundError.message
                  : String(refundError),
            });
          }
        }

        const errorMessage = `Error fetching web content: ${
          error instanceof Error ? error.message : String(error)
        }`;
        console.error("[Tool Error] fetch_web", {
          toolName: "fetch_web",
          error: error instanceof Error ? error.message : String(error),
          arguments: { url },
        });
        return errorMessage;
      }
    },
  });
}
