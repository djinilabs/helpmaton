import { getWorkspaceApiKey } from "../http/utils/agentUtils";
import { getDefined } from "../utils";

import type { SearchResult } from "./documentSearch";

/**
 * Filter available OpenRouter models to find re-ranking models
 * Re-ranking models are identified by containing "rerank" or "rank" in their name (case-insensitive)
 * @param availableModels - Array of available model names from OpenRouter
 * @returns Array of model names that are suitable for re-ranking
 */
export function getRerankingModels(availableModels: string[]): string[] {
  return availableModels.filter((model) => {
    const lowerModel = model.toLowerCase();
    return lowerModel.includes("rerank") || lowerModel.includes("rank");
  });
}

/**
 * Re-rank document snippets using OpenRouter re-ranking API
 * @param query - The search query text
 * @param snippets - Array of search results to re-rank
 * @param model - Re-ranking model name from OpenRouter
 * @param workspaceId - Workspace ID for API key lookup (optional)
 * @returns Re-ranked snippets with updated similarity scores
 */
export async function rerankSnippets(
  query: string,
  snippets: SearchResult[],
  model: string,
  workspaceId?: string
): Promise<SearchResult[]> {
  if (snippets.length === 0) {
    return [];
  }

  // Get API key - try workspace key first, fall back to system key
  let apiKey: string;
  if (workspaceId) {
    const workspaceApiKey = await getWorkspaceApiKey(workspaceId, "openrouter");
    if (workspaceApiKey) {
      apiKey = workspaceApiKey;
    } else {
      apiKey = getDefined(
        process.env.OPENROUTER_API_KEY,
        "OPENROUTER_API_KEY is not set"
      );
    }
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
      console.error(
        `[knowledgeReranking] OpenRouter re-ranking API error: ${response.status} ${response.statusText}`,
        errorText
      );
      // Fall back to original order if re-ranking fails
      return snippets;
    }

    const data = (await response.json()) as {
      results?: Array<{ index: number; relevance_score: number }>;
    };

    if (!data.results || !Array.isArray(data.results)) {
      console.warn(
        "[knowledgeReranking] Invalid response format from OpenRouter re-ranking API"
      );
      return snippets;
    }

    // Re-order snippets based on re-ranking results
    // Results are sorted by relevance_score in descending order
    const rerankedSnippets: SearchResult[] = [];
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

    return rerankedSnippets;
  } catch (error) {
    console.error(
      "[knowledgeReranking] Error calling OpenRouter re-ranking API:",
      error instanceof Error ? error.message : String(error)
    );
    // Fall back to original order if re-ranking fails
    return snippets;
  }
}
