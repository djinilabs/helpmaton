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
import { getWorkspaceSubscription } from "../../utils/subscriptionUtils";
import {
  tavilySearch,
  tavilyExtract,
  extractCreditsUsed,
} from "../../utils/tavily";
import {
  reserveTavilyCredits,
  adjustTavilyCreditReservation,
  refundTavilyCredits,
} from "../../utils/tavilyCredits";

/**
 * Create Tavily search tool
 * Searches the web using Tavily search API
 */
export function createTavilySearchTool(workspaceId: string) {
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
    "Search the web using Tavily search API. This tool allows you to find current information, news, articles, and other web content. Use this when you need up-to-date information that isn't in your training data or when you need to find specific websites or resources. CRITICAL REQUIREMENTS: (1) You MUST provide the 'query' parameter - it is REQUIRED and cannot be empty. (2) The 'query' parameter must be a non-empty string containing what you want to search for. (3) The 'max_results' parameter is optional (defaults to 5 if not provided). (4) When the user asks you to search for something, IMMEDIATELY call this tool with the required 'query' parameter. Example: If user says 'search for latest AI news', call tavily_search with {query: 'latest AI news'}. Example: If user wants 10 results, call tavily_search with {query: 'Python tutorials', max_results: 10}. The search results include titles, URLs, content snippets, and relevance scores.";

  return tool({
    description,
    parameters: searchParamsSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      // Validate required parameters
      if (!args || typeof args !== "object") {
        return "Error: tavily_search requires a 'query' parameter. Please provide a search query string.";
      }

      const typedArgs = args as SearchArgs;
      const { query, max_results } = typedArgs;

      // Validate query parameter
      if (!query || typeof query !== "string" || query.trim().length === 0) {
        return "Error: tavily_search requires a non-empty 'query' parameter. Please provide a search query string. Example: {query: 'latest news about AI'}";
      }

      // Log tool call
      console.log("[Tool Call] tavily_search", {
        toolName: "tavily_search",
        arguments: { query, max_results },
        workspaceId,
      });

      const db = await database();
      let reservationId: string | undefined;

      try {
        // Check daily limit
        const limitCheck = await checkTavilyDailyLimit(workspaceId);
        const { withinFreeLimit, callCount } = limitCheck;

        console.log("[tavily_search] Daily limit check:", {
          workspaceId,
          withinFreeLimit,
          callCount,
        });

        // Reserve credits if exceeding free tier limit
        if (!withinFreeLimit) {
          // Get subscription to check if it's a paid tier
          const subscription = await getWorkspaceSubscription(workspaceId);
          if (subscription && subscription.plan !== "free") {
            // Paid tier: reserve credits for the call
            const reservation = await reserveTavilyCredits(
              db,
              workspaceId,
              1, // Estimate: 1 credit per call
              3 // maxRetries
            );
            reservationId = reservation.reservationId;
            console.log("[tavily_search] Reserved credits:", {
              workspaceId,
              reservationId,
              reservedAmount: reservation.reservedAmount,
            });
          } else {
            // This shouldn't happen (checkTavilyDailyLimit should throw for free tier)
            throw new Error(
              "Daily Tavily API call limit exceeded. Free tier allows 10 calls per 24 hours."
            );
          }
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
          console.error("[tavily_search] Failed to track Tavily API call usage", {
            workspaceId,
            reservationId,
            error: trackingError,
          });
          // Continue execution - tracking failure is a logging issue, not a correctness issue
        }

        // Adjust credits if we reserved them
        // Note: reservationId is only set for paid tiers that exceeded free limit and reserved credits
        if (reservationId && reservationId !== "byok" && reservationId !== "zero-cost") {
          await adjustTavilyCreditReservation(
            db,
            reservationId,
            workspaceId,
            actualCreditsUsed,
            3 // maxRetries
          );
          console.log("[tavily_search] Adjusted credits:", {
            workspaceId,
            reservationId,
            actualCreditsUsed,
          });
        }

        // Format search results
        const results = searchResponse.results || [];
        let resultText = `Found ${results.length} search result${results.length !== 1 ? "s" : ""} for "${query}":\n\n`;

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

        // Log tool result
        console.log("[Tool Result] tavily_search", {
          toolName: "tavily_search",
          resultCount: results.length,
          creditsUsed: actualCreditsUsed,
        });

        return resultText;
      } catch (error) {
        // Refund credits if API call failed and we reserved them
        if (reservationId && reservationId !== "byok" && reservationId !== "zero-cost") {
          try {
            await refundTavilyCredits(db, reservationId, workspaceId, 3);
            console.log("[tavily_search] Refunded credits due to error:", {
              workspaceId,
              reservationId,
            });
          } catch (refundError) {
            console.error("[tavily_search] Error refunding credits:", {
              workspaceId,
              reservationId,
              error: refundError instanceof Error ? refundError.message : String(refundError),
            });
          }
        }

        const errorMessage = `Error searching with Tavily: ${
          error instanceof Error ? error.message : String(error)
        }`;
        console.error("[Tool Error] tavily_search", {
          toolName: "tavily_search",
          error: error instanceof Error ? error.message : String(error),
          arguments: { query, max_results },
        });
        return errorMessage;
      }
    },
  });
}

/**
 * Create Tavily fetch tool
 * Extracts and summarizes content from a URL using Tavily extract API
 */
export function createTavilyFetchTool(workspaceId: string) {
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
    "Extract and summarize content from a web page URL using Tavily extract API. This tool allows you to get the main content, title, and metadata from any web page. Use this when you need to read and understand the content of a specific webpage. CRITICAL REQUIREMENTS: (1) You MUST provide the 'url' parameter - it is REQUIRED and cannot be empty. (2) The 'url' parameter must be a valid URL starting with http:// or https://. (3) When the user asks you to fetch or read content from a URL, IMMEDIATELY call this tool with the required 'url' parameter. Example: If user says 'fetch content from https://example.com/article', call tavily_fetch with {url: 'https://example.com/article'}. Example: If user provides a URL, call tavily_fetch with {url: 'https://news.example.com/story'}. The tool extracts the main text content, title, and optionally images from the page.";

  return tool({
    description,
    parameters: fetchParamsSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      // Validate required parameters
      if (!args || typeof args !== "object") {
        return "Error: tavily_fetch requires a 'url' parameter. Please provide a valid URL string.";
      }

      const typedArgs = args as FetchArgs;
      const { url } = typedArgs;

      // Validate url parameter
      if (!url || typeof url !== "string" || url.trim().length === 0) {
        return "Error: tavily_fetch requires a non-empty 'url' parameter. Please provide a valid URL starting with http:// or https://. Example: {url: 'https://example.com/article'}";
      }

      // Basic URL validation
      try {
        new URL(url);
      } catch {
        return "Error: tavily_fetch requires a valid URL. The 'url' parameter must be a valid URL starting with http:// or https://. Example: {url: 'https://example.com/article'}";
      }

      // Log tool call
      console.log("[Tool Call] tavily_fetch", {
        toolName: "tavily_fetch",
        arguments: { url },
        workspaceId,
      });

      const db = await database();
      let reservationId: string | undefined;

      try {
        // Check daily limit
        const limitCheck = await checkTavilyDailyLimit(workspaceId);
        const { withinFreeLimit, callCount } = limitCheck;

        console.log("[tavily_fetch] Daily limit check:", {
          workspaceId,
          withinFreeLimit,
          callCount,
        });

        // Reserve credits if exceeding free tier limit
        if (!withinFreeLimit) {
          // Get subscription to check if it's a paid tier
          const subscription = await getWorkspaceSubscription(workspaceId);
          if (subscription && subscription.plan !== "free") {
            // Paid tier: reserve credits for the call
            const reservation = await reserveTavilyCredits(
              db,
              workspaceId,
              1, // Estimate: 1 credit per call
              3 // maxRetries
            );
            reservationId = reservation.reservationId;
            console.log("[tavily_fetch] Reserved credits:", {
              workspaceId,
              reservationId,
              reservedAmount: reservation.reservedAmount,
            });
          } else {
            // This shouldn't happen (checkTavilyDailyLimit should throw for free tier)
            throw new Error(
              "Daily Tavily API call limit exceeded. Free tier allows 10 calls per 24 hours."
            );
          }
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
          console.error("[tavily_fetch] Failed to track Tavily API call usage", {
            workspaceId,
            reservationId,
            error: trackingError,
          });
          // Continue execution - tracking failure is a logging issue, not a correctness issue
        }

        // Adjust credits if we reserved them
        // Note: reservationId is only set for paid tiers that exceeded free limit and reserved credits
        if (reservationId && reservationId !== "byok" && reservationId !== "zero-cost") {
          await adjustTavilyCreditReservation(
            db,
            reservationId,
            workspaceId,
            actualCreditsUsed,
            3 // maxRetries
          );
          console.log("[tavily_fetch] Adjusted credits:", {
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

        // Log tool result
        console.log("[Tool Result] tavily_fetch", {
          toolName: "tavily_fetch",
          url,
          creditsUsed: actualCreditsUsed,
        });

        return resultText;
      } catch (error) {
        // Refund credits if API call failed and we reserved them
        if (reservationId && reservationId !== "byok" && reservationId !== "zero-cost") {
          try {
            await refundTavilyCredits(db, reservationId, workspaceId, 3);
            console.log("[tavily_fetch] Refunded credits due to error:", {
              workspaceId,
              reservationId,
            });
          } catch (refundError) {
            console.error("[tavily_fetch] Error refunding credits:", {
              workspaceId,
              reservationId,
              error: refundError instanceof Error ? refundError.message : String(refundError),
            });
          }
        }

        const errorMessage = `Error fetching content with Tavily: ${
          error instanceof Error ? error.message : String(error)
        }`;
        console.error("[Tool Error] tavily_fetch", {
          toolName: "tavily_fetch",
          error: error instanceof Error ? error.message : String(error),
          arguments: { url },
        });
        return errorMessage;
      }
    },
  });
}

