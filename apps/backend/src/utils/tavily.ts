/**
 * Tavily API client utility
 * Provides functions for calling Tavily search and extract APIs
 */

const TAVILY_API_BASE_URL = "https://api.tavily.com";
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
function isRetryableError(status: number, errorText: string): boolean {
  // Rate limit errors
  if (status === 429) {
    return true;
  }

  // Server errors (5xx)
  if (status >= 500 && status < 600) {
    return true;
  }

  // Network/timeout errors
  if (
    errorText.toLowerCase().includes("timeout") ||
    errorText.toLowerCase().includes("network") ||
    errorText.toLowerCase().includes("econnreset") ||
    errorText.toLowerCase().includes("enotfound")
  ) {
    return true;
  }

  return false;
}

/**
 * Call Tavily search API
 */
export async function tavilySearch(
  query: string,
  options?: TavilySearchOptions
): Promise<TavilySearchResponse> {
  const apiKey = getTavilyApiKey();

  const requestBody = {
    query,
    max_results: options?.max_results ?? 5,
    search_depth: options?.search_depth ?? "basic",
    include_answer: options?.include_answer ?? false,
    include_raw_content: options?.include_raw_content ?? false,
    include_images: options?.include_images ?? false,
    include_usage: true,
  };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      const response = await fetch(`${TAVILY_API_BASE_URL}/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response) {
        throw new TypeError("fetch returned undefined response");
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `[tavilySearch] API error response: ${response.status} ${errorText}`
        );

        // Check if retryable and we have retries left
        if (
          isRetryableError(response.status, errorText) &&
          attempt < MAX_RETRIES
        ) {
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
            }/${MAX_RETRIES + 1})`
          );

          await sleep(delay);
          lastError = new Error(
            `Tavily API error: ${response.status} ${errorText}`
          );
          continue;
        }

        // Not retryable or no retries left
        throw new Error(
          `Tavily search API error: ${response.status} ${errorText}`
        );
      }

      const result = (await response.json()) as TavilySearchResponse;
      return result;
    } catch (error) {
      // If error message includes "Tavily search API error", it's a non-retryable API error - throw immediately
      if (
        error instanceof Error &&
        error.message.includes("Tavily search API error")
      ) {
        throw error;
      }

      // Check if it's an abort error
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Tavily search API request timeout");
      }
      if (error instanceof Error && error.message === "Operation aborted") {
        throw error;
      }

      // Check if it's a network/fetch error that might be retryable
      if (
        error instanceof TypeError &&
        (error.message.includes("fetch") ||
          error.message.includes("network") ||
          error.message.includes("timeout") ||
          error.message.includes("undefined"))
      ) {
        if (attempt < MAX_RETRIES) {
          const baseDelay = Math.min(
            INITIAL_RETRY_DELAY_MS * Math.pow(RETRY_MULTIPLIER, attempt),
            MAX_RETRY_DELAY_MS
          );
          const jitter = Math.random() * baseDelay * 0.2;
          const delay = baseDelay + jitter;

          console.log(
            `[tavilySearch] Network error, retrying in ${delay}ms (attempt ${
              attempt + 1
            }/${MAX_RETRIES + 1})`
          );

          await sleep(delay);
          lastError = error as Error;
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
          throw error;
        }
        throw new Error(`Failed to call Tavily search API: ${String(error)}`);
      }

      lastError = error as Error;
    }
  }

  // If we get here, all retries were exhausted
  if (lastError) {
    throw lastError;
  }
  throw new Error("Failed to call Tavily search API: Unknown error");
}

/**
 * Call Tavily extract API
 */
export async function tavilyExtract(
  url: string,
  options?: TavilyExtractOptions
): Promise<TavilyExtractResponse> {
  const apiKey = getTavilyApiKey();

  const requestBody = {
    urls: [url],
    include_images: options?.include_images ?? false,
    include_raw_content: options?.include_raw_content ?? false,
  };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      let response: Response;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        response = await fetch(`${TAVILY_API_BASE_URL}/extract`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
      } catch (fetchError) {
        // Handle abort or other fetch errors
        if (fetchError instanceof Error && fetchError.name === "AbortError") {
          throw new Error("Tavily extract API request timeout");
        }
        throw fetchError;
      }

      if (!response) {
        throw new TypeError("fetch returned undefined response");
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `[tavilyExtract] API error response: ${response.status} ${errorText}`
        );

        // Check if retryable and we have retries left
        if (
          isRetryableError(response.status, errorText) &&
          attempt < MAX_RETRIES
        ) {
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
            }/${MAX_RETRIES + 1})`
          );

          await sleep(delay);
          lastError = new Error(
            `Tavily API error: ${response.status} ${errorText}`
          );
          continue;
        }

        // Not retryable or no retries left
        throw new Error(
          `Tavily extract API error: ${response.status} ${errorText}`
        );
      }

      const jsonResult = await response.json();

      // Log the raw response to debug structure
      console.log("[tavilyExtract] Raw API response:", {
        isArray: Array.isArray(jsonResult),
        type: typeof jsonResult,
        keys: Array.isArray(jsonResult)
          ? undefined
          : Object.keys(jsonResult || {}),
        firstElementKeys:
          Array.isArray(jsonResult) && jsonResult[0]
            ? Object.keys(jsonResult[0])
            : undefined,
        sample: Array.isArray(jsonResult) ? jsonResult[0] : jsonResult,
      });

      // Tavily API returns an array when urls is provided as an array
      // Extract the first result if it's an array, otherwise use the result directly
      const result = Array.isArray(jsonResult)
        ? (jsonResult[0] as TavilyExtractResponse)
        : (jsonResult as TavilyExtractResponse);

      // Log the extracted result structure
      console.log("[tavilyExtract] Extracted result:", {
        url: result?.url,
        title: result?.title,
        hasContent: !!result?.content,
        contentLength: result?.content?.length,
        hasImages: !!result?.images,
        imagesCount: result?.images?.length,
        keys: Object.keys(result || {}),
      });

      return result;
    } catch (error) {
      // If error message includes "Tavily extract API error", it's a non-retryable API error - throw immediately
      if (
        error instanceof Error &&
        error.message.includes("Tavily extract API error")
      ) {
        throw error;
      }

      // Check if it's an abort error
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Tavily extract API request timeout");
      }
      if (error instanceof Error && error.message === "Operation aborted") {
        throw error;
      }

      // Check if it's a network/fetch error that might be retryable
      if (
        error instanceof TypeError &&
        (error.message.includes("fetch") ||
          error.message.includes("network") ||
          error.message.includes("timeout") ||
          error.message.includes("undefined"))
      ) {
        if (attempt < MAX_RETRIES) {
          const baseDelay = Math.min(
            INITIAL_RETRY_DELAY_MS * Math.pow(RETRY_MULTIPLIER, attempt),
            MAX_RETRY_DELAY_MS
          );
          const jitter = Math.random() * baseDelay * 0.2;
          const delay = baseDelay + jitter;

          console.log(
            `[tavilyExtract] Network error, retrying in ${delay}ms (attempt ${
              attempt + 1
            }/${MAX_RETRIES + 1})`
          );

          await sleep(delay);
          lastError = error as Error;
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
          throw error;
        }
        throw new Error(`Failed to call Tavily extract API: ${String(error)}`);
      }

      lastError = error as Error;
    }
  }

  // If we get here, all retries were exhausted
  if (lastError) {
    throw lastError;
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
