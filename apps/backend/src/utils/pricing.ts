import pricingConfigData from "../config/pricing.json";

export type Currency = "usd";

/**
 * Pricing tier for token thresholds
 * If threshold is not specified, applies to all tokens
 */
export interface PricingTier {
  threshold?: number; // Token count threshold (e.g., 200000 for 200k tokens)
  input: number; // Price per 1M input tokens
  output: number; // Price per 1M output tokens
  reasoning?: number; // Price per 1M reasoning tokens (optional)
  cachedInput?: number; // Price per 1M cached input tokens (optional, typically ~10% of input)
  request?: number; // Price per request (optional, fixed cost per API call)
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
  cachedInput?: number; // Price per 1M cached input tokens (optional, typically ~10% of input)
  request?: number; // Price per request (optional, fixed cost per API call)
  // Tiered pricing (new)
  tiers?: PricingTier[];
}

/**
 * Pricing for a model in USD.
 * All prices are per 1 million tokens.
 * Supports both flat pricing (backward compatible) and tiered pricing.
 * context_length: max context window in tokens (from OpenRouter Models API when available).
 */
export interface ModelPricing {
  usd: CurrencyPricing;
  capabilities?: ModelCapabilities;
  /** Max context window in tokens (e.g. from OpenRouter Models API). Used for input size checks. */
  context_length?: number;
}

export interface ModelCapabilities {
  input_modalities?: string[];
  output_modalities?: string[];
  supported_parameters?: string[];
  text_generation?: boolean;
  image_generation?: boolean;
  embeddings?: boolean;
  rerank?: boolean;
  tool_calling?: boolean;
  structured_output?: boolean;
  image?: boolean;
}

export interface ProviderPricing {
  models: Record<string, ModelPricing>;
}

export interface PricingConfig {
  providers: Record<string, ProviderPricing>;
  lastUpdated: string;
}

const REASONING_PARAMETERS = new Set(["reasoning", "include_reasoning"]);
const NANO_DOLLARS_PER_DOLLAR = 1_000_000_000;
const TOKEN_PRICE_SCALE = 1_000; // 1e9 (nano) / 1e6 (per-million tokens)

// Import pricing config directly (bundled with Lambda)
const config = pricingConfigData as PricingConfig;

/**
 * Load pricing configuration
 */
export function loadPricingConfig(): PricingConfig {
  return config;
}

/**
 * Returns the list of valid OpenRouter model names from pricing config.
 * Used to validate agent modelName and eval judge modelName in workspace export/import.
 */
export function getValidOpenRouterModelNames(): string[] {
  const pricingConfig = loadPricingConfig();
  const providerPricing = pricingConfig.providers.openrouter;
  if (!providerPricing?.models) {
    return [];
  }
  return Object.keys(providerPricing.models);
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

/** Default OpenRouter context length when not in pricing (tokens). */
export const OPENROUTER_DEFAULT_CONTEXT_LENGTH = 1_048_576;

/**
 * Get max context length in tokens for a model (e.g. from OpenRouter Models API via pricing).
 * Returns undefined if not set; callers should use OPENROUTER_DEFAULT_CONTEXT_LENGTH for OpenRouter when undefined.
 */
export function getModelContextLength(
  provider: string,
  modelName: string
): number | undefined {
  const pricing = getModelPricing(provider, modelName);
  const len = pricing?.context_length;
  return typeof len === "number" && len > 0 ? len : undefined;
}

/**
 * OpenRouter endpoint limit (tokens). Some models list 2M in pricing but the API
 * enforces 1M; cap so we never send more than the endpoint allows.
 */
export const OPENROUTER_MAX_CONTEXT_LENGTH = 1_048_576;

/**
 * Max safe input tokens before calling the LLM (90% of model context length).
 * Use this to fail fast instead of exceeding the provider limit.
 * For OpenRouter, never exceed 90% of OPENROUTER_MAX_CONTEXT_LENGTH so we stay
 * within the endpoint limit even when pricing lists a larger context.
 */
export function getMaxSafeInputTokens(
  provider: string,
  modelName: string
): number {
  const contextLength =
    getModelContextLength(provider, modelName) ??
    (provider === "openrouter" ? OPENROUTER_DEFAULT_CONTEXT_LENGTH : 128_000);
  const capped =
    provider === "openrouter"
      ? Math.min(contextLength, OPENROUTER_MAX_CONTEXT_LENGTH)
      : contextLength;
  return Math.floor(capped * 0.9);
}

/** Chars-per-token estimate used for prompt segment caps (~4 for typical models). */
const CHARS_PER_TOKEN_ESTIMATE = 4;

/** Upper bound for a single tool output in bytes (1 MiB). */
const MAX_TOOL_OUTPUT_MAX_BYTES = 1_048_576;
/** Fraction of model context (in tokens) allowed for one tool result (~10%). */
const MAX_TOOL_OUTPUT_CONTEXT_FRACTION = 0.1;

/**
 * Max bytes for a single tool output, derived from model context_length in metadata.
 * Uses a fraction of context so truncation is model-aware; capped at 1 MiB.
 */
export function getMaxToolOutputBytes(
  provider: string,
  modelName: string
): number {
  const contextLength =
    getModelContextLength(provider, modelName) ??
    (provider === "openrouter" ? OPENROUTER_DEFAULT_CONTEXT_LENGTH : 128_000);
  const capped =
    provider === "openrouter"
      ? Math.min(contextLength, OPENROUTER_MAX_CONTEXT_LENGTH)
      : contextLength;
  const segmentTokens = Math.floor(capped * MAX_TOOL_OUTPUT_CONTEXT_FRACTION);
  const segmentBytes = segmentTokens * CHARS_PER_TOKEN_ESTIMATE;
  return Math.min(MAX_TOOL_OUTPUT_MAX_BYTES, segmentBytes);
}

export interface MaxCharsForPromptSegmentOptions {
  /** Tokens to reserve for system prompt, tools, and other content (default 200k, or 50% of context for small models). */
  reservedTokens?: number;
  /** Minimum chars to allow for the segment (default 4000). */
  minChars?: number;
  /** Upper bound for the segment in chars (default 400_000). */
  maxChars?: number;
  charsPerToken?: number;
}

/**
 * Max characters allowed for a single prompt segment (e.g. schedule prompt or knowledge block)
 * so truncation is based on the model's context length. Reserves space for system prompt, tools, etc.
 */
export function getMaxCharsForPromptSegment(
  provider: string,
  modelName: string,
  options: MaxCharsForPromptSegmentOptions = {}
): number {
  const {
    minChars = 4000,
    maxChars = 400_000,
    charsPerToken = CHARS_PER_TOKEN_ESTIMATE,
  } = options;
  const maxSafe = getMaxSafeInputTokens(provider, modelName);
  const reservedTokens =
    options.reservedTokens ??
    Math.min(200_000, Math.floor(maxSafe * 0.5));
  const segmentMaxTokens = Math.max(0, maxSafe - reservedTokens);
  const segmentChars = Math.max(minChars, segmentMaxTokens * charsPerToken);
  return Math.min(maxChars, segmentChars);
}

export function supportsReasoningTokens(
  provider: string,
  modelName: string
): boolean {
  const pricing = getModelPricing(provider, modelName);
  const supportedParameters = pricing?.capabilities?.supported_parameters;
  if (!supportedParameters) {
    return false;
  }
  return supportedParameters.some((parameter) =>
    REASONING_PARAMETERS.has(parameter)
  );
}

export function isImageCapableModel(
  provider: string,
  modelName: string
): boolean {
  const modelPricing = getModelPricing(provider, modelName);
  return modelPricing?.capabilities?.image === true;
}

export function getImageCapableModels(provider: string): string[] {
  const pricingConfig = loadPricingConfig();
  const providerPricing = pricingConfig.providers[provider];
  if (!providerPricing) {
    return [];
  }
  const imageCapableModels = Object.entries(providerPricing.models)
    .filter(([, model]) => model.capabilities?.image === true)
    .map(([modelName]) => modelName);

  if (imageCapableModels.length > 0) {
    return imageCapableModels.sort();
  }

  return [];
}

/**
 * Calculate cost for tokens using tiered pricing
 * Tiers define pricing for different token count ranges
 * @param tokens - Number of tokens
 * @param tiers - Pricing tiers with thresholds
 * @param priceField - Field to use for pricing ('input', 'output', 'reasoning', or 'cachedInput')
 * @returns Total cost in nano-dollars (integer)
 */
function calculateTieredCost(
  tokens: number,
  tiers: PricingTier[],
  priceField: "input" | "output" | "reasoning" | "cachedInput" = "input"
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
        : priceField === "cachedInput"
        ? tier.cachedInput ?? tier.input
        : priceField === "reasoning"
        ? tier.reasoning ?? tier.output
        : tier.output;

    if (price === undefined) {
      continue;
    }

    if (tier.threshold === undefined || tier.threshold === null) {
      // No threshold means this tier applies to all remaining tokens
      // Price is per 1M tokens, so: (remainingTokens / 1_000_000) * price * 1_000_000_000 = remainingTokens * price * 1_000
      // Always round up to ensure we never undercharge
      const cost = Math.ceil(remainingTokens * price * TOKEN_PRICE_SCALE);
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
          // Price is per 1M tokens, so: (tokensToCharge / 1_000_000) * price * 1_000_000_000 = tokensToCharge * price * 1_000
          // Always round up to ensure we never undercharge
          const cost = Math.ceil(tokensToCharge * price * TOKEN_PRICE_SCALE);
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
          : priceField === "cachedInput"
          ? defaultTier.cachedInput ?? defaultTier.input
          : priceField === "reasoning"
          ? defaultTier.reasoning ?? defaultTier.output
          : defaultTier.output;
      if (price !== undefined) {
        // Price is per 1M tokens, so: (remainingTokens / 1_000_000) * price * 1_000_000_000 = remainingTokens * price * 1_000
        // Always round up to ensure we never undercharge
        const cost = Math.ceil(remainingTokens * price * TOKEN_PRICE_SCALE);
        totalCost += cost;
      }
    }
  }

  return totalCost;
}

/**
 * Calculate cost for input tokens using pricing structure
 * @returns Cost in nano-dollars (integer)
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
  // Price is per 1M tokens, so: (inputTokens / 1_000_000) * price * 1_000_000_000 = inputTokens * price * 1_000
  // Always round up to ensure we never undercharge
  if (currencyPricing.input !== undefined) {
    return Math.ceil(inputTokens * currencyPricing.input * TOKEN_PRICE_SCALE);
  }

  return 0;
}

/**
 * Calculate cost for output tokens using pricing structure
 * @returns Cost in nano-dollars (integer)
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
  // Price is per 1M tokens, so: (outputTokens / 1_000_000) * price * 1_000_000_000 = outputTokens * price * 1_000
  // Always round up to ensure we never undercharge
  if (currencyPricing.output !== undefined) {
    return Math.ceil(outputTokens * currencyPricing.output * TOKEN_PRICE_SCALE);
  }

  return 0;
}

/**
 * Calculate cost for cached input tokens using pricing structure
 * Cached tokens are typically charged at ~10% of regular input token rate
 * @returns Cost in nano-dollars (integer)
 */
function calculateCachedInputCost(
  cachedTokens: number,
  currencyPricing: CurrencyPricing
): number {
  if (cachedTokens === 0) {
    return 0;
  }

  // Check if tiered pricing is used
  if (currencyPricing.tiers && currencyPricing.tiers.length > 0) {
    // Check if any tier has cached input pricing
    const hasCachedInputPricing = currencyPricing.tiers.some(
      (tier) => tier.cachedInput !== undefined
    );

    if (hasCachedInputPricing) {
      return calculateTieredCost(
        cachedTokens,
        currencyPricing.tiers,
        "cachedInput"
      );
    }
    // If no cached input pricing in tiers, fall through to use input pricing
  }

  // Use flat pricing (backward compatible)
  // Price is per 1M tokens, so: (cachedTokens / 1_000_000) * price * 1_000_000_000 = cachedTokens * price * 1_000
  // Always round up to ensure we never undercharge
  if (currencyPricing.cachedInput !== undefined) {
    return Math.ceil(cachedTokens * currencyPricing.cachedInput * TOKEN_PRICE_SCALE);
  }

  // If no cached input pricing is specified, treat cached tokens as regular input tokens
  // This is a fallback - ideally cached pricing should be configured
  return calculateInputCost(cachedTokens, currencyPricing);
}

/**
 * Calculate cost for reasoning tokens using pricing structure
 * @returns Cost in nano-dollars (integer)
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
  // Price is per 1M tokens, so: (reasoningTokens / 1_000_000) * price * 1_000_000_000 = reasoningTokens * price * 1_000
  // Always round up to ensure we never undercharge
  if (currencyPricing.reasoning !== undefined) {
    return Math.ceil(reasoningTokens * currencyPricing.reasoning * TOKEN_PRICE_SCALE);
  }

  // If no reasoning pricing is specified, treat reasoning tokens as regular output tokens
  return calculateOutputCost(reasoningTokens, currencyPricing);
}

/**
 * Calculate cost for token usage in a specific currency
 * Supports both flat and tiered pricing, reasoning tokens, and cached tokens
 * @returns Cost in nano-dollars (integer)
 */
export function calculateTokenCost(
  provider: string,
  modelName: string,
  inputTokens: number,
  outputTokens: number,
  reasoningTokens: number = 0,
  cachedPromptTokens: number = 0
): number {
  console.log("[calculateTokenCost] Input:", {
    provider,
    modelName,
    inputTokens,
    outputTokens,
    reasoningTokens,
    cachedPromptTokens,
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

  const currencyPricing = pricing.usd;
  if (!currencyPricing) {
    console.warn(
      `[calculateTokenCost] No USD pricing found for provider: ${provider}, model: ${modelName}`
    );
    return 0;
  }

  // Calculate costs for each token type (all in nano-dollars)
  const inputCost = calculateInputCost(inputTokens, currencyPricing);
  const cachedInputCost = calculateCachedInputCost(
    cachedPromptTokens,
    currencyPricing
  );
  const outputCost = calculateOutputCost(outputTokens, currencyPricing);
  const reasoningCost = calculateReasoningCost(
    reasoningTokens,
    currencyPricing
  );

  // Calculate request cost (fixed cost per request, if applicable)
  // Request pricing is in USD, convert to nano-dollars
  let requestCost = 0;
  if (currencyPricing.request !== undefined && currencyPricing.request > 0) {
    // Request pricing is per request, not per token
    // Convert from USD to nano-dollars and round up to ensure we never undercharge
    requestCost = Math.ceil(currencyPricing.request * NANO_DOLLARS_PER_DOLLAR);
    console.log("[calculateTokenCost] Request cost:", {
      requestPrice: currencyPricing.request,
      requestCostInNanoDollars: requestCost,
    });
  }

  // Sum all costs (all already in nano-dollars, so simple addition)
  const baseCost =
    inputCost + cachedInputCost + outputCost + reasoningCost + requestCost;
  let totalCost = baseCost;

  // Apply 5.5% markup for OpenRouter to account for credit purchase fee
  // OpenRouter charges 5.5% fee when adding credits to account
  if (provider === "openrouter") {
    // Multiply by 1.055 and round up (ceiling) to ensure we cover the fee
    totalCost = Math.ceil(baseCost * 1.055);
    console.log("[calculateTokenCost] Applied 5.5% OpenRouter markup:", {
      baseCost,
      totalCostWithMarkup: totalCost,
    });
  }

  console.log("[calculateTokenCost] Calculated:", {
    provider,
    modelName,
    inputTokens,
    cachedPromptTokens,
    outputTokens,
    reasoningTokens,
    inputCost,
    cachedInputCost,
    outputCost,
    reasoningCost,
    requestCost,
    totalCost,
    breakdown: {
      inputCost,
      cachedInputCost,
      outputCost,
      reasoningCost,
      requestCost,
      totalCost,
    },
  });

  return totalCost;
}

/**
 * Calculate costs for USD
 * Supports reasoning tokens and cached tokens
 * @deprecated Use calculateTokenCost directly instead
 */
export function calculateTokenCosts(
  provider: string,
  modelName: string,
  inputTokens: number,
  outputTokens: number,
  reasoningTokens: number = 0,
  cachedPromptTokens: number = 0
): {
  usd: number;
} {
  return {
    usd: calculateTokenCost(
      provider,
      modelName,
      inputTokens,
      outputTokens,
      reasoningTokens,
      cachedPromptTokens
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
