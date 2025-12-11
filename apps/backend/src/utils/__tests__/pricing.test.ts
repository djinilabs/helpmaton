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
              },
              eur: {
                input: 0.85,
                output: 1.7,
              },
              gbp: {
                input: 0.75,
                output: 1.5,
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
              eur: {
                tiers: [
                  {
                    threshold: 200000,
                    input: 1.0625,
                    output: 4.25,
                  },
                  {
                    input: 2.125,
                    output: 8.5,
                  },
                ],
              },
              gbp: {
                tiers: [
                  {
                    threshold: 200000,
                    input: 0.9375,
                    output: 3.75,
                  },
                  {
                    input: 1.875,
                    output: 7.5,
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
              eur: {
                input: 0.85,
                output: 1.7,
                reasoning: 2.975,
              },
              gbp: {
                input: 0.75,
                output: 1.5,
                reasoning: 2.625,
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
  getModelPricing,
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

  describe("calculateTokenCost - flat pricing", () => {
    it("should calculate cost for flat pricing model", () => {
      const cost = calculateTokenCost(
        "google",
        "test-flat-model",
        1000000, // 1M input tokens
        500000, // 0.5M output tokens
        "usd"
      );

      // 1M * $1.0 + 0.5M * $2.0 = $1.0 + $1.0 = $2.0
      expect(cost).toBe(2.0);
    });

    it("should calculate cost in different currencies", () => {
      const usdCost = calculateTokenCost(
        "google",
        "test-flat-model",
        1000000,
        500000,
        "usd"
      );
      const eurCost = calculateTokenCost(
        "google",
        "test-flat-model",
        1000000,
        500000,
        "eur"
      );
      const gbpCost = calculateTokenCost(
        "google",
        "test-flat-model",
        1000000,
        500000,
        "gbp"
      );

      expect(usdCost).toBe(2.0);
      expect(eurCost).toBe(1.7); // 1M * 0.85 + 0.5M * 1.7
      expect(gbpCost).toBe(1.5); // 1M * 0.75 + 0.5M * 1.5
    });

    it("should return 0 for zero tokens", () => {
      const cost = calculateTokenCost(
        "google",
        "test-flat-model",
        0,
        0,
        "usd"
      );
      expect(cost).toBe(0);
    });

    it("should handle small token counts", () => {
      const cost = calculateTokenCost(
        "google",
        "test-flat-model",
        1000, // 0.001M tokens
        500, // 0.0005M tokens
        "usd"
      );

      // 0.001 * $1.0 + 0.0005 * $2.0 = $0.001 + $0.001 = $0.002
      expect(cost).toBe(0.002);
    });
  });

  describe("calculateTokenCost - tiered pricing", () => {
    it("should calculate cost for tokens below threshold", () => {
      const cost = calculateTokenCost(
        "google",
        "test-tiered-model",
        150000, // 150k tokens (below 200k threshold)
        50000, // 50k tokens
        "usd"
      );

      // 150k * $1.25 + 50k * $5.0 = 0.15 * $1.25 + 0.05 * $5.0 = $0.1875 + $0.25 = $0.4375
      expect(cost).toBe(0.4375);
    });

    it("should calculate cost for tokens above threshold", () => {
      const cost = calculateTokenCost(
        "google",
        "test-tiered-model",
        250000, // 250k tokens (50k above 200k threshold)
        100000, // 100k tokens
        "usd"
      );

      // Input: 200k * $1.25 + 50k * $2.5 = 0.2 * $1.25 + 0.05 * $2.5 = $0.25 + $0.125 = $0.375
      // Output: 100k * $5.0 = 0.1 * $5.0 = $0.5
      // Total: $0.375 + $0.5 = $0.875
      expect(cost).toBe(0.875);
    });

    it("should calculate cost for tokens exactly at threshold", () => {
      const cost = calculateTokenCost(
        "google",
        "test-tiered-model",
        200000, // Exactly at threshold
        200000,
        "usd"
      );

      // Input: 200k * $1.25 = 0.2 * $1.25 = $0.25
      // Output: 200k * $5.0 = 0.2 * $5.0 = $1.0
      // Total: $0.25 + $1.0 = $1.25
      expect(cost).toBe(1.25);
    });

    it("should handle very large token counts with tiered pricing", () => {
      const cost = calculateTokenCost(
        "google",
        "test-tiered-model",
        500000, // 500k tokens (300k above threshold)
        300000, // 300k tokens
        "usd"
      );

      // Input: 200k * $1.25 + 300k * $2.5 = 0.2 * $1.25 + 0.3 * $2.5 = $0.25 + $0.75 = $1.0
      // Output: 200k * $5.0 + 100k * $10.0 = 0.2 * $5.0 + 0.1 * $10.0 = $1.0 + $1.0 = $2.0
      // Total: $1.0 + $2.0 = $3.0
      expect(cost).toBe(3.0);
    });
  });

  describe("calculateTokenCost - reasoning tokens", () => {
    it("should calculate cost with reasoning tokens (flat pricing)", () => {
      const cost = calculateTokenCost(
        "google",
        "test-reasoning-model",
        1000000, // 1M input
        500000, // 0.5M output
        "usd",
        200000 // 0.2M reasoning
      );

      // Input: 1M * $1.0 = $1.0
      // Output: 0.5M * $2.0 = $1.0
      // Reasoning: 0.2M * $3.5 = $0.7
      // Total: $1.0 + $1.0 + $0.7 = $2.7
      expect(cost).toBe(2.7);
    });

    it("should calculate cost with reasoning tokens (tiered pricing)", () => {
      const cost = calculateTokenCost(
        "google",
        "test-tiered-reasoning-model",
        150000, // 150k input (below threshold)
        50000, // 50k output
        "usd",
        100000 // 100k reasoning
      );

      // Input: 150k * $1.25 = 0.15 * $1.25 = $0.1875
      // Output: 50k * $5.0 = 0.05 * $5.0 = $0.25
      // Reasoning: 100k * $10.0 = 0.1 * $10.0 = $1.0
      // Total: $0.1875 + $0.25 + $1.0 = $1.4375
      expect(cost).toBe(1.4375);
    });

    it("should handle reasoning tokens above threshold", () => {
      const cost = calculateTokenCost(
        "google",
        "test-tiered-reasoning-model",
        250000, // 250k input (50k above threshold)
        100000, // 100k output
        "usd",
        250000 // 250k reasoning (50k above threshold)
      );

      // Input: 200k * $1.25 + 50k * $2.5 = 0.2 * $1.25 + 0.05 * $2.5 = $0.25 + $0.125 = $0.375
      // Output: 100k * $5.0 = 0.1 * $5.0 = $0.5
      // Reasoning: 200k * $10.0 + 50k * $15.0 = 0.2 * $10.0 + 0.05 * $15.0 = $2.0 + $0.75 = $2.75
      // Total: $0.375 + $0.5 + $2.75 = $3.625
      expect(cost).toBe(3.625);
    });

    it("should return 0 cost when reasoning tokens are 0", () => {
      const costWithReasoning = calculateTokenCost(
        "google",
        "test-reasoning-model",
        1000000,
        500000,
        "usd",
        200000
      );

      const costWithoutReasoning = calculateTokenCost(
        "google",
        "test-reasoning-model",
        1000000,
        500000,
        "usd",
        0
      );

      expect(costWithReasoning).toBeGreaterThan(costWithoutReasoning);
      expect(costWithoutReasoning).toBe(2.0); // Just input + output
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

      expect(costs.usd).toBe(2.0);
      expect(costs.eur).toBe(1.7);
      expect(costs.gbp).toBe(1.5);
    });

    it("should calculate costs with reasoning tokens for all currencies", () => {
      const costs = calculateTokenCosts(
        "google",
        "test-reasoning-model",
        1000000,
        500000,
        200000
      );

      expect(costs.usd).toBe(2.7);
      expect(costs.eur).toBeGreaterThan(0);
      expect(costs.gbp).toBeGreaterThan(0);
    });
  });

  describe("edge cases", () => {
    it("should return 0 for non-existent model", () => {
      const cost = calculateTokenCost(
        "google",
        "non-existent-model",
        1000000,
        500000,
        "usd"
      );
      expect(cost).toBe(0);
    });

    it("should return 0 for non-existent provider", () => {
      const cost = calculateTokenCost(
        "openai",
        "test-flat-model",
        1000000,
        500000,
        "usd"
      );
      expect(cost).toBe(0);
    });

    it("should handle negative token counts gracefully", () => {
      const cost = calculateTokenCost(
        "google",
        "test-flat-model",
        -1000,
        -500,
        "usd"
      );
      // Should not throw, but may return unexpected result
      expect(typeof cost).toBe("number");
    });

    it("should round to 6 decimal places", () => {
      const cost = calculateTokenCost(
        "google",
        "test-flat-model",
        333333, // 0.333333M tokens
        666666, // 0.666666M tokens
        "usd"
      );

      // 0.333333 * $1.0 + 0.666666 * $2.0 = $0.333333 + $1.333332 = $1.666665
      // Should be rounded to 6 decimal places
      const costString = cost.toString();
      const decimalPlaces = costString.includes(".")
        ? costString.split(".")[1].length
        : 0;
      expect(decimalPlaces).toBeLessThanOrEqual(6);
    });
  });
});

