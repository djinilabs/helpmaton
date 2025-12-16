import type { TokenUsage } from "./conversationLogger";
import { fromMillionths } from "./creditConversions";
import { calculateTokenCost, getModelPricing, type Currency } from "./pricing";

/**
 * Detailed cost breakdown for a single token usage
 */
export interface CostBreakdown {
  provider: string;
  modelName: string;
  currency: Currency;
  tokenUsage: TokenUsage;
  costs: {
    inputCost: number;
    cachedInputCost: number;
    outputCost: number;
    reasoningCost: number;
    totalCost: number;
  };
  tokenCounts: {
    promptTokens: number;
    cachedPromptTokens: number;
    completionTokens: number;
    reasoningTokens: number;
    totalTokens: number;
  };
}

/**
 * Generate a detailed cost breakdown for token usage
 */
export function generateCostBreakdown(
  provider: string,
  modelName: string,
  tokenUsage: TokenUsage,
  currency: Currency = "usd"
): CostBreakdown | null {
  const pricing = getModelPricing(provider, modelName);
  if (!pricing) {
    console.warn(
      `[generateCostBreakdown] No pricing found for provider: ${provider}, model: ${modelName}`
    );
    return null;
  }

  const currencyPricing = pricing[currency];
  if (!currencyPricing) {
    console.warn(
      `[generateCostBreakdown] No pricing found for currency: ${currency}`
    );
    return null;
  }

  const promptTokens = tokenUsage.promptTokens || 0;
  const cachedPromptTokens = tokenUsage.cachedPromptTokens || 0;
  const completionTokens = tokenUsage.completionTokens || 0;
  const reasoningTokens = tokenUsage.reasoningTokens || 0;
  const totalTokens = tokenUsage.totalTokens || 0;

  const totalCost = calculateTokenCost(
    provider,
    modelName,
    promptTokens,
    completionTokens,
    currency,
    reasoningTokens,
    cachedPromptTokens
  );

  // Calculate individual costs by calling pricing functions directly
  // We need to import the internal functions or recalculate
  // For now, we'll use the total and note that individual costs are logged in calculateTokenCost

  return {
    provider,
    modelName,
    currency,
    tokenUsage,
    costs: {
      inputCost: 0, // Will be calculated from logs or we need to expose internal functions
      cachedInputCost: 0,
      outputCost: 0,
      reasoningCost: 0,
      totalCost,
    },
    tokenCounts: {
      promptTokens,
      cachedPromptTokens,
      completionTokens,
      reasoningTokens,
      totalTokens,
    },
  };
}

/**
 * Compare calculated cost with expected cost and log discrepancies
 */
export function compareCosts(
  calculatedCost: number,
  expectedCost: number,
  tokenUsage: TokenUsage,
  provider: string,
  modelName: string,
  currency: Currency = "usd"
): {
  match: boolean;
  difference: number;
  percentageDifference: number;
  breakdown: CostBreakdown | null;
} {
  // Both calculatedCost and expectedCost are in millionths
  const difference = calculatedCost - expectedCost;
  const percentageDifference =
    expectedCost > 0 ? (difference / expectedCost) * 100 : 0;
  // Allow for small difference in millionths (equivalent to 0.0001 currency units)
  const match = Math.abs(difference) < 100; // 100 millionths = 0.0001 currency units

  const breakdown = generateCostBreakdown(
    provider,
    modelName,
    tokenUsage,
    currency
  );

  console.log("[compareCosts] Cost comparison:", {
    provider,
    modelName,
    currency,
    calculatedCost,
    expectedCost,
    difference,
    percentageDifference: `${percentageDifference.toFixed(2)}%`,
    match,
    tokenUsage: {
      promptTokens: tokenUsage.promptTokens || 0,
      cachedPromptTokens: tokenUsage.cachedPromptTokens || 0,
      completionTokens: tokenUsage.completionTokens || 0,
      reasoningTokens: tokenUsage.reasoningTokens || 0,
      totalTokens: tokenUsage.totalTokens || 0,
    },
    breakdown,
  });

  if (!match) {
    console.warn("[compareCosts] Cost discrepancy detected:", {
      calculatedCost,
      expectedCost,
      difference,
      percentageDifference: `${percentageDifference.toFixed(2)}%`,
      tokenUsage,
    });
  }

  return {
    match,
    difference,
    percentageDifference,
    breakdown,
  };
}

/**
 * Validate that token usage extraction is complete
 * Checks for missing or unexpected fields
 */
export function validateTokenUsageExtraction(
  tokenUsage: TokenUsage | undefined,
  rawUsage: unknown
): {
  valid: boolean;
  warnings: string[];
  missingFields: string[];
  unexpectedFields: string[];
} {
  const warnings: string[] = [];
  const missingFields: string[] = [];
  const unexpectedFields: string[] = [];

  if (!tokenUsage) {
    warnings.push("Token usage is undefined");
    return {
      valid: false,
      warnings,
      missingFields: ["tokenUsage"],
      unexpectedFields: [],
    };
  }

  // Check for required fields
  if (
    tokenUsage.promptTokens === undefined ||
    tokenUsage.promptTokens === null
  ) {
    missingFields.push("promptTokens");
  }
  if (
    tokenUsage.completionTokens === undefined ||
    tokenUsage.completionTokens === null
  ) {
    missingFields.push("completionTokens");
  }
  if (tokenUsage.totalTokens === undefined || tokenUsage.totalTokens === null) {
    missingFields.push("totalTokens");
  }

  // Check if cached tokens are present but not being used
  if (
    typeof rawUsage === "object" &&
    rawUsage !== null &&
    "usage" in rawUsage
  ) {
    const usage = (rawUsage as { usage?: unknown }).usage;
    if (typeof usage === "object" && usage !== null) {
      const usageObj = usage as Record<string, unknown>;
      const knownFields = [
        "promptTokens",
        "inputTokens",
        "promptTokenCount",
        "completionTokens",
        "outputTokens",
        "completionTokenCount",
        "totalTokens",
        "totalTokenCount",
        "cachedPromptTokenCount",
        "cachedPromptTokens",
        "cachedTokens",
        "reasoningTokens",
        "reasoning",
      ];

      for (const key of Object.keys(usageObj)) {
        if (!knownFields.includes(key)) {
          unexpectedFields.push(key);
        }
      }

      // Check if cached tokens exist in raw data but not in extracted data
      if (
        ("cachedPromptTokenCount" in usageObj ||
          "cachedPromptTokens" in usageObj ||
          "cachedTokens" in usageObj) &&
        !tokenUsage.cachedPromptTokens
      ) {
        warnings.push(
          "Cached tokens found in raw usage but not extracted to tokenUsage"
        );
      }
    }
  }

  const valid = missingFields.length === 0;

  if (warnings.length > 0 || missingFields.length > 0) {
    console.warn("[validateTokenUsageExtraction] Validation issues:", {
      valid,
      warnings,
      missingFields,
      unexpectedFields,
      tokenUsage,
    });
  }

  return {
    valid,
    warnings,
    missingFields,
    unexpectedFields,
  };
}

/**
 * Generate a detailed cost report for debugging
 */
export function generateCostReport(
  provider: string,
  modelName: string,
  tokenUsage: TokenUsage,
  currency: Currency = "usd",
  expectedCost?: number
): string {
  const breakdown = generateCostBreakdown(
    provider,
    modelName,
    tokenUsage,
    currency
  );

  if (!breakdown) {
    return `Cost Report: Unable to generate breakdown for ${provider}/${modelName}`;
  }

  const lines: string[] = [];
  lines.push("=".repeat(60));
  lines.push(
    `Cost Report: ${provider}/${modelName} (${currency.toUpperCase()})`
  );
  lines.push("=".repeat(60));
  lines.push("");
  lines.push("Token Counts:");
  lines.push(
    `  Prompt Tokens:        ${breakdown.tokenCounts.promptTokens.toLocaleString()}`
  );
  lines.push(
    `  Cached Prompt Tokens: ${breakdown.tokenCounts.cachedPromptTokens.toLocaleString()}`
  );
  lines.push(
    `  Completion Tokens:    ${breakdown.tokenCounts.completionTokens.toLocaleString()}`
  );
  lines.push(
    `  Reasoning Tokens:     ${breakdown.tokenCounts.reasoningTokens.toLocaleString()}`
  );
  lines.push(
    `  Total Tokens:         ${breakdown.tokenCounts.totalTokens.toLocaleString()}`
  );
  lines.push("");
  lines.push("Cost Breakdown:");
  // Convert from millionths to currency units for display
  lines.push(
    `  Input Cost:           $${fromMillionths(
      breakdown.costs.inputCost
    ).toFixed(6)}`
  );
  lines.push(
    `  Cached Input Cost:    $${fromMillionths(
      breakdown.costs.cachedInputCost
    ).toFixed(6)}`
  );
  lines.push(
    `  Output Cost:          $${fromMillionths(
      breakdown.costs.outputCost
    ).toFixed(6)}`
  );
  lines.push(
    `  Reasoning Cost:       $${fromMillionths(
      breakdown.costs.reasoningCost
    ).toFixed(6)}`
  );
  lines.push(
    `  Total Cost:           $${fromMillionths(
      breakdown.costs.totalCost
    ).toFixed(6)}`
  );

  if (expectedCost !== undefined) {
    lines.push("");
    lines.push("Cost Comparison:");
    // Both values are in millionths, convert to currency units for display
    const calculatedCostDisplay = fromMillionths(breakdown.costs.totalCost);
    const expectedCostDisplay = fromMillionths(expectedCost);
    const differenceDisplay = calculatedCostDisplay - expectedCostDisplay;
    const percentageDifference =
      expectedCostDisplay > 0
        ? (differenceDisplay / expectedCostDisplay) * 100
        : 0;
    lines.push(`  Calculated Cost:     $${calculatedCostDisplay.toFixed(6)}`);
    lines.push(`  Expected Cost:       $${expectedCostDisplay.toFixed(6)}`);
    lines.push(
      `  Difference:          $${differenceDisplay.toFixed(
        6
      )} (${percentageDifference.toFixed(2)}%)`
    );
  }

  lines.push("=".repeat(60));

  return lines.join("\n");
}
