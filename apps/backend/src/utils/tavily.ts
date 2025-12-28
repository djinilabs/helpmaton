/**
 * Tavily API client utility
 * Provides functions for calling Tavily search and extract APIs
 * Uses the official @tavily/core library with backward-compatible interface
 */

import { tavily as createTavilyClient } from "@tavily/core";
import type {
  TavilySearchResponse as LibrarySearchResponse,
  TavilyExtractResponse as LibraryExtractResponse,
  TavilySearchOptions as LibrarySearchOptions,
  TavilyExtractOptions as LibraryExtractOptions,
} from "@tavily/core";

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 10000;
const RETRY_MULTIPLIER = 2;

export interface TavilySearchOptions {
  max_results?: number;
  search_depth?: "basic" | "advanced";
  include_answer?: boolean;
  include_raw_content?: boolean;
  include_images?: boolean;
}

export interface TavilySearchResponse {
  query: string;
  response_time: number;
  answer?: string;
  images?: string[];
  results: Array<{
    title: string;
    url: string;
    content: string;
    score: number;
    raw_content?: string;
  }>;
  usage?: {
    credits_used?: number;
  };
}

export interface TavilyExtractOptions {
  include_images?: boolean;
  include_raw_content?: boolean;
}

export interface TavilyExtractResponse {
  url: string;
  title?: string;
  content: string;
  images?: string[];
  raw_content?: string;
  usage?: {
    credits_used?: number;
  };
}

/**
 * Get Tavily API key from environment
 */
function getTavilyApiKey(): string {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error(
      "TAVILY_API_KEY environment variable is not set. Please configure it to use Tavily tools."
    );
  }
  return apiKey;
}

/**
 * Get or create Tavily client instance
 * Note: API key validation should be done before calling this function
 */
let tavilyClient: ReturnType<typeof createTavilyClient> | null = null;

function getTavilyClient() {
  if (!tavilyClient) {
    const apiKey = getTavilyApiKey();
    tavilyClient = createTavilyClient({ apiKey });
  }
  return tavilyClient;
}

/**
 * Reset client instance (useful for testing)
 * @internal
 */
export function resetTavilyClient() {
  tavilyClient = null;
}

/**
 * Sleep utility with timeout support
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Operation aborted"));
      return;
    }

    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
      resolve();
    }, ms);

    const onAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(new Error("Operation aborted"));
    };

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/**
 * Check if error is retryable (rate limit, network error, etc.)
 */
function isRetryableError(error: Error): boolean {
  const errorMessage = error.message.toLowerCase();
  const errorName = error.name.toLowerCase();

  // Rate limit errors (429)
  if (
    errorMessage.includes("429") ||
    errorMessage.includes("rate limit") ||
    errorMessage.includes("too many requests")
  ) {
    return true;
  }

  // Server errors (5xx)
  if (
    errorMessage.includes("500") ||
    errorMessage.includes("502") ||
    errorMessage.includes("503") ||
    errorMessage.includes("504") ||
    errorMessage.includes("server error")
  ) {
    return true;
  }

  // Network/timeout errors
  if (
    errorMessage.includes("timeout") ||
    errorMessage.includes("network") ||
    errorMessage.includes("econnreset") ||
    errorMessage.includes("enotfound") ||
    errorMessage.includes("fetch") ||
    errorName === "aborterror"
  ) {
    return true;
  }

  return false;
}

/**
 * Convert library search response to our format
 */
function convertSearchResponse(
  libResponse: LibrarySearchResponse
): TavilySearchResponse {
  return {
    query: libResponse.query,
    response_time: libResponse.responseTime,
    answer: libResponse.answer,
    images: libResponse.images?.map((img) => img.url),
    results: libResponse.results.map((result) => ({
      title: result.title,
      url: result.url,
      content: result.content,
      score: result.score,
      raw_content: result.rawContent,
    })),
    usage: libResponse.usage
      ? {
          credits_used: libResponse.usage.credits,
        }
      : undefined,
  };
}

/**
 * Convert library extract response to our format
 */
function convertExtractResponse(
  libResponse: LibraryExtractResponse,
  requestedUrl: string
): TavilyExtractResponse {
  // Library returns array of results, we need the first one for the requested URL
  const result = libResponse.results.find((r) => r.url === requestedUrl);

  if (!result) {
    // If no result found, check failed results
    const failedResult = libResponse.failedResults.find(
      (r) => r.url === requestedUrl
    );
    if (failedResult) {
      throw new Error(
        `Tavily extract API error: Failed to extract ${requestedUrl}: ${failedResult.error}`
      );
    }
    // If still not found, use first result or throw
    if (libResponse.results.length === 0) {
      throw new Error(
        `Tavily extract API error: No results returned for ${requestedUrl}`
      );
    }
    // Use first result as fallback
    const firstResult = libResponse.results[0];
    return {
      url: firstResult.url,
      content: firstResult.rawContent,
      images: firstResult.images,
      raw_content: firstResult.rawContent,
      usage: libResponse.usage
        ? {
            credits_used: libResponse.usage.credits,
          }
        : undefined,
    };
  }

  // Extract title from rawContent if possible (library doesn't provide title separately)
  // For now, we'll leave title undefined as the library doesn't provide it
  return {
    url: result.url,
    content: result.rawContent,
    images: result.images,
    raw_content: result.rawContent,
    usage: libResponse.usage
      ? {
          credits_used: libResponse.usage.credits,
        }
      : undefined,
  };
}

/**
 * Call Tavily search API with retry logic
 */
export async function tavilySearch(
  query: string,
  options?: TavilySearchOptions
): Promise<TavilySearchResponse> {
  // Check API key first (before creating client)
  getTavilyApiKey();
  const client = getTavilyClient();

  // Map our options to library format
  const libraryOptions: LibrarySearchOptions = {
    maxResults: options?.max_results ?? 5,
    searchDepth: options?.search_depth ?? "basic",
    includeAnswer: options?.include_answer ?? false,
    includeRawContent: options?.include_raw_content ? "text" : false,
    includeImages: options?.include_images ?? false,
    includeUsage: true,
  };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Call library with timeout handling
      const searchResult = await client.search(query, {
        ...libraryOptions,
        timeout: 30, // in seconds
        includeUsage: true,
      });

      // Convert library response to our format
      return convertSearchResponse(searchResult);
    } catch (error) {
      // If error message includes "Tavily search API error", it's a non-retryable API error - throw immediately
      if (
        error instanceof Error &&
        error.message.includes("Tavily search API error")
      ) {
        throw error;
      }

      // Check if it's an abort/timeout error
      if (
        error instanceof Error &&
        (error.name === "AbortError" ||
          error.message === "Operation aborted" ||
          error.message.includes("timeout"))
      ) {
        if (attempt < MAX_RETRIES) {
          const baseDelay = Math.min(
            INITIAL_RETRY_DELAY_MS * Math.pow(RETRY_MULTIPLIER, attempt),
            MAX_RETRY_DELAY_MS
          );
          const jitter = Math.random() * baseDelay * 0.2;
          const delay = baseDelay + jitter;

          console.log(
            `[tavilySearch] Timeout error, retrying in ${delay}ms (attempt ${
              attempt + 1
            }/${MAX_RETRIES + 1})`
          );

          await sleep(delay);
          lastError = error;
          continue;
        }
        throw new Error("Tavily search API request timeout");
      }

      // Check if it's a retryable error
      if (error instanceof Error && isRetryableError(error)) {
        if (attempt < MAX_RETRIES) {
          // Calculate delay with exponential backoff and jitter
          const baseDelay = Math.min(
            INITIAL_RETRY_DELAY_MS * Math.pow(RETRY_MULTIPLIER, attempt),
            MAX_RETRY_DELAY_MS
          );
          const jitter = Math.random() * baseDelay * 0.2;
          const delay = baseDelay + jitter;

          console.log(
            `[tavilySearch] Retryable error, retrying in ${delay}ms (attempt ${
              attempt + 1
            }/${MAX_RETRIES + 1}): ${error.message}`
          );

          await sleep(delay);
          lastError = error;
          continue;
        }
      }

      // If we've exhausted retries or it's a non-retryable error, throw
      if (attempt === MAX_RETRIES) {
        console.error(
          `[tavilySearch] Error after ${MAX_RETRIES} retries:`,
          error
        );
        if (error instanceof Error) {
          throw new Error(`Tavily search API error: ${error.message}`);
        }
        throw new Error(`Failed to call Tavily search API: ${String(error)}`);
      }

      lastError = error as Error;
    }
  }

  // If we get here, all retries were exhausted
  if (lastError) {
    throw new Error(`Tavily search API error: ${lastError.message}`);
  }
  throw new Error("Failed to call Tavily search API: Unknown error");
}

/**
 * Call Tavily extract API with retry logic
 */
export async function tavilyExtract(
  url: string,
  options?: TavilyExtractOptions
): Promise<TavilyExtractResponse> {
  // Check API key first (before creating client)
  getTavilyApiKey();
  const client = getTavilyClient();

  // Map our options to library format
  const libraryOptions: LibraryExtractOptions = {
    includeImages: options?.include_images ?? false,
    format: options?.include_raw_content ? "text" : undefined,
    includeUsage: true,
  };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Call library with timeout handling
      // Library expects array of URLs
      const extractResult = await client.extract([url], {
        ...libraryOptions,
        timeout: 30, // in seconds
        includeUsage: true,
      });

      console.log("Tavily extract API response:", extractResult);

      // Convert library response to our format
      return convertExtractResponse(extractResult, url);
    } catch (error) {
      // If error message includes "Tavily extract API error", it's a non-retryable API error - throw immediately
      if (
        error instanceof Error &&
        error.message.includes("Tavily extract API error")
      ) {
        throw error;
      }

      console.error("Tavily extract API error:", error);

      // Check if it's an abort/timeout error
      if (
        error instanceof Error &&
        (error.name === "AbortError" ||
          error.message === "Operation aborted" ||
          error.message.includes("timeout"))
      ) {
        if (attempt < MAX_RETRIES) {
          const baseDelay = Math.min(
            INITIAL_RETRY_DELAY_MS * Math.pow(RETRY_MULTIPLIER, attempt),
            MAX_RETRY_DELAY_MS
          );
          const jitter = Math.random() * baseDelay * 0.2;
          const delay = baseDelay + jitter;

          console.log(
            `[tavilyExtract] Timeout error, retrying in ${delay}ms (attempt ${
              attempt + 1
            }/${MAX_RETRIES + 1})`
          );

          await sleep(delay);
          lastError = error;
          continue;
        }
        throw new Error("Tavily extract API request timeout");
      }

      // Check if it's a retryable error
      if (error instanceof Error && isRetryableError(error)) {
        if (attempt < MAX_RETRIES) {
          // Calculate delay with exponential backoff and jitter
          const baseDelay = Math.min(
            INITIAL_RETRY_DELAY_MS * Math.pow(RETRY_MULTIPLIER, attempt),
            MAX_RETRY_DELAY_MS
          );
          const jitter = Math.random() * baseDelay * 0.2;
          const delay = baseDelay + jitter;

          console.log(
            `[tavilyExtract] Retryable error, retrying in ${delay}ms (attempt ${
              attempt + 1
            }/${MAX_RETRIES + 1}): ${error.message}`
          );

          await sleep(delay);
          lastError = error;
          continue;
        }
      }

      // If we've exhausted retries or it's a non-retryable error, throw
      if (attempt === MAX_RETRIES) {
        console.error(
          `[tavilyExtract] Error after ${MAX_RETRIES} retries:`,
          error
        );
        if (error instanceof Error) {
          throw new Error(`Tavily extract API error: ${error.message}`);
        }
        throw new Error(`Failed to call Tavily extract API: ${String(error)}`);
      }

      lastError = error as Error;
    }
  }

  // If we get here, all retries were exhausted
  if (lastError) {
    throw new Error(`Tavily extract API error: ${lastError.message}`);
  }
  throw new Error("Failed to call Tavily extract API: Unknown error");
}

/**
 * Extract credits used from Tavily API response
 * Returns the number of credits consumed, defaulting to 1 if not specified
 */
export function extractCreditsUsed(
  response: TavilySearchResponse | TavilyExtractResponse
): number {
  // Tavily API returns usage information in the response
  // Default to 1 credit per API call if not specified
  return response.usage?.credits_used ?? 1;
}
