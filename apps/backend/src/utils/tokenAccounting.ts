import type { TokenUsage } from "./conversationLogger";
import { calculateTokenCosts } from "./pricing";

export interface TokenCosts {
  usd: number;
  eur: number;
  gbp: number;
}

/**
 * Calculate token costs for a conversation
 */
export function calculateConversationCosts(
  provider: string | undefined,
  modelName: string | undefined,
  tokenUsage: TokenUsage | undefined
): TokenCosts {
  console.log("[calculateConversationCosts] Input:", {
    provider,
    modelName,
    tokenUsage,
  });

  if (!modelName || !tokenUsage) {
    console.log("[calculateConversationCosts] Missing modelName or tokenUsage, returning 0");
    return { usd: 0, eur: 0, gbp: 0 };
  }

  // Default to "google" if provider is not specified
  const effectiveProvider = provider || "google";

  const costs = calculateTokenCosts(
    effectiveProvider,
    modelName,
    tokenUsage.promptTokens || 0,
    tokenUsage.completionTokens || 0,
    tokenUsage.reasoningTokens || 0,
    tokenUsage.cachedPromptTokens || 0
  );

  console.log("[calculateConversationCosts] Calculated costs:", {
    provider: effectiveProvider,
    modelName,
    inputTokens: tokenUsage.promptTokens || 0,
    cachedPromptTokens: tokenUsage.cachedPromptTokens || 0,
    outputTokens: tokenUsage.completionTokens || 0,
    reasoningTokens: tokenUsage.reasoningTokens || 0,
    costs,
  });

  return costs;
}

