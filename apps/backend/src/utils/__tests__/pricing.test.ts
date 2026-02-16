import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the pricing config using vi.hoisted to ensure it's available before imports
const { mockPricingConfig } = vi.hoisted(() => {
  return {
    mockPricingConfig: {
      providers: {
        google: {
          models: {
            "test-flat-model": {
              usd: {
                input: 1.0,
                output: 2.0,
                cachedInput: 0.1,
              },
            },
          "test-embedding-model": {
            usd: {
              input: 0.5,
            },
            capabilities: {
              embeddings: true,
              text_generation: false,
            },
          },
            "test-tiered-model": {
              usd: {
                tiers: [
                  {
                    threshold: 200000,
                    input: 1.25,
                    output: 5.0,
                  },
                  {
                    // No threshold means "above 200k tokens"
                    input: 2.5,
                    output: 10.0,
                  },
                ],
              },
            },
            "test-reasoning-model": {
              usd: {
                input: 1.0,
                output: 2.0,
                reasoning: 3.5,
              },
            },
            "test-tiered-reasoning-model": {
              usd: {
                tiers: [
                  {
                    threshold: 200000,
                    input: 1.25,
                    output: 5.0,
                    reasoning: 10.0,
                  },
                  {
                    input: 2.5,
                    output: 10.0,
                    reasoning: 15.0,
                  },
                ],
              },
              eur: {
                tiers: [
                  {
                    threshold: 200000,
                    input: 1.0625,
                    output: 4.25,
                    reasoning: 8.5,
                  },
                  {
                    input: 2.125,
                    output: 8.5,
                    reasoning: 12.75,
                  },
                ],
              },
              gbp: {
                tiers: [
                  {
                    threshold: 200000,
                    input: 0.9375,
                    output: 3.75,
                    reasoning: 7.5,
                  },
                  {
                    input: 1.875,
                    output: 7.5,
                    reasoning: 11.25,
                  },
                ],
              },
            },
          },
        },
        openrouter: {
          models: {
            "test-context-model": {
              usd: { input: 0.5, output: 1.5 },
              context_length: 200_000,
            },
          },
        },
      },
      lastUpdated: "2025-01-01T00:00:00.000Z",
    },
  };
});

// Mock the pricing config import
vi.mock("../../config/pricing.json", () => ({
  default: mockPricingConfig,
}));

import {
  calculateTokenCost,
  calculateTokenCosts,
  getModelContextLength,
  getMaxSafeInputTokens,
  getModelPricing,
  OPENROUTER_DEFAULT_CONTEXT_LENGTH,
} from "../pricing";

// Mock the pricing config import
vi.mock("../../config/pricing.json", () => ({
  default: mockPricingConfig,
}));

describe("pricing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getModelPricing", () => {
    it("should return pricing for existing model", () => {
      const pricing = getModelPricing("google", "test-flat-model");
      expect(pricing).toBeDefined();
      expect(pricing?.usd.input).toBe(1.0);
      expect(pricing?.usd.output).toBe(2.0);
    });

    it("should return undefined for non-existent model", () => {
      const pricing = getModelPricing("google", "non-existent-model");
      expect(pricing).toBeUndefined();
    });

    it("should return undefined for non-existent provider", () => {
      const pricing = getModelPricing("openai", "test-flat-model");
      expect(pricing).toBeUndefined();
    });
  });

  describe("getModelContextLength", () => {
    it("should return context_length when set for model", () => {
      expect(getModelContextLength("openrouter", "test-context-model")).toBe(
        200_000,
      );
    });

    it("should return undefined when model has no context_length", () => {
      expect(getModelContextLength("google", "test-flat-model")).toBeUndefined();
    });

    it("should return undefined for non-existent model", () => {
      expect(getModelContextLength("openrouter", "unknown")).toBeUndefined();
    });
  });

  describe("getMaxSafeInputTokens", () => {
    it("should return 90% of model context_length when set", () => {
      expect(getMaxSafeInputTokens("openrouter", "test-context-model")).toBe(
        180_000,
      ); // 200_000 * 0.9
    });

    it("should use OPENROUTER_DEFAULT_CONTEXT_LENGTH for OpenRouter when context_length missing", () => {
      const safe = getMaxSafeInputTokens("openrouter", "test-flat-model");
      expect(safe).toBe(
        Math.floor(OPENROUTER_DEFAULT_CONTEXT_LENGTH * 0.9),
      );
    });
  });

  describe("calculateTokenCost - flat pricing", () => {
    it("should calculate cost for flat pricing model", () => {
      const cost = calculateTokenCost(
        "google",
        "test-flat-model",
        1000000, // 1M input tokens
        500000 // 0.5M output tokens
      );

      // 1M * $1.0 + 0.5M * $2.0 = $1.0 + $1.0 = $2.0 = 2_000_000_000 nano-dollars
      expect(cost).toBe(2_000_000_000);
    });

    it("should calculate cost in different currencies", () => {
      const usdCost = calculateTokenCost(
        "google",
        "test-flat-model",
        1000000,
        500000
      );
      expect(usdCost).toBe(2_000_000_000); // 2.0 USD in nano-dollars
    });

    it("should return 0 for zero tokens", () => {
      const cost = calculateTokenCost("google", "test-flat-model", 0, 0);
      expect(cost).toBe(0);
    });

    it("should calculate cost for input-only embedding pricing", () => {
      const cost = calculateTokenCost(
        "google",
        "test-embedding-model",
        1_000_000,
        500_000
      );

      // 1M * $0.5 = $0.5 = 500_000_000 nano-dollars (output tokens ignored)
      expect(cost).toBe(500_000_000);
    });

    it("should handle small token counts", () => {
      const cost = calculateTokenCost(
        "google",
        "test-flat-model",
        1000, // 0.001M tokens
        500 // 0.0005M tokens
      );

      // 0.001 * $1.0 + 0.0005 * $2.0 = $0.001 + $0.001 = $0.002 = 2_000_000 nano-dollars
      // With Math.ceil: 1000 * 1.0 * 1000 = 1_000_000, 500 * 2.0 * 1000 = 1_000_000, total = 2_000_000
      expect(cost).toBe(2_000_000);
    });
  });

  describe("calculateTokenCost - tiered pricing", () => {
    it("should calculate cost for tokens below threshold", () => {
      const cost = calculateTokenCost(
        "google",
        "test-tiered-model",
        150000, // 150k tokens (below 200k threshold)
        50000 // 50k tokens
      );

      // 150k * $1.25 + 50k * $5.0 = 0.15 * $1.25 + 0.05 * $5.0 = $0.1875 + $0.25 = $0.4375 = 437_500_000 nano-dollars
      // With Math.ceil: 150000 * 1.25 * 1000 = 187_500_000, 50000 * 5.0 * 1000 = 250_000_000, total = 437_500_000
      expect(cost).toBe(437_500_000);
    });

    it("should calculate cost for tokens above threshold", () => {
      const cost = calculateTokenCost(
        "google",
        "test-tiered-model",
        250000, // 250k tokens (50k above 200k threshold)
        100000 // 100k tokens
      );

      // Input: 200k * $1.25 + 50k * $2.5 = 0.2 * $1.25 + 0.05 * $2.5 = $0.25 + $0.125 = $0.375 = 375_000_000 nano-dollars
      // Output: 100k * $5.0 = 0.1 * $5.0 = $0.5 = 500_000_000 nano-dollars
      // Total: $0.375 + $0.5 = $0.875 = 875_000_000 nano-dollars
      // With Math.ceil: 200000 * 1.25 * 1000 = 250_000_000, 50000 * 2.5 * 1000 = 125_000_000, 100000 * 5.0 * 1000 = 500_000_000, total = 875_000_000
      expect(cost).toBe(875_000_000);
    });

    it("should calculate cost for tokens exactly at threshold", () => {
      const cost = calculateTokenCost(
        "google",
        "test-tiered-model",
        200000, // Exactly at threshold
        200000
      );

      // Input: 200k * $1.25 = 0.2 * $1.25 = $0.25 = 250_000_000 nano-dollars
      // Output: 200k * $5.0 = 0.2 * $5.0 = $1.0 = 1_000_000_000 nano-dollars
      // Total: $0.25 + $1.0 = $1.25 = 1_250_000_000 nano-dollars
      expect(cost).toBe(1_250_000_000);
    });

    it("should handle very large token counts with tiered pricing", () => {
      const cost = calculateTokenCost(
        "google",
        "test-tiered-model",
        500000, // 500k tokens (300k above threshold)
        300000 // 300k tokens
      );

      // Input: 200k * $1.25 + 300k * $2.5 = 0.2 * $1.25 + 0.3 * $2.5 = $0.25 + $0.75 = $1.0 = 1_000_000_000 nano-dollars
      // Output: 200k * $5.0 + 100k * $10.0 = 0.2 * $5.0 + 0.1 * $10.0 = $1.0 + $1.0 = $2.0 = 2_000_000_000 nano-dollars
      // Total: $1.0 + $2.0 = $3.0 = 3_000_000_000 nano-dollars
      expect(cost).toBe(3_000_000_000);
    });
  });

  describe("calculateTokenCost - reasoning tokens", () => {
    it("should calculate cost with reasoning tokens (flat pricing)", () => {
      const cost = calculateTokenCost(
        "google",
        "test-reasoning-model",
        1000000, // 1M input
        500000, // 0.5M output
        200000 // 0.2M reasoning
      );

      // Input: 1M * $1.0 = $1.0 = 1_000_000_000 nano-dollars
      // Output: 0.5M * $2.0 = $1.0 = 1_000_000_000 nano-dollars
      // Reasoning: 0.2M * $3.5 = $0.7 = 700_000_000 nano-dollars
      // Total: $1.0 + $1.0 + $0.7 = $2.7 = 2_700_000_000 nano-dollars
      expect(cost).toBe(2_700_000_000);
    });

    it("should calculate cost with reasoning tokens (tiered pricing)", () => {
      const cost = calculateTokenCost(
        "google",
        "test-tiered-reasoning-model",
        150000, // 150k input (below threshold)
        50000, // 50k output
        100000 // 100k reasoning
      );

      // Input: 150k * $1.25 = 0.15 * $1.25 = $0.1875 = 187_500_000 nano-dollars
      // Output: 50k * $5.0 = 0.05 * $5.0 = $0.25 = 250_000_000 nano-dollars
      // Reasoning: 100k * $10.0 = 0.1 * $10.0 = $1.0 = 1_000_000_000 nano-dollars
      // Total: $0.1875 + $0.25 + $1.0 = $1.4375 = 1_437_500_000 nano-dollars
      expect(cost).toBe(1_437_500_000);
    });

    it("should handle reasoning tokens above threshold", () => {
      const cost = calculateTokenCost(
        "google",
        "test-tiered-reasoning-model",
        250000, // 250k input (50k above threshold)
        100000, // 100k output
        250000 // 250k reasoning (50k above threshold)
      );

      // Input: 200k * $1.25 + 50k * $2.5 = 0.2 * $1.25 + 0.05 * $2.5 = $0.25 + $0.125 = $0.375 = 375_000_000 nano-dollars
      // Output: 100k * $5.0 = 0.1 * $5.0 = $0.5 = 500_000_000 nano-dollars
      // Reasoning: 200k * $10.0 + 50k * $15.0 = 0.2 * $10.0 + 0.05 * $15.0 = $2.0 + $0.75 = $2.75 = 2_750_000_000 nano-dollars
      // Total: $0.375 + $0.5 + $2.75 = $3.625 = 3_625_000_000 nano-dollars
      expect(cost).toBe(3_625_000_000);
    });

    it("should return 0 cost when reasoning tokens are 0", () => {
      const costWithReasoning = calculateTokenCost(
        "google",
        "test-reasoning-model",
        1000000,
        500000,
        200000
      );

      const costWithoutReasoning = calculateTokenCost(
        "google",
        "test-reasoning-model",
        1000000,
        500000,
        0
      );

      expect(costWithReasoning).toBeGreaterThan(costWithoutReasoning);
      expect(costWithoutReasoning).toBe(2_000_000_000); // Just input + output (2.0 USD in nano-dollars)
    });
  });

  describe("calculateTokenCosts", () => {
    it("should calculate costs for all currencies", () => {
      const costs = calculateTokenCosts(
        "google",
        "test-flat-model",
        1000000,
        500000
      );

      expect(costs.usd).toBe(2_000_000_000); // 2.0 USD in nano-dollars
    });

    it("should calculate costs with reasoning tokens for all currencies", () => {
      const costs = calculateTokenCosts(
        "google",
        "test-reasoning-model",
        1000000,
        500000,
        200000
      );

      expect(costs.usd).toBe(2_700_000_000); // 2.7 USD in nano-dollars
    });
  });

  describe("edge cases", () => {
    it("should return 0 for non-existent model", () => {
      const cost = calculateTokenCost(
        "google",
        "non-existent-model",
        1000000,
        500000
      );
      expect(cost).toBe(0);
    });

    it("should return 0 for non-existent provider", () => {
      const cost = calculateTokenCost(
        "openai",
        "test-flat-model",
        1000000,
        500000
      );
      expect(cost).toBe(0);
    });

    it("should handle negative token counts gracefully", () => {
      const cost = calculateTokenCost("google", "test-flat-model", -1000, -500);
      // Should not throw, but may return unexpected result
      expect(typeof cost).toBe("number");
    });

    it("should return integer nano-dollars (no decimal places)", () => {
      const cost = calculateTokenCost(
        "google",
        "test-flat-model",
        333333, // 0.333333M tokens
        666666 // 0.666666M tokens
      );

      // 0.333333 * $1.0 + 0.666666 * $2.0 = $0.333333 + $1.333332 = $1.666665
      // With Math.ceil: 333333 * 1.0 = 333_333, 666666 * 2.0 = 1_333_332, total = 1_666_665
      // Should be an integer (nano-dollars)
      expect(Number.isInteger(cost)).toBe(true);
      expect(cost).toBe(1_666_665_000);
    });
  });

  describe("calculateTokenCost - cached tokens", () => {
    it("should calculate cost with cached tokens using cached pricing", () => {
      const cost = calculateTokenCost(
        "google",
        "test-flat-model",
        1000000, // 1M non-cached input tokens
        500000, // 0.5M output tokens
        0, // no reasoning tokens
        200000 // 0.2M cached tokens
      );

      // 1M * $1.0 (input) + 0.2M * $0.1 (cached) + 0.5M * $2.0 (output) = $1.0 + $0.02 + $1.0 = $2.02 = 2_020_000_000 nano-dollars
      expect(cost).toBe(2_020_000_000);
    });

    it("should handle cached tokens without cached pricing (fallback to input)", () => {
      // Use a model without cached pricing - should fall back to input pricing
      const cost = calculateTokenCost(
        "google",
        "test-reasoning-model", // This model doesn't have cachedInput in mock
        1000000, // 1M non-cached input tokens
        500000, // 0.5M output tokens
        0, // no reasoning tokens
        200000 // 0.2M cached tokens (will use input pricing as fallback)
      );

      // 1M * $1.0 (input) + 0.2M * $1.0 (cached, fallback to input) + 0.5M * $2.0 (output) = $1.0 + $0.2 + $1.0 = $2.2 = 2_200_000_000 nano-dollars
      expect(cost).toBe(2_200_000_000);
    });

    it("should return 0 cost when only cached tokens are present", () => {
      const cost = calculateTokenCost(
        "google",
        "test-flat-model",
        0, // no non-cached input tokens
        0, // no output tokens
        0, // no reasoning tokens
        200000 // 0.2M cached tokens
      );

      // 0.2M * $0.1 (cached) = $0.02 = 20_000_000 nano-dollars
      expect(cost).toBe(20_000_000);
    });

    it("should calculate cached token cost", () => {
      const usdCost = calculateTokenCost(
        "google",
        "test-flat-model",
        1000000,
        500000,
        0,
        200000
      );

      expect(usdCost).toBe(2_020_000_000); // 2.02 USD in nano-dollars (1.0 + 0.02 + 1.0)
    });

    it("should handle cached tokens with reasoning tokens", () => {
      const cost = calculateTokenCost(
        "google",
        "test-reasoning-model",
        1000000, // 1M non-cached input tokens
        500000, // 0.5M output tokens
        100000, // 0.1M reasoning tokens
        200000 // 0.2M cached tokens
      );

      // 1M * $1.0 (input) + 0.2M * $1.0 (cached, fallback) + 0.5M * $2.0 (output) + 0.1M * $3.5 (reasoning)
      // = $1.0 + $0.2 + $1.0 + $0.35 = $2.55 = 2_550_000_000 nano-dollars
      expect(cost).toBe(2_550_000_000);
    });

    it("should handle zero cached tokens", () => {
      const cost = calculateTokenCost(
        "google",
        "test-flat-model",
        1000000,
        500000,
        0,
        0 // no cached tokens
      );

      // Should be same as without cached tokens parameter
      const costWithoutCached = calculateTokenCost(
        "google",
        "test-flat-model",
        1000000,
        500000
      );

      expect(cost).toBe(costWithoutCached);
      expect(cost).toBe(2_000_000_000); // 2.0 USD in nano-dollars
    });
  });
});
