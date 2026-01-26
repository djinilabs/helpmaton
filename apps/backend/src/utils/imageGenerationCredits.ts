import type { ModelMessage } from "ai";

import { calculateTokenCost, getModelPricing } from "./pricing";
import { estimateInputTokens } from "./tokenEstimation";

type ImageCostEstimateParams = {
  provider: string;
  modelName: string;
  prompt: string;
};

/**
 * Estimate image generation cost in nano-dollars.
 * Prefers request-based pricing when available, otherwise falls back to token estimation.
 */
export function estimateImageGenerationCost({
  provider,
  modelName,
  prompt,
}: ImageCostEstimateParams): number {
  const pricing = getModelPricing(provider, modelName);
  const requestPrice = pricing?.usd?.request;

  if (typeof requestPrice === "number" && requestPrice > 0) {
    return calculateTokenCost(provider, modelName, 0, 0, 0, 0);
  }

  const messages: ModelMessage[] = [
    {
      role: "user",
      content: prompt,
    },
  ];
  const estimatedInputTokens = estimateInputTokens(messages);
  const estimatedOutputTokens = 1000;
  return calculateTokenCost(
    provider,
    modelName,
    estimatedInputTokens,
    estimatedOutputTokens,
    0,
    0
  );
}
