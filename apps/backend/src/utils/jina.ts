/**
 * Jina Reader API client utility
 * Provides functions for calling Jina Reader API to extract content from URLs
 * Jina Reader API: https://r.jina.ai/{url}
 */

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 10000;
const RETRY_MULTIPLIER = 2;
const REQUEST_TIMEOUT_MS = 30000; // 30 seconds

export interface JinaFetchOptions {
  apiKey?: string; // Optional API key (increases rate limit from 20 to 200 req/min)
}

export interface JinaFetchResponse {
  url: string;
  content: string;
  title?: string;
}

export interface JinaSearchOptions {
  apiKey?: string; // Optional API key (increases rate limit)
  max_results?: number; // Maximum number of results (default: 5, max: 10)
}

export interface JinaSearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

export interface JinaSearchResponse {
  query: string;
  results: JinaSearchResult[];
  answer?: string;
}

/**
 * Get Jina API key from environment (optional)
 */
function getJinaApiKey(): string | undefined {
  return process.env.JINA_API_KEY;
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
 * Extract title from HTML content if available
 * Jina Reader API returns clean text, but we can try to extract title from meta tags or first heading
 */
function extractTitleFromContent(
  content: string,
  url: string
): string | undefined {
  // Try to find title in content (Jina may include it)
  const titleMatch = content.match(/^#\s+(.+)$/m);
  if (titleMatch) {
    return titleMatch[1].trim();
  }

  // Fallback: use domain name
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return undefined;
  }
}

/**
 * Call Jina Reader API to fetch and extract content from a URL
 * @param url - The URL to fetch content from
 * @param options - Optional configuration (API key)
 * @returns Extracted content with title and text
 */
export async function jinaFetch(
  url: string,
  options?: JinaFetchOptions
): Promise<JinaFetchResponse> {
  // Validate URL
  try {
    new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  // Prepend Jina Reader API base URL
  const jinaUrl = `https://r.jina.ai/${url}`;

  // Get API key from options or environment
  const apiKey = options?.apiKey || getJinaApiKey();

  // Build headers
  const headers: Record<string, string> = {
    Accept: "text/plain",
    "User-Agent": "Helpmaton/1.0",
  };

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(jinaUrl, {
          method: "GET",
          headers,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          // Handle rate limiting (429)
          if (response.status === 429) {
            const retryAfter = response.headers.get("Retry-After");
            const retryDelay = retryAfter
              ? parseInt(retryAfter, 10) * 1000
              : INITIAL_RETRY_DELAY_MS * Math.pow(RETRY_MULTIPLIER, attempt);

            if (attempt < MAX_RETRIES) {
              console.log(
                `[jinaFetch] Rate limited (429), retrying in ${retryDelay}ms (attempt ${
                  attempt + 1
                }/${MAX_RETRIES + 1})`
              );
              await sleep(retryDelay);
              lastError = new Error(`Rate limited: ${response.statusText}`);
              continue;
            }
          }

          // Handle other HTTP errors
          const errorText = await response
            .text()
            .catch(() => response.statusText);
          throw new Error(
            `Jina Reader API error (${response.status}): ${errorText}`
          );
        }

        // Get content as text
        const content = await response.text();

        // Extract title from content or URL
        const title = extractTitleFromContent(content, url);

        return {
          url,
          content,
          title,
        };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
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
            `[jinaFetch] Timeout error, retrying in ${delay}ms (attempt ${
              attempt + 1
            }/${MAX_RETRIES + 1})`
          );

          await sleep(delay);
          lastError = error;
          continue;
        }
        throw new Error("Jina Reader API request timeout");
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
            `[jinaFetch] Retryable error, retrying in ${delay}ms (attempt ${
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
        console.error(`[jinaFetch] Error after ${MAX_RETRIES} retries:`, error);
        if (error instanceof Error) {
          throw new Error(`Jina Reader API error: ${error.message}`);
        }
        throw new Error(`Failed to call Jina Reader API: ${String(error)}`);
      }

      lastError = error as Error;
    }
  }

  // If we get here, all retries were exhausted
  if (lastError) {
    throw new Error(`Jina Reader API error: ${lastError.message}`);
  }
  throw new Error("Failed to call Jina Reader API: Unknown error");
}

/**
 * Call Jina Search API to search the web
 * Uses https://s.jina.ai/{query} endpoint
 * @param query - The search query
 * @param options - Optional configuration (API key, max_results)
 * @returns Search results with titles, URLs, content, and optional answer
 */
export async function jinaSearch(
  query: string,
  options?: JinaSearchOptions
): Promise<JinaSearchResponse> {
  // Validate query
  if (!query || typeof query !== "string" || query.trim().length === 0) {
    throw new Error("Search query is required and cannot be empty");
  }

  // Validate max_results (for future use, currently not used in URL-based API)
  const maxResults = Math.min(Math.max(1, options?.max_results ?? 5), 10); // Clamp between 1 and 10

  // Encode query for URL
  const encodedQuery = encodeURIComponent(query.trim());

  // Jina Search API endpoint
  const jinaUrl = `https://s.jina.ai/q=${encodedQuery}`;

  // Get API key from options or environment
  const apiKey = options?.apiKey || getJinaApiKey();

  // Build headers
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "Helpmaton/1.0",
    "X-Respond-With": "no-content", // Prevent Jina from responding with content
  };

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(jinaUrl, {
          method: "GET",
          headers,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          // Handle rate limiting (429)
          if (response.status === 429) {
            const retryAfter = response.headers.get("Retry-After");
            const retryDelay = retryAfter
              ? parseInt(retryAfter, 10) * 1000
              : INITIAL_RETRY_DELAY_MS * Math.pow(RETRY_MULTIPLIER, attempt);

            if (attempt < MAX_RETRIES) {
              console.log(
                `[jinaSearch] Rate limited (429), retrying in ${retryDelay}ms (attempt ${
                  attempt + 1
                }/${MAX_RETRIES + 1})`
              );
              await sleep(retryDelay);
              lastError = new Error(`Rate limited: ${response.statusText}`);
              continue;
            }
          }

          // Handle other HTTP errors
          const errorText = await response
            .text()
            .catch(() => response.statusText);
          throw new Error(
            `Jina Search API error (${response.status}): ${errorText}`
          );
        }

        // Parse response - Jina Search API returns JSON
        const data = await response.json();

        const results: JinaSearchResult[] = [];

        // Check if response has a results array
        if (data.results && Array.isArray(data.results)) {
          // Limit to maxResults
          const limitedResults = data.results.slice(0, maxResults);
          for (const result of limitedResults) {
            results.push({
              title:
                (result.title as string) ||
                (result.url as string) ||
                "Untitled",
              url: (result.url as string) || "",
              content:
                (result.content as string) ||
                (result.snippet as string) ||
                (result.description as string) ||
                "",
              score:
                (result.score as number) || (result.relevance_score as number),
            });
          }
        } else if (data.data && Array.isArray(data.data)) {
          // Alternative response format with data array
          const limitedResults = data.data.slice(0, maxResults);
          for (const result of limitedResults) {
            results.push({
              title:
                (result.title as string) ||
                (result.url as string) ||
                "Untitled",
              url: (result.url as string) || "",
              content:
                (result.content as string) ||
                (result.snippet as string) ||
                (result.description as string) ||
                "",
              score:
                (result.score as number) || (result.relevance_score as number),
            });
          }
        } else {
          // Fallback: try to parse as text/markdown if JSON parsing fails
          // This shouldn't happen with proper API, but handle gracefully
          results.push({
            title: "Search Results",
            url: "",
            content:
              typeof data === "string"
                ? data.substring(0, 1000)
                : JSON.stringify(data).substring(0, 1000),
          });
        }

        // Extract answer/summary if available
        const answer =
          (data.answer as string | undefined) ||
          (data.summary as string | undefined);

        return {
          query,
          results,
          answer,
        };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
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
            `[jinaSearch] Timeout error, retrying in ${delay}ms (attempt ${
              attempt + 1
            }/${MAX_RETRIES + 1})`
          );

          await sleep(delay);
          lastError = error;
          continue;
        }
        throw new Error("Jina Search API request timeout");
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
            `[jinaSearch] Retryable error, retrying in ${delay}ms (attempt ${
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
          `[jinaSearch] Error after ${MAX_RETRIES} retries:`,
          error
        );
        if (error instanceof Error) {
          throw new Error(`Jina Search API error: ${error.message}`);
        }
        throw new Error(`Failed to call Jina Search API: ${String(error)}`);
      }

      lastError = error as Error;
    }
  }

  // If we get here, all retries were exhausted
  if (lastError) {
    throw new Error(`Jina Search API error: ${lastError.message}`);
  }
  throw new Error("Failed to call Jina Search API: Unknown error");
}
