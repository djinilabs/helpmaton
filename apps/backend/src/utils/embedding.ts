// Gemini embedding model name
const EMBEDDING_MODEL = "text-embedding-004";

// Exponential backoff configuration
const BACKOFF_INITIAL_DELAY_MS = 1000; // 1 second
const BACKOFF_MAX_RETRIES = 5;
const BACKOFF_MAX_DELAY_MS = 60000; // 60 seconds
const BACKOFF_MULTIPLIER = 2;

// In-memory cache for embeddings
// Key format: `${workspaceId}:${documentId}:${snippetHash}` or custom format
// Value: embedding vector (number[])
const embeddingCache = new Map<string, number[]>();

/**
 * Check if an error is a throttling/rate limit error
 */
function isThrottlingError(status: number, errorText: string): boolean {
  return (
    status === 429 ||
    errorText.toLowerCase().includes("quota") ||
    errorText.toLowerCase().includes("rate limit") ||
    errorText.toLowerCase().includes("throttle") ||
    errorText.toLowerCase().includes("too many requests")
  );
}

/**
 * Sleep for a given duration, checking abort signal periodically
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Operation aborted"));
      return;
    }

    const timeout = setTimeout(() => {
      if (signal?.aborted) {
        reject(new Error("Operation aborted"));
      } else {
        resolve();
      }
    }, ms);

    signal?.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(new Error("Operation aborted"));
    });
  });
}

/**
 * Generate embedding for text using Gemini API
 * Uses in-memory cache to avoid regenerating embeddings for the same text
 * Implements exponential backoff retry for throttling errors
 */
export async function generateEmbedding(
  text: string,
  apiKey: string,
  cacheKey?: string,
  signal?: AbortSignal
): Promise<number[]> {
  // Check cache first if cacheKey is provided
  if (cacheKey) {
    const cached = embeddingCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }
  if (!text || text.trim().length === 0) {
    throw new Error("Text cannot be empty");
  }

  // Check if operation is already aborted
  if (signal?.aborted) {
    throw new Error("Operation aborted");
  }

  // Retry loop with exponential backoff
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= BACKOFF_MAX_RETRIES; attempt++) {
    // Check if aborted before each attempt
    if (signal?.aborted) {
      throw new Error("Operation aborted");
    }

    try {
      if (attempt > 0) {
        console.log(
          `[generateEmbedding] Retry attempt ${attempt}/${BACKOFF_MAX_RETRIES}`
        );
      }
      console.log(
        `[generateEmbedding] Making API request to Gemini (attempt ${
          attempt + 1
        })...`
      );
      // Note: The @ai-sdk/google package may not have direct embedding support
      // We'll need to use the REST API directly
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${apiKey}`;

      const requestBody = {
        content: {
          parts: [{ text }],
        },
      };

      // Set Referer header - this must match the API key's allowed referrers
      // The API key should be configured to allow requests from this referrer
      // For server-side calls, we might need to use a wildcard or remove referrer restrictions
      const referer =
        process.env.GEMINI_REFERER || "http://localhost:3000/api/workspaces";

      // Create headers object
      const headers: HeadersInit = {
        "Content-Type": "application/json",
      };

      // Add Referer header - try different variations
      headers["Referer"] = referer;
      headers["referer"] = referer; // lowercase version

      // Create AbortController for this fetch request with timeout
      const fetchController = new AbortController();
      const FETCH_TIMEOUT_MS = 30000; // 30 seconds timeout
      const timeoutId = setTimeout(() => {
        console.error(
          `[generateEmbedding] Fetch timeout after ${FETCH_TIMEOUT_MS}ms`
        );
        fetchController.abort();
      }, FETCH_TIMEOUT_MS);

      if (signal) {
        // If parent signal is aborted, abort fetch immediately
        if (signal.aborted) {
          clearTimeout(timeoutId);
          throw new Error("Operation aborted");
        }
        // Listen to parent signal and abort fetch if parent is aborted
        signal.addEventListener("abort", () => {
          clearTimeout(timeoutId);
          fetchController.abort();
        });
      }

      const fetchStartTime = Date.now();
      console.log(
        `[generateEmbedding] Starting fetch request to ${url.substring(
          0,
          80
        )}... (timeout: ${FETCH_TIMEOUT_MS}ms)`
      );
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: headers,
          referrer: referer, // Also set as fetch option
          body: JSON.stringify(requestBody),
          signal: fetchController.signal,
        });
        clearTimeout(timeoutId);
        const fetchDuration = Date.now() - fetchStartTime;
        console.log(
          `[generateEmbedding] Fetch completed in ${fetchDuration}ms, status: ${response.status}`
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[generateEmbedding] API error response: ${errorText}`);

          // Check if it's a referrer restriction error (don't retry this)
          if (
            (response.status === 403 && errorText.includes("referer")) ||
            errorText.includes("referrer")
          ) {
            const errorMsg = `API key referrer restriction error. For server-side API calls, the GEMINI_API_KEY should be configured WITHOUT HTTP referrer restrictions in Google Cloud Console. Instead, use IP address restrictions or no application restrictions. Current error: ${errorText}`;
            console.error(`[generateEmbedding] ${errorMsg}`);
            throw new Error(errorMsg);
          }

          // Check if it's a throttling error and we have retries left
          if (
            isThrottlingError(response.status, errorText) &&
            attempt < BACKOFF_MAX_RETRIES
          ) {
            // Calculate delay with exponential backoff and jitter
            const baseDelay = Math.min(
              BACKOFF_INITIAL_DELAY_MS * Math.pow(BACKOFF_MULTIPLIER, attempt),
              BACKOFF_MAX_DELAY_MS
            );
            // Add jitter: random value between 0 and 20% of base delay
            const jitter = Math.random() * baseDelay * 0.2;
            const delay = baseDelay + jitter;

            // Wait with abort signal support
            try {
              await sleep(delay, signal);
            } catch (sleepError) {
              // If sleep was aborted, throw abort error
              if (
                sleepError instanceof Error &&
                sleepError.message === "Operation aborted"
              ) {
                throw sleepError;
              }
              throw sleepError;
            }

            // Continue to next retry attempt
            lastError = new Error(
              `Failed to generate embedding: ${response.status} ${errorText}`
            );
            continue;
          }

          // Not a throttling error or no retries left, throw immediately
          throw new Error(
            `Failed to generate embedding: ${response.status} ${errorText}`
          );
        }

        const data = (await response.json()) as {
          embedding?: { values?: number[] };
        };

        if (!data.embedding?.values) {
          console.error(
            `[generateEmbedding] Invalid response format:`,
            JSON.stringify(data).substring(0, 200)
          );
          throw new Error("Invalid embedding response format");
        }

        // Cache the embedding if cacheKey is provided
        if (cacheKey) {
          embeddingCache.set(cacheKey, data.embedding.values);
        }

        return data.embedding.values;
      } catch (fetchError) {
        clearTimeout(timeoutId);
        // Check if it's a timeout/abort error
        if (
          fetchError instanceof Error &&
          (fetchError.name === "AbortError" ||
            fetchError.message.includes("aborted") ||
            fetchError.message.includes("timeout"))
        ) {
          throw new Error(
            `Embedding generation timed out or was aborted after ${FETCH_TIMEOUT_MS}ms`
          );
        }
        throw fetchError;
      }
    } catch (error) {
      console.error(`[generateEmbedding] Error generating embedding:`, error);
      // Check if it's an abort error
      if (error instanceof Error && error.message === "Operation aborted") {
        throw error;
      }

      // Check if it's a network/fetch error that might be retryable
      if (
        error instanceof TypeError &&
        (error.message.includes("fetch") || error.message.includes("network"))
      ) {
        if (attempt < BACKOFF_MAX_RETRIES) {
          const baseDelay = Math.min(
            BACKOFF_INITIAL_DELAY_MS * Math.pow(BACKOFF_MULTIPLIER, attempt),
            BACKOFF_MAX_DELAY_MS
          );
          const jitter = Math.random() * baseDelay * 0.2;
          const delay = baseDelay + jitter;

          try {
            await sleep(delay, signal);
          } catch (sleepError) {
            if (
              sleepError instanceof Error &&
              sleepError.message === "Operation aborted"
            ) {
              throw sleepError;
            }
            throw sleepError;
          }

          lastError = error as Error;
          continue;
        }
      }

      // If we've exhausted retries or it's a non-retryable error, throw
      if (
        attempt === BACKOFF_MAX_RETRIES ||
        !isThrottlingError(
          0,
          error instanceof Error ? error.message : String(error)
        )
      ) {
        console.error(`[generateEmbedding] Error generating embedding:`, error);
        if (error instanceof Error) {
          console.error(`[generateEmbedding] Error message: ${error.message}`);
          console.error(`[generateEmbedding] Error stack: ${error.stack}`);
          throw error;
        }
        throw new Error(`Failed to generate embedding: ${String(error)}`);
      }

      lastError = error as Error;
    }
  }

  // If we get here, all retries were exhausted
  if (lastError) {
    throw lastError;
  }
  throw new Error("Failed to generate embedding: Unknown error");
}

/**
 * Check if an embedding exists in cache
 */
export function hasEmbedding(cacheKey: string): boolean {
  return embeddingCache.has(cacheKey);
}

/**
 * Get an embedding from cache
 */
export function getEmbedding(cacheKey: string): number[] | undefined {
  return embeddingCache.get(cacheKey);
}

/**
 * Clear cache for a specific workspace (optional utility)
 */
export function clearWorkspaceCache(workspaceId: string): void {
  const keysToDelete: string[] = [];
  for (const key of Array.from(embeddingCache.keys())) {
    if (key.startsWith(`${workspaceId}:`)) {
      keysToDelete.push(key);
    }
  }
  for (const key of keysToDelete) {
    embeddingCache.delete(key);
  }

  console.log(
    `[embedding] Cleared cache for workspace: ${workspaceId} (${keysToDelete.length} embeddings)`
  );
}
