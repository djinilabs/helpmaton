import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  getDefaultModel,
  getOnboardingAgentModel,
} from "../modelFactory";

const mockLoadPricingConfig = vi.hoisted(() => vi.fn());

vi.mock("../../../utils/pricing", () => ({
  loadPricingConfig: () => mockLoadPricingConfig(),
  getMaxToolOutputBytes: () => 1_048_576,
}));

describe("modelFactory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getOnboardingAgentModel", () => {
    it("returns only Google models (openrouter provider)", () => {
      mockLoadPricingConfig.mockReturnValue({
        providers: {
          openrouter: {
            models: {
              "anthropic/claude-3.5-sonnet": {
                usd: { input: 3, output: 15 },
              },
              "google/gemini-2.5-flash": {
                usd: { input: 0.075, output: 0.3 },
              },
              "google/gemini-2.0-flash-001": {
                usd: { input: 0.1, output: 0.4 },
              },
              "openai/gpt-4o": {
                usd: { input: 2.5, output: 10 },
              },
            },
          },
        },
        lastUpdated: "2024-01-01",
      });
      const model = getOnboardingAgentModel();
      expect(model).toMatch(/^google\//);
      expect(model).toBe("google/gemini-2.5-flash");
    });

    it("prefers gemini-2.5-flash when available", () => {
      mockLoadPricingConfig.mockReturnValue({
        providers: {
          openrouter: {
            models: {
              "google/gemini-2.0-flash-001": { usd: {} },
              "google/gemini-2.5-flash": { usd: {} },
              "google/gemini-2.5-pro": { usd: {} },
            },
          },
        },
        lastUpdated: "2024-01-01",
      });
      expect(getOnboardingAgentModel()).toBe("google/gemini-2.5-flash");
    });

    it("falls back to first Google model (sorted) when no preference matches", () => {
      mockLoadPricingConfig.mockReturnValue({
        providers: {
          openrouter: {
            models: {
              "google/gemma-3-4b-it": { usd: {} },
              "google/gemma-2-9b-it": { usd: {} },
            },
          },
        },
        lastUpdated: "2024-01-01",
      });
      const model = getOnboardingAgentModel();
      expect(model).toMatch(/^google\//);
      expect(model).toBe("google/gemma-2-9b-it"); // sorted order, no pattern match
    });

    it("throws when no Google models exist in openrouter pricing", () => {
      mockLoadPricingConfig.mockReturnValue({
        providers: {
          openrouter: {
            models: {
              "anthropic/claude-3.5-sonnet": { usd: {} },
              "openai/gpt-4o": { usd: {} },
            },
          },
        },
        lastUpdated: "2024-01-01",
      });
      expect(() => getOnboardingAgentModel()).toThrow(
        "No Google models found in pricing config for provider: openrouter"
      );
    });
  });

  describe("getDefaultModel", () => {
    it("can return non-Google models", () => {
      mockLoadPricingConfig.mockReturnValue({
        providers: {
          openrouter: {
            models: {
              "anthropic/claude-3.5-sonnet": { usd: {} },
            },
          },
        },
        lastUpdated: "2024-01-01",
      });
      expect(getDefaultModel()).toBe("anthropic/claude-3.5-sonnet");
    });
  });
});
