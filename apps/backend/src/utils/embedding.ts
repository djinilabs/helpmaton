import { getWorkspaceApiKey } from "../http/utils/agent-keys";
import { getDefined } from "../utils";

// OpenRouter embedding model name
export const EMBEDDING_MODEL = "thenlper/gte-base";

const OPENROUTER_EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";

// Exponential backoff configuration
const BACKOFF_INITIAL_DELAY_MS = 1000; // 1 second
const BACKOFF_MAX_RETRIES = 5;
const BACKOFF_MAX_DELAY_MS = 60000; // 60 seconds
const BACKOFF_MULTIPLIER = 2;
const VALIDATION_MAX_RETRIES = 2;
const VALIDATION_INITIAL_DELAY_MS = 500;

// In-memory cache for embeddings
// Key format: `${workspaceId}:${documentId}:${snippetHash}` or custom format
// Value: embedding vector (number[])
const embeddingCache = new Map<string, number[]>();

const EMBEDDING_TIMEOUT_MS = 30000; // 30 seconds timeout

/** Parsed success response from OpenRouter embeddings API (lenient: we only require data[].embedding) */
interface OpenRouterEmbeddingResponse {
  data: Array<{ embedding?: number[] }>;
  usage?: {
    prompt_tokens?: number;
    total_tokens?: number;
    cost?: number;
  };
  id?: string;
  model?: string;
}

/**
 * Format OpenRouter error response body for logging.
 * Prefers error.message when present (e.g. { error: { message: "..." } }).
 */
function formatOpenRouterErrorBody(body: unknown, rawText: string): string {
  if (!body || typeof body !== "object" || !("error" in body)) {
    return rawText.substring(0, 200);
  }
  const err = (body as { error: unknown }).error;
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return String(err).substring(0, 200);
}

/**
 * Call OpenRouter embeddings API directly so we control response validation.
 * The SDK enforces a strict schema (object/list, data, model); OpenRouter or
 * upstream providers sometimes return 200 with a different shape (e.g. error
 * payload or missing fields), which caused ResponseValidationError in production.
 * We only require data[0].embedding to be an array of numbers.
 */
async function fetchEmbeddingFromOpenRouter(
  text: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<OpenRouterEmbeddingResponse> {
  const res = await fetch(OPENROUTER_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: text,
      model: EMBEDDING_MODEL,
    }),
    signal,
  });

  const rawText = await res.text();
  let body: unknown;
  try {
    body = rawText ? JSON.parse(rawText) : undefined;
  } catch {
    console.error(
      `[generateEmbedding] Non-JSON response (status ${res.status}):`,
      rawText.substring(0, 300),
    );
    throw new Error(
      `OpenRouter embeddings returned non-JSON (status ${res.status})`,
    );
  }

  if (!res.ok) {
    const errBody = formatOpenRouterErrorBody(body, rawText);
    console.error(
      `[generateEmbedding] OpenRouter error ${res.status}:`,
      errBody,
    );
    const err = new Error(
      `OpenRouter embeddings error: ${res.status} ${res.statusText}`,
    ) as Error & { statusCode?: number };
    err.statusCode = res.status;
    throw err;
  }

  // Lenient validation: we only need data[0].embedding to be an array of numbers
  if (!body || typeof body !== "object" || !Array.isArray((body as Record<string, unknown>).data)) {
    console.error(
      `[generateEmbedding] Unexpected 200 response shape (missing or invalid data array):`,
      rawText.substring(0, 500),
    );
    throw new Error("Invalid embedding response format");
  }

  const data = (body as Record<string, unknown>).data as Array<{ embedding?: unknown }>;
  const first = data[0];
  if (!first || !Array.isArray(first.embedding)) {
    console.error(
      `[generateEmbedding] Unexpected 200 response (data[0].embedding missing or not array):`,
      rawText.substring(0, 500),
    );
    throw new Error("Invalid embedding response format");
  }

  const embedding = first.embedding as unknown[];
  if (!embedding.every((x) => typeof x === "number")) {
    console.error(
      `[generateEmbedding] data[0].embedding contained non-numbers:`,
      rawText.substring(0, 300),
    );
    throw new Error("Invalid embedding response format");
  }

  const rawUsage = (body as Record<string, unknown>).usage;
  const usage: OpenRouterEmbeddingResponse["usage"] =
    typeof rawUsage === "object" && rawUsage !== null
      ? {
          prompt_tokens:
            typeof (rawUsage as Record<string, unknown>).prompt_tokens === "number"
              ? ((rawUsage as Record<string, unknown>).prompt_tokens as number)
              : undefined,
          total_tokens:
            typeof (rawUsage as Record<string, unknown>).total_tokens === "number"
              ? ((rawUsage as Record<string, unknown>).total_tokens as number)
              : undefined,
          cost:
            typeof (rawUsage as Record<string, unknown>).cost === "number"
              ? ((rawUsage as Record<string, unknown>).cost as number)
              : undefined,
        }
      : undefined;

  return {
    data: [{ embedding: embedding as number[] }],
    usage,
    id:
      typeof (body as Record<string, unknown>).id === "string"
        ? ((body as Record<string, unknown>).id as string)
        : undefined,
    model:
      typeof (body as Record<string, unknown>).model === "string"
        ? ((body as Record<string, unknown>).model as string)
        : undefined,
  };
}

/**
 * Check if an error is a throttling/rate limit error
 */
function isThrottlingError(
  status: number | undefined,
  errorText: string,
): boolean {
  return (
    status === 429 ||
    errorText.toLowerCase().includes("quota") ||
    errorText.toLowerCase().includes("rate limit") ||
    errorText.toLowerCase().includes("throttle") ||
    errorText.toLowerCase().includes("too many requests")
  );
}

function getErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const status = (error as { statusCode?: number; status?: number }).statusCode;
  if (typeof status === "number") {
    return status;
  }
  const fallbackStatus = (error as { status?: number }).status;
  if (typeof fallbackStatus === "number") {
    return fallbackStatus;
  }
  return undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isResponseValidationError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const name = (error as { name?: string }).name;
  if (name === "ResponseValidationError" || name === "ZodError") {
    return true;
  }
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("response validation") ||
    message.includes("invalid embedding response format")
  );
}

function getErrorPreview(error: unknown): string {
  if (error instanceof Error) {
    const preview = `${error.name}: ${error.message}`;
    return preview.length > 200 ? preview.slice(0, 200) : preview;
  }
  const text = String(error);
  return text.length > 200 ? text.slice(0, 200) : text;
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

export interface EmbeddingUsage {
  promptTokens?: number;
  totalTokens?: number;
  cost?: number;
}

export interface EmbeddingResult {
  embedding: number[];
  usage?: EmbeddingUsage;
  id?: string;
  fromCache: boolean;
}

export interface ResolvedEmbeddingApiKey {
  apiKey: string;
  usesByok: boolean;
}

export async function resolveEmbeddingApiKey(
  workspaceId?: string,
): Promise<ResolvedEmbeddingApiKey> {
  if (workspaceId) {
    const workspaceKey = await getWorkspaceApiKey(workspaceId, "openrouter");
    if (workspaceKey) {
      return { apiKey: workspaceKey, usesByok: true };
    }
  }

  const apiKey = getDefined(
    process.env.OPENROUTER_API_KEY,
    "OPENROUTER_API_KEY is not set",
  );
  return { apiKey, usesByok: false };
}

/**
 * Generate embedding for text using OpenRouter embeddings API
 * Uses in-memory cache to avoid regenerating embeddings for the same text
 * Implements exponential backoff retry for throttling errors
 */
async function generateEmbeddingResult(
  text: string,
  apiKey: string,
  cacheKey?: string,
  signal?: AbortSignal,
): Promise<EmbeddingResult> {
  // Check cache first if cacheKey is provided
  if (cacheKey) {
    const cached = embeddingCache.get(cacheKey);
    if (cached) {
      return { embedding: cached, fromCache: true };
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
  let validationAttempts = 0;
  for (let attempt = 0; attempt <= BACKOFF_MAX_RETRIES; attempt++) {
    // Check if aborted before each attempt
    if (signal?.aborted) {
      throw new Error("Operation aborted");
    }

    try {
      if (attempt > 0) {
        console.log(
          `[generateEmbedding] Retry attempt ${attempt}/${BACKOFF_MAX_RETRIES}`,
        );
      }
      console.log(
        `[generateEmbedding] Making API request to OpenRouter (attempt ${
          attempt + 1
        })...`,
      );

      // Create AbortController for this fetch request with timeout
      const fetchController = new AbortController();
      const timeoutId = setTimeout(() => {
        console.error(
          `[generateEmbedding] Request timeout after ${EMBEDDING_TIMEOUT_MS}ms`,
        );
        fetchController.abort();
      }, EMBEDDING_TIMEOUT_MS);

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

      const requestStartTime = Date.now();
      console.log(
        `[generateEmbedding] Starting OpenRouter embeddings request (timeout: ${EMBEDDING_TIMEOUT_MS}ms)`,
      );
      try {
        const response = await fetchEmbeddingFromOpenRouter(
          text,
          apiKey,
          fetchController.signal,
        );
        const requestDuration = Date.now() - requestStartTime;
        console.log(
          `[generateEmbedding] Request completed in ${requestDuration}ms`,
        );

        const embedding = response.data[0].embedding as number[];
        // Cache the embedding if cacheKey is provided
        if (cacheKey) {
          embeddingCache.set(cacheKey, embedding);
        }

        const usage = response.usage;
        return {
          embedding,
          usage: usage
            ? {
                promptTokens: usage.prompt_tokens,
                totalTokens: usage.total_tokens,
                cost: usage.cost,
              }
            : undefined,
          id: response.id,
          fromCache: false,
        };
      } catch (requestError) {
        // Check if it's a timeout/abort error
        if (
          requestError instanceof Error &&
          (requestError.name === "AbortError" ||
            requestError.message.includes("aborted") ||
            requestError.message.includes("timeout"))
        ) {
          throw new Error(
            `Embedding generation timed out or was aborted after ${EMBEDDING_TIMEOUT_MS}ms`,
          );
        }
        throw requestError;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      console.error(`[generateEmbedding] Error generating embedding:`, error);
      // Check if it's an abort error
      if (error instanceof Error && error.message === "Operation aborted") {
        throw error;
      }

      const status = getErrorStatus(error);
      const errorMessage = getErrorMessage(error);

      if (isResponseValidationError(error)) {
        if (validationAttempts < VALIDATION_MAX_RETRIES) {
          const attemptNumber = validationAttempts + 1;
          validationAttempts += 1;
          const delay =
            VALIDATION_INITIAL_DELAY_MS * Math.pow(2, attemptNumber - 1);
          console.warn(
            `[generateEmbedding] Response validation failure (attempt ${attemptNumber}/${VALIDATION_MAX_RETRIES + 1}). Retrying after ${delay}ms. Preview: ${getErrorPreview(error)}`,
          );
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
          continue;
        }
        console.error(
          `[generateEmbedding] Response validation failure after ${VALIDATION_MAX_RETRIES + 1} attempts. Preview: ${getErrorPreview(error)}`,
        );
        throw error;
      }

      if (
        isThrottlingError(status, errorMessage) &&
        attempt < BACKOFF_MAX_RETRIES
      ) {
        const baseDelay = Math.min(
          BACKOFF_INITIAL_DELAY_MS * Math.pow(BACKOFF_MULTIPLIER, attempt),
          BACKOFF_MAX_DELAY_MS,
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

      // Check if it's a network/fetch error that might be retryable
      if (
        error instanceof TypeError &&
        (error.message.includes("fetch") || error.message.includes("network"))
      ) {
        if (attempt < BACKOFF_MAX_RETRIES) {
          const baseDelay = Math.min(
            BACKOFF_INITIAL_DELAY_MS * Math.pow(BACKOFF_MULTIPLIER, attempt),
            BACKOFF_MAX_DELAY_MS,
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
        !isThrottlingError(status, errorMessage)
      ) {
        if (error instanceof Error) {
          console.error(
            `[generateEmbedding] Fatal error after ${attempt + 1} attempt(s): ${error.message}`,
            error.stack ?? "",
          );
          throw error;
        }
        console.error(
          `[generateEmbedding] Fatal error after ${attempt + 1} attempt(s):`,
          error,
        );
        throw new Error(`Failed to generate embedding: ${errorMessage}`);
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
 * Generate embedding for text and return usage metadata
 */
export async function generateEmbeddingWithUsage(
  text: string,
  apiKey: string,
  cacheKey?: string,
  signal?: AbortSignal,
): Promise<EmbeddingResult> {
  return generateEmbeddingResult(text, apiKey, cacheKey, signal);
}

/**
 * Generate embedding for text using OpenRouter embeddings API
 */
export async function generateEmbedding(
  text: string,
  apiKey: string,
  cacheKey?: string,
  signal?: AbortSignal,
): Promise<number[]> {
  const result = await generateEmbeddingResult(text, apiKey, cacheKey, signal);
  return result.embedding;
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
    `[embedding] Cleared cache for workspace: ${workspaceId} (${keysToDelete.length} embeddings)`,
  );
}
