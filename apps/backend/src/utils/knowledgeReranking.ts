import { getWorkspaceApiKey } from "../http/utils/agentUtils";
import { getDefined } from "../utils";

import { getModelPricing } from "./pricing";
import { Sentry, ensureError } from "./sentry";

/**
 * Filter available OpenRouter models to find re-ranking models
 * Re-ranking models are identified by containing "rerank" in their name (case-insensitive)
 * @param availableModels - Array of available model names from OpenRouter
 * @returns Array of model names that are suitable for re-ranking
 */
export function getRerankingModels(availableModels: string[]): string[] {
  return availableModels.filter((model) => {
    const lowerModel = model.toLowerCase();
    return lowerModel.includes("rerank");
  });
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
 * Re-rank document snippets using OpenRouter re-ranking API
 * @param query - The search query text
 * @param snippets - Array of search results to re-rank
 * @param model - Re-ranking model name from OpenRouter
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

  // Get API key - try workspace key first, fall back to system key
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

  // Prepare documents for re-ranking API
  // OpenRouter re-ranking API expects an array of documents with text content
  const documents = snippets.map((snippet) => snippet.snippet);

  const url = "https://openrouter.ai/api/v1/rerank";

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.DEFAULT_REFERER || "http://localhost:3000",
      },
      body: JSON.stringify({
        model,
        query,
        documents,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(
        `OpenRouter re-ranking API error: ${response.status} ${response.statusText} - ${errorText}`
      );
      console.error(
        `[knowledgeReranking] OpenRouter re-ranking API error: ${response.status} ${response.statusText}`,
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
      // Fall back to original order if re-ranking fails
      return {
        snippets,
      };
    }

    const data = (await response.json()) as {
      results?: Array<{ index: number; relevance_score: number }>;
      cost?: number; // Provisional cost in USD
      id?: string; // Generation ID
      generationId?: string; // Alternative field name for generation ID
    };

    if (!data.results || !Array.isArray(data.results)) {
      const error = new Error(
        "Invalid response format from OpenRouter re-ranking API: missing or invalid results array"
      );
      console.warn(
        "[knowledgeReranking] Invalid response format from OpenRouter re-ranking API"
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
          responseData: data,
        },
      });
      return {
        snippets,
      };
    }

    // Extract cost and generationId from response
    let costUsd = data.cost;
    const generationId = data.id || data.generationId;

    // If cost is not in the API response, calculate it from pricing config
    // Re-ranking models use per-request pricing
    if (costUsd === undefined) {
      const modelPricing = getModelPricing("openrouter", model);
      if (modelPricing?.usd?.request !== undefined) {
        // Apply 5.5% OpenRouter markup to match credit reservation logic
        // This ensures consistency between displayed cost and actual charges
        const baseCost = modelPricing.usd.request;
        costUsd = baseCost * 1.055;
        console.log(
          "[knowledgeReranking] Cost not in API response, calculated from pricing config with markup:",
          {
            model,
            requestPrice: modelPricing.usd.request,
            baseCost,
            costUsd,
            markup: "5.5%",
          }
        );
      } else {
        console.warn(
          "[knowledgeReranking] Cost not in API response and no pricing config found:",
          {
            model,
          }
        );
      }
    } else {
      console.log("[knowledgeReranking] Extracted cost from API response:", {
        costUsd,
        generationId,
      });
    }

    if (generationId) {
      console.log("[knowledgeReranking] Extracted generationId from response:", {
        generationId,
      });
    }

    // Re-order snippets based on re-ranking results
    // Results are sorted by relevance_score in descending order
    const rerankedSnippets: T[] = [];
    for (const result of data.results) {
      const originalIndex = result.index;
      if (originalIndex >= 0 && originalIndex < snippets.length) {
        const snippet = snippets[originalIndex];
        // Update similarity score with re-ranking relevance score
        // OpenRouter relevance scores are typically 0-1, so we can use them directly
        rerankedSnippets.push({
          ...snippet,
          similarity: result.relevance_score,
        });
      }
    }

    // If some snippets weren't included in re-ranking results, append them
    const includedIndices = new Set(
      data.results.map((r) => r.index).filter((i) => i >= 0 && i < snippets.length)
    );
    for (let i = 0; i < snippets.length; i++) {
      if (!includedIndices.has(i)) {
        rerankedSnippets.push(snippets[i]);
      }
    }

    // Always include costUsd if it was calculated (even if 0, though that shouldn't happen)
    // This ensures the cost is always available for display
    return {
      snippets: rerankedSnippets,
      ...(costUsd !== undefined && { costUsd }),
      ...(generationId && { generationId }),
    };
  } catch (error) {
    console.error(
      "[knowledgeReranking] Error calling OpenRouter re-ranking API:",
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
    // Fall back to original order if re-ranking fails
    return {
      snippets,
    };
  }
}
