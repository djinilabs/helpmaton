/**
 * Exa.ai API client utility
 * Provides functions for calling Exa.ai search API with category support
 */

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 10000;
const RETRY_MULTIPLIER = 2;
const EXA_API_BASE_URL = "https://api.exa.ai";

export type ExaSearchCategory =
  | "company"
  | "research paper"
  | "news"
  | "pdf"
  | "github"
  | "tweet"
  | "personal site"
  | "people"
  | "financial report";

export interface ExaSearchOptions {
  num_results?: number;
  signal?: AbortSignal;
}

export interface ExaSearchResult {
  title: string;
  url: string;
  published_date?: string;
  author?: string;
  text?: string;
  score?: number;
}

export interface ExaSearchResponse {
  results: ExaSearchResult[];
  costDollars?: {
    total: number;
  };
}

/**
 * Get Exa API key from environment
 */
function getExaApiKey(): string {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    throw new Error(
      "EXA_API_KEY environment variable is not set. Please configure it to use Exa search tools."
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
 * Call Exa.ai search API with retry logic
 * @param query - Search query string
 * @param category - Search category (one of the 9 supported categories)
 * @param options - Optional search parameters
 * @returns Search response with results and cost information
 */
export async function exaSearch(
  query: string,
  category: ExaSearchCategory,
  options?: ExaSearchOptions
): Promise<ExaSearchResponse> {
  // Check API key first
  const apiKey = getExaApiKey();

  const numResults = options?.num_results ?? 10;

  // Validate category
  const validCategories: ExaSearchCategory[] = [
    "company",
    "research paper",
    "news",
    "pdf",
    "github",
    "tweet",
    "personal site",
    "people",
    "financial report",
  ];

  if (!validCategories.includes(category)) {
    throw new Error(
      `Invalid search category: ${category}. Must be one of: ${validCategories.join(", ")}`
    );
  }

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Use provided signal if available, otherwise use timeout signal
      const fetchSignal =
        options?.signal || AbortSignal.timeout(30000); // 30 second timeout

      const response = await fetch(`${EXA_API_BASE_URL}/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          query,
          category,
          num_results: numResults,
        }),
        signal: fetchSignal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `Exa API error: ${response.status} ${response.statusText}`;
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.error || errorJson.message) {
            errorMessage = `Exa API error: ${errorJson.error || errorJson.message}`;
          }
        } catch {
          // If JSON parsing fails, use the text as-is
          if (errorText) {
            errorMessage = `Exa API error: ${errorText}`;
          }
        }

        // 4xx errors are not retryable (except 429)
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          throw new Error(errorMessage);
        }

        // For 429 and 5xx, throw a retryable error
        throw new Error(errorMessage);
      }

      const data = await response.json();

      // Extract cost from response
      // Exa API returns cost in result.costDollars.total
      const costDollars = data.costDollars || data.cost?.dollars || data.cost;

      return {
        results: data.results || [],
        costDollars: costDollars
          ? {
              total:
                typeof costDollars === "number"
                  ? costDollars
                  : costDollars.total || 0,
            }
          : undefined,
      };
    } catch (error) {
      // If error message includes "Exa API error" and it's a 4xx (not 429), don't retry
      if (
        error instanceof Error &&
        error.message.includes("Exa API error") &&
        !error.message.includes("429")
      ) {
        const statusMatch = error.message.match(/\d{3}/);
        if (statusMatch && parseInt(statusMatch[0]) >= 400 && parseInt(statusMatch[0]) < 500) {
          throw error;
        }
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
            `[exaSearch] Timeout error, retrying in ${delay}ms (attempt ${
              attempt + 1
            }/${MAX_RETRIES + 1})`
          );

          await sleep(delay);
          lastError = error;
          continue;
        }
        throw new Error("Exa search API request timeout");
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
            `[exaSearch] Retryable error, retrying in ${delay}ms (attempt ${
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
        console.error(`[exaSearch] Error after ${MAX_RETRIES} retries:`, error);
        if (error instanceof Error) {
          throw new Error(`Exa search API error: ${error.message}`);
        }
        throw new Error(`Failed to call Exa search API: ${String(error)}`);
      }

      lastError = error as Error;
    }
  }

  // If we get here, all retries were exhausted
  if (lastError) {
    throw new Error(`Exa search API error: ${lastError.message}`);
  }
  throw new Error("Failed to call Exa search API: Unknown error");
}

/**
 * Extract cost from Exa API response
 * @param response - Exa search response
 * @returns Cost in dollars (0 if not available)
 */
export function extractExaCost(response: ExaSearchResponse): number {
  return response.costDollars?.total ?? 0;
}

