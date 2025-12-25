import {
  extractTokenUsage,
  type TokenUsage,
} from "../../utils/conversationLogger";
import {
  extractOpenRouterCost,
  extractOpenRouterGenerationId,
} from "../../utils/openrouterUtils";
import { calculateConversationCosts } from "../../utils/tokenAccounting";

import type { GenerationEndpoint } from "./generationErrorHandling";

/**
 * Result of token and cost extraction from LLM response
 */
export interface TokenAndCostExtraction {
  tokenUsage: TokenUsage | undefined;
  openrouterGenerationId: string | undefined;
  provisionalCostUsd: number | undefined;
}

/**
 * Extracts token usage, generation ID, and costs from LLM result
 */
export function extractTokenUsageAndCosts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK response types are complex
  result: any,
  usage: unknown,
  modelName: string | undefined,
  endpoint: GenerationEndpoint
): TokenAndCostExtraction {
  // Extract token usage from result
  const tokenUsage = extractTokenUsage({ ...result, usage });

  // Extract OpenRouter generation ID for cost verification
  const openrouterGenerationId = extractOpenRouterGenerationId({
    ...result,
    usage,
  });

  // Extract cost from LLM response for provisional cost
  const openrouterCostUsd = extractOpenRouterCost({ ...result, usage });
  let provisionalCostUsd: number | undefined;
  if (openrouterCostUsd !== undefined && openrouterCostUsd >= 0) {
    // Convert from USD to millionths with 5.5% markup
    // Math.ceil ensures we never undercharge
    provisionalCostUsd = Math.ceil(openrouterCostUsd * 1_000_000 * 1.055);
    console.log(`[${endpoint} Handler] Extracted cost from response:`, {
      openrouterCostUsd,
      provisionalCostUsd,
    });
  } else if (tokenUsage && modelName) {
    // Fallback to calculated cost from tokenUsage if not available in response
    const calculatedCosts = calculateConversationCosts(
      "openrouter",
      modelName,
      tokenUsage
    );
    provisionalCostUsd = calculatedCosts.usd;
    console.log(
      `[${endpoint} Handler] Cost not in response, using calculated cost:`,
      {
        provisionalCostUsd,
        tokenUsage,
      }
    );
  }

  // Log token usage for debugging
  console.log(`[${endpoint} Handler] Extracted token usage:`, {
    tokenUsage,
    usage,
    hasUsage: !!usage,
    openrouterGenerationId,
  });

  return {
    tokenUsage,
    openrouterGenerationId,
    provisionalCostUsd,
  };
}

/**
 * Calculates provisional cost from OpenRouter response or token usage
 */
export function calculateProvisionalCost(
  openrouterCostUsd: number | undefined,
  tokenUsage: TokenUsage | undefined,
  modelName: string | undefined
): number | undefined {
  if (openrouterCostUsd !== undefined && openrouterCostUsd >= 0) {
    // Convert from USD to millionths with 5.5% markup
    // Math.ceil ensures we never undercharge
    return Math.ceil(openrouterCostUsd * 1_000_000 * 1.055);
  }

  if (tokenUsage && modelName) {
    // Fallback to calculated cost from tokenUsage if not available in response
    const calculatedCosts = calculateConversationCosts(
      "openrouter",
      modelName,
      tokenUsage
    );
    return calculatedCosts.usd;
  }

  return undefined;
}
