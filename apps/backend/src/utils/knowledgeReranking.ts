import { getWorkspaceApiKey } from "../http/utils/agentUtils";
import { getDefined } from "../utils";

import { getModelPricing } from "./pricing";
import { buildRerankPrompt } from "./rerankPrompt";
import { Sentry, ensureError } from "./sentry";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Filter available OpenRouter models to find re-ranking models.
 * Re-ranking is done via chat completions, so we include both models with
 * "rerank" in the name (legacy) and common chat models suitable for reranking.
 * @param availableModels - Array of available model names from OpenRouter
 * @returns Array of model names that are suitable for re-ranking
 */
/** Pattern for chat model IDs that work well for reranking (any provider). */
const CHAT_MODEL_PATTERN_FOR_RERANK =
  /gpt-4o-mini|gpt-4o|gpt-4\.1-mini/i;

export function getRerankingModels(availableModels: string[]): string[] {
  const rerankNamed = availableModels.filter((model) => {
    const lowerModel = model.toLowerCase();
    return lowerModel.includes("rerank");
  });
  const chatModels = availableModels.filter(
    (m) =>
      CHAT_MODEL_PATTERN_FOR_RERANK.test(m) && !rerankNamed.includes(m)
  );
  return [...rerankNamed, ...chatModels];
}

/**
 * Result from re-ranking API call
 */
export interface RerankingResult<T extends RerankableSnippet = RerankableSnippet> {
  snippets: T[];
  costUsd?: number; // Provisional cost from API response (in USD)
  generationId?: string; // Generation ID for async cost verification
}

export interface RerankableSnippet {
  snippet: string;
  similarity: number;
}

/**
 * Extract a JSON array of indices from model content (e.g. "[0, 2, 3, 1]" or "Here is the order: [0, 2, 3, 1]").
 * Invalid or out-of-range indices are filtered when building the reranked list.
 * Returns null if no array found or parse fails.
 */
function parseIndicesFromContent(content: string): number[] | null {
  const trimmed = content.trim();
  const match = trimmed.match(/\[[\s\d,-]+\]/);
  if (!match) return null;
  try {
    const arr = JSON.parse(match[0]) as unknown;
    if (!Array.isArray(arr)) return null;
    const indices = arr.filter(
      (x): x is number => typeof x === "number" && Number.isInteger(x)
    );
    return indices.length > 0 ? indices : null;
  } catch {
    return null;
  }
}

/**
 * Re-rank document snippets using OpenRouter's OpenAI-compatible chat completions API.
 * Uses a single prompt that asks the model to return document indices ordered by relevance.
 * @param query - The search query text
 * @param snippets - Array of search results to re-rank
 * @param model - Model name from OpenRouter (should be a chat model, e.g. openai/gpt-4o-mini)
 * @param workspaceId - Workspace ID for API key lookup
 * @returns Re-ranked snippets with cost and generationId information
 */
export async function rerankSnippets<T extends RerankableSnippet>(
  query: string,
  snippets: T[],
  model: string,
  workspaceId: string
): Promise<RerankingResult<T>> {
  if (snippets.length === 0) {
    return {
      snippets: [],
    };
  }

  if (!workspaceId) {
    throw new Error(
      "workspaceId is required for knowledge re-ranking to ensure correct billing"
    );
  }

  let apiKey: string;
  const workspaceApiKey = await getWorkspaceApiKey(workspaceId, "openrouter");
  if (workspaceApiKey) {
    apiKey = workspaceApiKey;
  } else {
    apiKey = getDefined(
      process.env.OPENROUTER_API_KEY,
      "OPENROUTER_API_KEY is not set"
    );
  }

  const documents = snippets.map((s) => s.snippet);
  const prompt = buildRerankPrompt(query, documents);

  try {
    const response = await fetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.DEFAULT_REFERER || "http://localhost:3000",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user" as const, content: prompt }],
        max_tokens: 200,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(
        `OpenRouter chat completions (rerank) error: ${response.status} ${response.statusText} - ${errorText}`
      );
      console.error(
        `[knowledgeReranking] OpenRouter chat completions error: ${response.status} ${response.statusText}`,
        errorText
      );
      Sentry.captureException(error, {
        tags: {
          context: "knowledge-reranking",
          operation: "rerank-api-call",
          statusCode: response.status,
        },
        extra: {
          model,
          documentCount: snippets.length,
          workspaceId,
          errorText,
        },
      });
      return { snippets };
    }

    const rawBody = await response.text();
    const trimmed = rawBody.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      const error = new Error(
        `OpenRouter returned non-JSON response (e.g. HTML): ${trimmed.slice(0, 100)}...`
      );
      console.error(
        "[knowledgeReranking] OpenRouter returned non-JSON response",
        trimmed.slice(0, 200)
      );
      Sentry.captureException(error, {
        tags: {
          context: "knowledge-reranking",
          operation: "rerank-api-call",
        },
        extra: {
          model,
          documentCount: snippets.length,
          workspaceId,
          responsePreview: trimmed.slice(0, 500),
        },
      });
      return { snippets };
    }

    let data: {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { cost?: number };
      id?: string;
      error?: { message: string };
    };
    try {
      data = JSON.parse(rawBody) as typeof data;
    } catch (parseError) {
      const err = ensureError(parseError);
      console.error(
        "[knowledgeReranking] Failed to parse response as JSON:",
        err.message
      );
      Sentry.captureException(err, {
        tags: {
          context: "knowledge-reranking",
          operation: "rerank-api-call",
        },
        extra: {
          model,
          documentCount: snippets.length,
          workspaceId,
          responsePreview: trimmed.slice(0, 500),
        },
      });
      return { snippets };
    }

    if (data.error) {
      const error = new Error(
        `OpenRouter API error: ${data.error.message}`
      );
      console.error("[knowledgeReranking]", error.message);
      Sentry.captureException(error, {
        tags: {
          context: "knowledge-reranking",
          operation: "rerank-api-call",
        },
        extra: {
          model,
          documentCount: snippets.length,
          workspaceId,
        },
      });
      return { snippets };
    }

    const content = data.choices?.[0]?.message?.content ?? "";
    const order = parseIndicesFromContent(content);

    if (!order || order.length === 0) {
      const error = new Error(
        "Invalid response format: missing or invalid indices array in model output"
      );
      console.warn(
        "[knowledgeReranking] Invalid response format: could not parse indices from content"
      );
      Sentry.captureException(error, {
        tags: {
          context: "knowledge-reranking",
          operation: "rerank-response-validation",
        },
        extra: {
          model,
          documentCount: snippets.length,
          workspaceId,
          contentPreview: content.slice(0, 300),
        },
      });
      return { snippets };
    }

    let costUsd = data.usage?.cost;
    const generationId = data.id;

    if (costUsd === undefined) {
      const modelPricing = getModelPricing("openrouter", model);
      if (modelPricing?.usd?.request !== undefined) {
        costUsd = modelPricing.usd.request * 1.055;
        console.log(
          "[knowledgeReranking] Cost not in API response, using pricing config with markup:",
          { model, costUsd }
        );
      } else {
        console.warn(
          "[knowledgeReranking] Cost not in API response and no pricing config:",
          { model }
        );
      }
    }

    const includedIndices = new Set(
      order.filter((i) => i >= 0 && i < snippets.length)
    );
    const rerankedSnippets: T[] = [];
    for (let rank = 0; rank < order.length; rank++) {
      const originalIndex = order[rank];
      if (originalIndex >= 0 && originalIndex < snippets.length) {
        const snippet = snippets[originalIndex];
        const similarity = 1 - rank * 0.01;
        rerankedSnippets.push({
          ...snippet,
          similarity: Math.max(0, similarity),
        });
      }
    }
    for (let i = 0; i < snippets.length; i++) {
      if (!includedIndices.has(i)) {
        rerankedSnippets.push(snippets[i]);
      }
    }

    return {
      snippets: rerankedSnippets,
      ...(costUsd !== undefined && { costUsd }),
      ...(generationId && { generationId }),
    };
  } catch (error) {
    console.error(
      "[knowledgeReranking] Error calling OpenRouter:",
      error instanceof Error ? error.message : String(error)
    );
    Sentry.captureException(ensureError(error), {
      tags: {
        context: "knowledge-reranking",
        operation: "rerank-api-call",
      },
      extra: {
        model,
        documentCount: snippets.length,
        workspaceId,
      },
    });
    return { snippets };
  }
}
