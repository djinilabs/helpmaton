import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import { describe, it, expect, beforeAll } from "vitest";

import { loadPricingConfig } from "../../../utils/pricing";

/**
 * Integration tests to validate that all model names in pricing.json
 * can be successfully used with their respective providers.
 *
 * These tests make actual API calls to verify model names are valid.
 * Tests are skipped if required API keys are not available.
 */

// Check if API keys are available
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const hasApiKey = Boolean(GEMINI_API_KEY);

// Load pricing config once
const pricingConfig = loadPricingConfig();

/**
 * Get all models for a provider
 */
function getModelsForProvider(provider: string): string[] {
  const providerPricing = pricingConfig.providers[provider];
  if (!providerPricing) {
    return [];
  }
  return Object.keys(providerPricing.models);
}

/**
 * Check if an error indicates an invalid model name
 */
function isInvalidModelError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // Common error messages for invalid models
    return (
      message.includes("model") &&
      (message.includes("not found") ||
        message.includes("invalid") ||
        message.includes("does not exist") ||
        message.includes("not available") ||
        message.includes("not supported"))
    );
  }
  return false;
}

/**
 * Check if an error indicates a rate limit or API issue (not model invalidity)
 */
function isApiError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("rate limit") ||
      message.includes("quota") ||
      message.includes("api key") ||
      message.includes("authentication") ||
      message.includes("permission") ||
      message.includes("403") ||
      message.includes("429")
    );
  }
  return false;
}

describe("Model Validation Integration Tests", () => {
  // Skip all tests if API key is not available
  beforeAll(() => {
    if (!hasApiKey) {
      console.warn(
        "⚠️  GEMINI_API_KEY not set. Skipping model validation tests."
      );
    }
  });

  describe("Google Provider", () => {
    const provider = "google";
    const models = getModelsForProvider(provider);

    if (models.length === 0) {
      it("should have models in pricing config", () => {
        expect(models.length).toBeGreaterThan(0);
      });
      return;
    }

    // Create parameterized tests for each model
    describe.each(models)("model: %s", (modelName) => {
      it.skipIf(!hasApiKey)(
        `should validate model "${modelName}" can be used with Google provider`,
        async () => {
          try {
            // Create Google Generative AI instance (same pattern as modelFactory.ts)
            const google = createGoogleGenerativeAI({
              apiKey: GEMINI_API_KEY!,
              headers: {
                Referer:
                  process.env.GOOGLE_API_REFERER ||
                  "http://localhost:3000/api/webhook",
                "Content-Type": "text/event-stream",
              },
            });

            // Create model instance
            const model = google(modelName);

            // Make a minimal API call to validate the model name
            // Using a very simple message to minimize cost and time
            const result = await generateText({
              model,
              messages: [
                {
                  role: "user",
                  content: "Say hello",
                },
              ],
            });

            // Verify we got a response
            expect(result).toBeDefined();
            expect(result.text).toBeDefined();
            expect(typeof result.text).toBe("string");

            console.log(
              `✅ Model "${modelName}" validated successfully. Response: "${result.text.substring(
                0,
                50
              )}..."`
            );
          } catch (error) {
            // Handle different types of errors
            if (isInvalidModelError(error)) {
              // Invalid model name - this should fail the test
              throw new Error(
                `Model "${modelName}" is not valid: ${
                  error instanceof Error ? error.message : String(error)
                }`
              );
            } else if (isApiError(error)) {
              // API errors (rate limits, auth issues) - skip the test
              console.warn(
                `⏭️  Skipping test for ${modelName} due to API error: ${
                  error instanceof Error ? error.message : String(error)
                }`
              );
              return;
            } else {
              // Other errors - fail the test
              throw error;
            }
          }
        },
        30000
      ); // 30 second timeout per model
    });
  });

  // Test for other providers can be added here in the future
  // For now, only Google is supported
});
