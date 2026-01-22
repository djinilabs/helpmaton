/**
 * Tavily API tools for agents
 * Provides search and fetch tools with daily limit checks and credit management
 */

import { tool } from "ai";
import { z } from "zod";

import { database } from "../../tables/database";
import { jinaFetch, jinaSearch } from "../../utils/jina";
import {
  checkTavilyDailyLimit,
  incrementSearchRequestBucket,
  incrementFetchRequestBucket,
} from "../../utils/requestTracking";
import { Sentry, ensureError } from "../../utils/sentry";
import {
  tavilySearch,
  tavilyExtract,
  extractCreditsUsed,
} from "../../utils/tavily";
import {
  reserveTavilyCredits,
  adjustTavilyCreditReservation,
  calculateTavilyCost,
} from "../../utils/tavilyCredits";
import { generateScrapeAuthToken } from "../../utils/tokenUtils";
import type { AugmentedContext } from "../../utils/workspaceCreditContext";

import { getScrapeFunctionUrl } from "./scrapeUrl";

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
    execute: async (args: any, { abortSignal }: { abortSignal?: AbortSignal } = {}) => {
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
          signal: abortSignal,
        });

        // Extract usage from API response
        const actualCreditsUsed = extractCreditsUsed(searchResponse);

        // Track the call (after successful API call - we only track successful calls)
        // If tracking fails, log error but don't fail the tool call since API succeeded
        try {
          await incrementSearchRequestBucket(workspaceId);
        } catch (trackingError) {
          console.error("[search_web] Failed to track Tavily API call usage", {
            workspaceId,
            reservationId,
            error: trackingError,
          });
          Sentry.captureException(ensureError(trackingError), {
            tags: {
              context: "tavily-tools",
              operation: "track-tavily-call",
              tool: "search_web",
            },
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
          reservationId !== "zero-cost" &&
          reservationId !== "deduction-disabled"
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
        // Use improved marker format: __HM_TOOL_COST__:8000 (less likely to conflict with content)
        const costUsd = calculateTavilyCost(actualCreditsUsed);
        resultText += `\n\n__HM_TOOL_COST__:${costUsd}`;

        // Log tool result
        console.log("[Tool Result] search_web", {
          toolName: "search_web",
          resultCount: results.length,
          creditsUsed: actualCreditsUsed,
          costUsd,
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
            console.log("[search_web] Removed reservation after error:", {
              workspaceId,
              reservationId,
            });
          } catch (cleanupError) {
            console.error("[search_web] Error removing reservation:", {
              workspaceId,
              reservationId,
              error:
                cleanupError instanceof Error
                  ? cleanupError.message
                  : String(cleanupError),
            });
            Sentry.captureException(ensureError(cleanupError), {
              tags: {
                context: "tavily-tools",
                operation: "cleanup-reservation",
                tool: "search_web",
              },
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
        "REQUIRED: The URL to extract content from. This MUST be a valid URL starting with http:// or https://. Example: 'https://example.com/article. It can also be a JSON or markdown URL.'"
      ),
  });

  type FetchArgs = z.infer<typeof fetchParamsSchema>;

  const description =
    "Extract and summarize content from a web page URL using Tavily extract API. This tool allows you to get the main content, title, and metadata from any web resource, being HTML, JSON or markdown. Use this when you need to read and understand the content of a specific URL. CRITICAL REQUIREMENTS: (1) You MUST provide the 'url' parameter - it is REQUIRED and cannot be empty. (2) The 'url' parameter must be a valid URL starting with http:// or https://. (3) When the user asks you to fetch or read content from a URL, IMMEDIATELY call this tool with the required 'url' parameter. Example: If user says 'fetch content from https://example.com/article', call fetch_url with {url: 'https://example.com/article'}. Example: If user provides a URL, call fetch_url with {url: 'https://news.example.com/story'}. The tool extracts the main text content, title, and optionally images from the page.";

  return tool({
    description,
    parameters: fetchParamsSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any, { abortSignal }: { abortSignal?: AbortSignal } = {}) => {
      // Validate required parameters
      if (!args || typeof args !== "object") {
        return "Error: fetch_url requires a 'url' parameter. Please provide a valid URL string.";
      }

      const typedArgs = args as FetchArgs;
      const { url } = typedArgs;

      // Validate url parameter
      if (!url || typeof url !== "string" || url.trim().length === 0) {
        return "Error: fetch_url requires a non-empty 'url' parameter. Please provide a valid URL starting with http:// or https://. Example: {url: 'https://example.com/article'}";
      }

      // Basic URL validation
      try {
        new URL(url);
      } catch {
        return "Error: fetch_url requires a valid URL. The 'url' parameter must be a valid URL starting with http:// or https://. Example: {url: 'https://example.com/article'}";
      }

      // Log tool call
      console.log("[Tool Call] fetch_url", {
        toolName: "fetch_url",
        arguments: { url },
        workspaceId,
      });

      const db = await database();
      let reservationId: string | undefined;

      try {
        // Check daily limit
        const limitCheck = await checkTavilyDailyLimit(workspaceId);
        const { withinFreeLimit, callCount } = limitCheck;

        console.log("[fetch_url] Daily limit check:", {
          workspaceId,
          withinFreeLimit,
          callCount,
        });

        const shouldReserveCredits = !withinFreeLimit;

        if (shouldReserveCredits) {
          if (!context) {
            throw new Error(
              "Context not available for Tavily credit transactions (fetch_url)"
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
          console.log("[fetch_url] Reserved credits:", {
            workspaceId,
            reservationId,
            reservedAmount: reservation.reservedAmount,
          });
        }

        // Make Tavily API call
        const extractResponse = await tavilyExtract(url, {
          signal: abortSignal,
        });

        // Extract usage from API response
        const actualCreditsUsed = extractCreditsUsed(extractResponse);

        // Track the call (after successful API call - we only track successful calls)
        // If tracking fails, log error but don't fail the tool call since API succeeded
        try {
          await incrementFetchRequestBucket(workspaceId);
        } catch (trackingError) {
          console.error("[fetch_url] Failed to track Tavily API call usage", {
            workspaceId,
            reservationId,
            error: trackingError,
          });
          Sentry.captureException(ensureError(trackingError), {
            tags: {
              context: "tavily-tools",
              operation: "track-tavily-call",
              tool: "fetch_url",
            },
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
            tool_call: "fetch_url",
            description: `Tavily API call: fetch_url - actual cost (free tier)`,
            amountMillionthUsd: -actualCost, // Negative for debit (deducting from workspace)
          });
          console.log("[fetch_url] Created transaction for free tier:", {
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
          reservationId !== "zero-cost" &&
          reservationId !== "deduction-disabled"
        ) {
          if (!context) {
            throw new Error(
              "Context not available for Tavily credit transactions (fetch_url adjustment)"
            );
          }
          await adjustTavilyCreditReservation(
            db,
            reservationId,
            workspaceId,
            actualCreditsUsed,
            context,
            "fetch_url",
            3, // maxRetries
            agentId,
            conversationId
          );
          console.log("[fetch_url] Adjusted credits:", {
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
        // Use improved marker format: __HM_TOOL_COST__:8000 (less likely to conflict with content)
        const costUsd = calculateTavilyCost(actualCreditsUsed);
        resultText += `\n\n__HM_TOOL_COST__:${costUsd}`;

        // Log tool result
        console.log("[Tool Result] fetch_url", {
          toolName: "fetch_url",
          url,
          creditsUsed: actualCreditsUsed,
          costUsd,
        });

        return resultText;
      } catch (error) {
        // Do not refund on tool failures; consume reservation instead
        if (
          reservationId &&
          reservationId !== "byok" &&
          reservationId !== "zero-cost"
        ) {
          try {
            await db["credit-reservations"].delete(
              `credit-reservations/${reservationId}`
            );
            console.log("[fetch_url] Removed reservation after error:", {
              workspaceId,
              reservationId,
            });
          } catch (cleanupError) {
            console.error("[fetch_url] Error removing reservation:", {
              workspaceId,
              reservationId,
              error:
                cleanupError instanceof Error
                  ? cleanupError.message
                  : String(cleanupError),
            });
            Sentry.captureException(ensureError(cleanupError), {
              tags: {
                context: "tavily-tools",
                operation: "cleanup-reservation",
                tool: "fetch_url",
              },
            });
          }
        }

        const errorMessage = `Error fetching web content: ${
          error instanceof Error ? error.message : String(error)
        }`;
        console.error("[Tool Error] fetch_url", {
          toolName: "fetch_url",
          error: error instanceof Error ? error.message : String(error),
          arguments: { url },
        });
        return errorMessage;
      }
    },
  });
}

/**
 * Create web fetch tool using Jina Reader API
 * Extracts and summarizes content from a URL using Jina.ai
 * @param workspaceId - Workspace ID
 * @param agentId - Agent ID (optional, for logging)
 * @param conversationId - Conversation ID (optional, for logging)
 */
export function createJinaFetchTool(
  workspaceId: string,
  agentId?: string,
  conversationId?: string
) {
  const fetchParamsSchema = z.object({
    url: z
      .string()
      .url("url must be a valid URL")
      .describe(
        "REQUIRED: The URL to extract content from. This MUST be a valid URL starting with http:// or https://. Example: 'https://example.com/article'. It can also be a JSON or markdown URL."
      ),
  });

  type FetchArgs = z.infer<typeof fetchParamsSchema>;

  const description =
    "Extract and summarize content from a URL using Jina Reader API. This tool allows you to get the main content and title from any web resource, being HTML, JSON or markdown. Use this when you need to read and understand the content of a specific URL. CRITICAL REQUIREMENTS: (1) You MUST provide the 'url' parameter - it is REQUIRED and cannot be empty. (2) The 'url' parameter must be a valid URL starting with http:// or https://. (3) When the user asks you to fetch or read content from a URL, IMMEDIATELY call this tool with the required 'url' parameter. Example: If user says 'fetch content from https://example.com/article', call fetch_url with {url: 'https://example.com/article'}. Example: If user provides a URL, call fetch_url with {url: 'https://news.example.com/story'}. The tool extracts the main text content and title from the page. Note: This tool is free to use (no credits charged).";

  return tool({
    description,
    parameters: fetchParamsSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any, { abortSignal }: { abortSignal?: AbortSignal } = {}) => {
       
      void abortSignal;
      // Validate required parameters
      if (!args || typeof args !== "object") {
        return "Error: fetch_url requires a 'url' parameter. Please provide a valid URL string.";
      }

      const typedArgs = args as FetchArgs;
      const { url } = typedArgs;

      // Validate url parameter
      if (!url || typeof url !== "string" || url.trim().length === 0) {
        return "Error: fetch_url requires a non-empty 'url' parameter. Please provide a valid URL starting with http:// or https://. Example: {url: 'https://example.com/article'}";
      }

      // Basic URL validation
      try {
        new URL(url);
      } catch {
        return "Error: fetch_url requires a valid URL. The 'url' parameter must be a valid URL starting with http:// or https://. Example: {url: 'https://example.com/article'}";
      }

      // Log tool call
      console.log("[Tool Call] fetch_url (Jina)", {
        toolName: "fetch_url",
        provider: "jina",
        arguments: { url },
        workspaceId,
        agentId,
        conversationId,
      });

      try {
        // Make Jina API call (no credit tracking needed - Jina is free)
        // Note: abortSignal not yet supported by jinaFetch, but parameter is kept for future compatibility
        const fetchResponse = await jinaFetch(url);

        // Format extracted content
        let resultText = `**Content extracted from ${url}:**\n\n`;

        if (fetchResponse.title) {
          resultText += `**Title:** ${fetchResponse.title}\n\n`;
        }

        resultText += `**Content:**\n${fetchResponse.content}\n`;

        // Jina is free, so no cost tracking
        // No [TOOL_COST:...] tag needed

        // Log tool result
        console.log("[Tool Result] fetch_url (Jina)", {
          toolName: "fetch_url",
          provider: "jina",
          url,
          workspaceId,
          agentId,
          conversationId,
        });

        return resultText;
      } catch (error) {
        const errorMessage = `Error fetching web content: ${
          error instanceof Error ? error.message : String(error)
        }`;
        console.error("[Tool Error] fetch_url (Jina)", {
          toolName: "fetch_url",
          provider: "jina",
          error: error instanceof Error ? error.message : String(error),
          arguments: { url },
          workspaceId,
          agentId,
          conversationId,
        });
        return errorMessage;
      }
    },
  });
}

/**
 * Create web search tool using Jina DeepSearch API
 * Searches the web for current information (free, no credits)
 * @param workspaceId - Workspace ID
 * @param agentId - Agent ID (optional, for logging)
 * @param conversationId - Conversation ID (optional, for logging)
 */
export function createJinaSearchTool(
  workspaceId: string,
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
    "Search the web for current information, news, articles, and other web content using Jina Search API. Use this when you need up-to-date information that isn't in your training data or when you need to find specific websites or resources. CRITICAL REQUIREMENTS: (1) You MUST provide the 'query' parameter - it is REQUIRED and cannot be empty. (2) The 'query' parameter must be a non-empty string containing what you want to search for. (3) The 'max_results' parameter is optional (defaults to 5 if not provided). (4) When the user asks you to search for something, IMMEDIATELY call this tool with the required 'query' parameter. Example: If user says 'search for latest AI news', call search_web with {query: 'latest AI news'}. Example: If user wants 10 results, call search_web with {query: 'Python tutorials', max_results: 10}. The search results include titles, URLs, and content snippets. Note: This tool is free to use (no credits charged).";

  return tool({
    description,
    parameters: searchParamsSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any, { abortSignal }: { abortSignal?: AbortSignal } = {}) => {
       
      void abortSignal;
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
      console.log("[Tool Call] search_web (Jina)", {
        toolName: "search_web",
        provider: "jina",
        arguments: { query, max_results },
        workspaceId,
        agentId,
        conversationId,
      });

      try {
        // Make Jina API call (no credit tracking needed - Jina is free)
        // Note: abortSignal not yet supported by jinaSearch, but parameter is kept for future compatibility
        const searchResponse = await jinaSearch(query, {
          max_results,
        });

        // Format search results
        const results = searchResponse.results || [];
        let resultText = `Found ${results.length} search result${
          results.length !== 1 ? "s" : ""
        } for "${query}":\n\n`;

        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          resultText += `${i + 1}. **${result.title}**\n`;
          if (result.url) {
            resultText += `   URL: ${result.url}\n`;
          }
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

        // Jina is free, so no cost tracking
        // No [TOOL_COST:...] tag needed

        // Log tool result
        console.log("[Tool Result] search_web (Jina)", {
          toolName: "search_web",
          provider: "jina",
          resultCount: results.length,
          workspaceId,
          agentId,
          conversationId,
        });

        return resultText;
      } catch (error) {
        const errorMessage = `Error searching the web: ${
          error instanceof Error ? error.message : String(error)
        }`;
        console.error("[Tool Error] search_web (Jina)", {
          toolName: "search_web",
          provider: "jina",
          error: error instanceof Error ? error.message : String(error),
          arguments: { query, max_results },
          workspaceId,
          agentId,
          conversationId,
        });
        return errorMessage;
      }
    },
  });
}

/**
 * Create web fetch tool using Puppeteer scrape endpoint
 * Scrapes web pages using Puppeteer with residential proxies and returns AOM as XML
 * @param workspaceId - Workspace ID
 * @param context - Augmented Lambda context (optional, not used for transactions since endpoint handles them)
 * @param agentId - Agent ID (optional, for logging)
 * @param conversationId - Conversation ID (optional, for logging)
 */
export function createScrapeFetchTool(
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
        "REQUIRED: The URL to scrape. This MUST be a valid URL starting with http:// or https://. Example: 'https://example.com/article'"
      ),
  });

  type FetchArgs = z.infer<typeof fetchParamsSchema>;

  const description =
    "Scrape web pages using Puppeteer with residential proxies to extract Accessibility Object Model (AOM) as XML. This tool allows you to get the full content structure from any web page, including JavaScript-rendered content. The service uses stealth techniques to avoid detection and attempts to solve captchas automatically. IMPORTANT: This service can take significantly longer to fetch content compared to other providers (may take 30-60 seconds or more) due to the stealth measures and captcha solving. Use this when you need to read and understand the complete structure and content of a specific URL. CRITICAL REQUIREMENTS: (1) You MUST provide the 'url' parameter - it is REQUIRED and cannot be empty. (2) The 'url' parameter must be a valid URL starting with http:// or https://. (3) When the user asks you to scrape or fetch content from a URL, IMMEDIATELY call this tool with the required 'url' parameter. Example: If user says 'scrape https://example.com/article', call fetch_url with {url: 'https://example.com/article'}. The tool uses residential proxies to access web pages and returns the AOM (Accessibility Object Model) structure as XML. Cost: $0.005 per call.";

  return tool({
    description,
    parameters: fetchParamsSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any, { abortSignal }: { abortSignal?: AbortSignal } = {}) => {
       
      void abortSignal;
      // Validate required parameters
      if (!args || typeof args !== "object") {
        return "Error: fetch_url requires a 'url' parameter. Please provide a valid URL string.";
      }

      const typedArgs = args as FetchArgs;
      const { url } = typedArgs;

      // Validate url parameter
      if (!url || typeof url !== "string" || url.trim().length === 0) {
        return "Error: fetch_url requires a non-empty 'url' parameter. Please provide a valid URL starting with http:// or https://. Example: {url: 'https://example.com/article'}";
      }

      // Basic URL validation
      try {
        new URL(url);
      } catch {
        return "Error: fetch_url requires a valid URL. The 'url' parameter must be a valid URL starting with http:// or https://. Example: {url: 'https://example.com/article'}";
      }

      // Validate required IDs for token generation
      const missingParams: string[] = [];
      if (!workspaceId) missingParams.push("workspaceId");
      if (!agentId) missingParams.push("agentId");
      if (!conversationId) missingParams.push("conversationId");
      
      if (missingParams.length > 0) {
        const missingList = missingParams.join(", ");
        console.error("[Tool Error] fetch_url (Scrape) - Missing required context:", {
          missingParams,
          workspaceId: workspaceId || "MISSING",
          agentId: agentId || "MISSING",
          conversationId: conversationId || "MISSING",
        });
        return `Error: Missing required context (${missingList}) for scrape authentication. The scrape tool requires workspaceId, agentId, and conversationId to generate authentication tokens.`;
      }

      // At this point, TypeScript knows these are strings due to the validation above
      // but we need to assert for type safety
      const validAgentId = agentId as string;
      const validConversationId = conversationId as string;

      // Log tool call
      console.log("[Tool Call] fetch_url (Scrape)", {
        toolName: "fetch_url",
        provider: "scrape",
        arguments: { url },
        workspaceId,
        agentId: validAgentId,
        conversationId: validConversationId,
      });

      try {
        // Generate JWE token for authentication
        // Note: abortSignal not yet supported by scrape endpoint, but parameter is kept for future compatibility
        const authToken = await generateScrapeAuthToken(
          workspaceId,
          validAgentId,
          validConversationId
        );

        // Get scrape URL (Function URL in deployed environments, API Gateway URL in local dev)
        const scrapeUrl = await getScrapeFunctionUrl();

        // Make POST request to scrape endpoint
        const response = await fetch(scrapeUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ url }),
        });

        // Handle response
        if (!response.ok) {
          const errorText = await response.text();
          let errorMessage = `Error scraping web page: HTTP ${response.status}`;
          try {
            const errorJson = JSON.parse(errorText);
            if (errorJson.message) {
              errorMessage = `Error scraping web page (HTTP ${response.status}): ${errorJson.message}`;
            } else if (errorJson.error) {
              errorMessage = `Error scraping web page (HTTP ${response.status}): ${errorJson.error}`;
            }
          } catch {
            // If error response is not JSON, use the text as-is
            if (errorText) {
              errorMessage = `Error scraping web page (HTTP ${response.status}): ${errorText}`;
            }
          }
          console.error("[Tool Error] fetch_url (Scrape)", {
            toolName: "fetch_url",
            provider: "scrape",
            error: errorMessage,
            status: response.status,
            url,
            workspaceId,
            agentId: validAgentId,
            conversationId: validConversationId,
          });
          return errorMessage;
        }

        // Parse XML response
        const xmlContent = await response.text();

        // Format result for the agent
        let resultText = `**Content scraped from ${url}:**\n\n`;
        resultText += `**AOM (Accessibility Object Model) XML:**\n\`\`\`xml\n${xmlContent}\n\`\`\`\n`;

        // Add cost marker (0.005 USD = 5000 millionths) for tracking/display only
        // IMPORTANT: The scrape endpoint already charges credits directly via reserveCredits(),
        // so this marker is ONLY for cost tracking/display in the test endpoint UI.
        // It does NOT cause additional credit deduction - credits are charged once at the endpoint level.
        resultText += `\n\n__HM_TOOL_COST__:5000`;

        // Log tool result
        console.log("[Tool Result] fetch_url (Scrape)", {
          toolName: "fetch_url",
          provider: "scrape",
          url,
          xmlLength: xmlContent.length,
          workspaceId,
          agentId: validAgentId,
          conversationId: validConversationId,
        });

        return resultText;
      } catch (error) {
        const errorMessage = `Error scraping web content: ${
          error instanceof Error ? error.message : String(error)
        }`;
        console.error("[Tool Error] fetch_url (Scrape)", {
          toolName: "fetch_url",
          provider: "scrape",
          error: error instanceof Error ? error.message : String(error),
          arguments: { url },
          workspaceId,
          agentId: validAgentId,
          conversationId: validConversationId,
        });
        return errorMessage;
      }
    },
  });
}
