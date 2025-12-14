import pricingConfigData from "../config/pricing.json";

export type Currency = "usd" | "eur" | "gbp";

/**
 * Pricing tier for token thresholds
 * If threshold is not specified, applies to all tokens
 */
export interface PricingTier {
  threshold?: number; // Token count threshold (e.g., 200000 for 200k tokens)
  input: number; // Price per 1M input tokens
  output: number; // Price per 1M output tokens
  reasoning?: number; // Price per 1M reasoning tokens (optional)
}

/**
 * Currency-specific pricing structure
 * Supports both flat pricing (single tier) and tiered pricing (multiple tiers)
 */
export interface CurrencyPricing {
  // Flat pricing (backward compatible)
  input?: number;
  output?: number;
  reasoning?: number;
  // Tiered pricing (new)
  tiers?: PricingTier[];
}

/**
 * Pricing for a model in multiple currencies.
 * All prices are per 1 million tokens.
 * Supports both flat pricing (backward compatible) and tiered pricing.
 */
export interface ModelPricing {
  usd: CurrencyPricing;
  eur: CurrencyPricing;
  gbp: CurrencyPricing;
}

export interface ProviderPricing {
  models: Record<string, ModelPricing>;
}

export interface PricingConfig {
  providers: Record<string, ProviderPricing>;
  lastUpdated: string;
}

// Import pricing config directly (bundled with Lambda)
const config = pricingConfigData as PricingConfig;

/**
 * Load pricing configuration
 */
export function loadPricingConfig(): PricingConfig {
  return config;
}

/**
 * Normalize model name to handle preview versions and variants
 * Maps preview/variant model names to their base model pricing
 */
function normalizeModelName(modelName: string): string {
  // If exact match exists, use it
  // Otherwise, try to match base model names
  // e.g., "gemini-2.5-flash-preview-05-20" -> try "gemini-2.5-flash"

  // List of base model patterns (longest first for proper matching)
  const baseModels = [
    "gemini-2.5-flash",
    "gemini-2.0-flash-exp",
    "gemini-1.5-pro",
    "gemini-1.5-flash",
  ];

  // Check if model name starts with any base model name
  for (const baseModel of baseModels) {
    if (modelName.startsWith(baseModel)) {
      return baseModel;
    }
  }

  // Return original if no match found
  return modelName;
}

/**
 * Get pricing for a specific provider and model
 */
export function getModelPricing(
  provider: string,
  modelName: string
): ModelPricing | undefined {
  const pricingConfig = loadPricingConfig();
  const providerPricing = pricingConfig.providers[provider];
  if (!providerPricing) {
    return undefined;
  }

  // Try exact match first
  if (providerPricing.models[modelName]) {
    return providerPricing.models[modelName];
  }

  // Try normalized model name (for preview versions)
  const normalizedName = normalizeModelName(modelName);
  if (normalizedName !== modelName && providerPricing.models[normalizedName]) {
    return providerPricing.models[normalizedName];
  }

  return undefined;
}

/**
 * Calculate cost for tokens using tiered pricing
 * Tiers define pricing for different token count ranges
 * @param tokens - Number of tokens
 * @param tiers - Pricing tiers with thresholds
 * @param priceField - Field to use for pricing ('input' or 'output')
 * @returns Total cost for the tokens
 */
function calculateTieredCost(
  tokens: number,
  tiers: PricingTier[],
  priceField: "input" | "output" | "reasoning" = "input"
): number {
  if (tiers.length === 0 || tokens === 0) {
    return 0;
  }

  // Sort tiers by threshold (undefined thresholds treated as "above all others")
  // Tiers with thresholds come first, sorted ascending
  const sortedTiers = [...tiers].sort((a, b) => {
    if (a.threshold === undefined && b.threshold === undefined) {
      return 0;
    }
    if (a.threshold === undefined) {
      return 1; // No threshold comes after all thresholds
    }
    if (b.threshold === undefined) {
      return -1; // No threshold comes after all thresholds
    }
    return a.threshold - b.threshold;
  });

  let remainingTokens = tokens;
  let totalCost = 0;

  // Process tiers in order
  for (let i = 0; i < sortedTiers.length && remainingTokens > 0; i++) {
    const tier = sortedTiers[i];
    const price =
      priceField === "input"
        ? tier.input
        : priceField === "reasoning"
        ? tier.reasoning ?? tier.output
        : tier.output;

    if (price === undefined) {
      continue;
    }

    if (tier.threshold === undefined || tier.threshold === null) {
      // No threshold means this tier applies to all remaining tokens
      const cost = (remainingTokens / 1_000_000) * price;
      totalCost += cost;
      remainingTokens = 0;
    } else {
      // Calculate tokens in this tier range
      const previousThreshold =
        i === 0 ? 0 : sortedTiers[i - 1]?.threshold ?? 0;
      const currentThreshold = tier.threshold;

      if (tokens > previousThreshold) {
        // Calculate how many tokens fall in this tier
        const tierStart = previousThreshold;
        const tierEnd = Math.min(tokens, currentThreshold);
        const tokensInTier = Math.max(0, tierEnd - tierStart);

        if (tokensInTier > 0 && remainingTokens > 0) {
          const tokensToCharge = Math.min(tokensInTier, remainingTokens);
          const cost = (tokensToCharge / 1_000_000) * price;
          totalCost += cost;
          remainingTokens -= tokensToCharge;
        }
      }
    }
  }

  // If there are still remaining tokens and we have a tier without threshold, apply it
  if (remainingTokens > 0) {
    const defaultTier = sortedTiers.find((t) => t.threshold === undefined);
    if (defaultTier) {
      const price =
        priceField === "input"
          ? defaultTier.input
          : priceField === "reasoning"
          ? defaultTier.reasoning ?? defaultTier.output
          : defaultTier.output;
      if (price !== undefined) {
        const cost = (remainingTokens / 1_000_000) * price;
        totalCost += cost;
      }
    }
  }

  return totalCost;
}

/**
 * Calculate cost for input tokens using pricing structure
 */
function calculateInputCost(
  inputTokens: number,
  currencyPricing: CurrencyPricing
): number {
  // Check if tiered pricing is used
  if (currencyPricing.tiers && currencyPricing.tiers.length > 0) {
    return calculateTieredCost(inputTokens, currencyPricing.tiers, "input");
  }

  // Use flat pricing (backward compatible)
  if (currencyPricing.input !== undefined) {
    return (inputTokens / 1_000_000) * currencyPricing.input;
  }

  return 0;
}

/**
 * Calculate cost for output tokens using pricing structure
 */
function calculateOutputCost(
  outputTokens: number,
  currencyPricing: CurrencyPricing
): number {
  // Check if tiered pricing is used
  if (currencyPricing.tiers && currencyPricing.tiers.length > 0) {
    return calculateTieredCost(outputTokens, currencyPricing.tiers, "output");
  }

  // Use flat pricing (backward compatible)
  if (currencyPricing.output !== undefined) {
    return (outputTokens / 1_000_000) * currencyPricing.output;
  }

  return 0;
}

/**
 * Calculate cost for reasoning tokens using pricing structure
 */
function calculateReasoningCost(
  reasoningTokens: number,
  currencyPricing: CurrencyPricing
): number {
  if (reasoningTokens === 0) {
    return 0;
  }

  // Check if tiered pricing is used
  if (currencyPricing.tiers && currencyPricing.tiers.length > 0) {
    // Check if any tier has reasoning pricing
    const hasReasoningPricing = currencyPricing.tiers.some(
      (tier) => tier.reasoning !== undefined
    );

    if (hasReasoningPricing) {
      return calculateTieredCost(
        reasoningTokens,
        currencyPricing.tiers,
        "reasoning"
      );
    }
    // If no reasoning pricing in tiers, fall through to use output pricing
  }

  // Use flat pricing (backward compatible)
  if (currencyPricing.reasoning !== undefined) {
    return (reasoningTokens / 1_000_000) * currencyPricing.reasoning;
  }

  // If no reasoning pricing is specified, treat reasoning tokens as regular output tokens
  return calculateOutputCost(reasoningTokens, currencyPricing);
}

/**
 * Calculate cost for token usage in a specific currency
 * Supports both flat and tiered pricing, and reasoning tokens
 */
export function calculateTokenCost(
  provider: string,
  modelName: string,
  inputTokens: number,
  outputTokens: number,
  currency: Currency = "usd",
  reasoningTokens: number = 0
): number {
  console.log("[calculateTokenCost] Input:", {
    provider,
    modelName,
    inputTokens,
    outputTokens,
    reasoningTokens,
    currency,
  });

  const pricing = getModelPricing(provider, modelName);
  if (!pricing) {
    console.warn(
      `[calculateTokenCost] No pricing found for provider: ${provider}, model: ${modelName}`
    );
    const config = loadPricingConfig();
    console.warn(
      `[calculateTokenCost] Available providers:`,
      Object.keys(config.providers)
    );
    if (config.providers[provider]) {
      console.warn(
        `[calculateTokenCost] Available models for ${provider}:`,
        Object.keys(config.providers[provider].models)
      );
    }
    return 0;
  }

  const currencyPricing = pricing[currency];
  if (!currencyPricing) {
    console.warn(
      `[calculateTokenCost] No pricing found for currency: ${currency} in provider: ${provider}, model: ${modelName}`
    );
    return 0;
  }

  // Calculate costs for each token type
  const inputCost = calculateInputCost(inputTokens, currencyPricing);
  const outputCost = calculateOutputCost(outputTokens, currencyPricing);
  const reasoningCost = calculateReasoningCost(
    reasoningTokens,
    currencyPricing
  );

  // Round to 6 decimal places to avoid floating point precision issues
  const totalCost =
    Math.round((inputCost + outputCost + reasoningCost) * 1_000_000) /
    1_000_000;

  console.log("[calculateTokenCost] Calculated:", {
    provider,
    modelName,
    currency,
    inputTokens,
    outputTokens,
    reasoningTokens,
    inputCost,
    outputCost,
    reasoningCost,
    totalCost,
  });

  return totalCost;
}

/**
 * Calculate costs for all currencies
 * Supports reasoning tokens
 */
export function calculateTokenCosts(
  provider: string,
  modelName: string,
  inputTokens: number,
  outputTokens: number,
  reasoningTokens: number = 0
): {
  usd: number;
  eur: number;
  gbp: number;
} {
  return {
    usd: calculateTokenCost(
      provider,
      modelName,
      inputTokens,
      outputTokens,
      "usd",
      reasoningTokens
    ),
    eur: calculateTokenCost(
      provider,
      modelName,
      inputTokens,
      outputTokens,
      "eur",
      reasoningTokens
    ),
    gbp: calculateTokenCost(
      provider,
      modelName,
      inputTokens,
      outputTokens,
      "gbp",
      reasoningTokens
    ),
  };
}

/**
 * Clear cached pricing (useful for testing or after updates)
 * @deprecated This function is a no-op since pricing is imported directly from JSON.
 * It is kept for backward compatibility only. Consider removing calls to this function.
 */
export function clearPricingCache(): void {
  // No-op since we're importing directly
}
