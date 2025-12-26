import {
  extractTokenUsage,
  type TokenUsage,
} from "../../utils/conversationLogger";
import {
  extractOpenRouterCost,
  extractAllOpenRouterGenerationIds,
} from "../../utils/openrouterUtils";
import { calculateConversationCosts } from "../../utils/tokenAccounting";

import type { GenerationEndpoint } from "./generationErrorHandling";

/**
 * Result of token and cost extraction from LLM response
 */
export interface TokenAndCostExtraction {
  tokenUsage: TokenUsage | undefined;
  openrouterGenerationId: string | undefined; // Keep for backward compatibility
  openrouterGenerationIds: string[]; // New: all generation IDs
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

  // Extract all OpenRouter generation IDs for cost verification
  const openrouterGenerationIds = extractAllOpenRouterGenerationIds({
    ...result,
    usage,
  });

  // Keep single ID for backward compatibility (first one or undefined)
  const openrouterGenerationId =
    openrouterGenerationIds.length > 0 ? openrouterGenerationIds[0] : undefined;

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
    openrouterGenerationIds,
    generationCount: openrouterGenerationIds.length,
  });

  return {
    tokenUsage,
    openrouterGenerationId, // Backward compatible
    openrouterGenerationIds, // New
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
