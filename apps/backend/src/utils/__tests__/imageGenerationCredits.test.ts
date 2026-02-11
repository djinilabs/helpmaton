import { describe, expect, it } from "vitest";

import { estimateImageGenerationCost } from "../imageGenerationCredits";
import { calculateTokenCost } from "../pricing";
import { estimateInputTokens } from "../tokenEstimation";

describe("estimateImageGenerationCost", () => {
  it("uses request pricing when available", () => {
    const provider = "openrouter";
    const modelName = "cohere/rerank-v3";
    const shortPrompt = "A small prompt.";
    const longPrompt =
      "A much longer prompt that should not change the request pricing output.";

    const expected = calculateTokenCost(provider, modelName, 0, 0, 0, 0);
    const shortCost = estimateImageGenerationCost({
      provider,
      modelName,
      prompt: shortPrompt,
    });
    const longCost = estimateImageGenerationCost({
      provider,
      modelName,
      prompt: longPrompt,
    });

    expect(shortCost).toBe(expected);
    expect(longCost).toBe(expected);
  });

  it("estimates input tokens from prompt and uses 1000 output tokens otherwise", () => {
    const provider = "openrouter";
    const modelName = "google/gemini-2.5-flash-image";
    const prompt = "Generate a watercolor lighthouse on a cliff at sunset.";

    const estimatedInputTokens = estimateInputTokens([
      { role: "user", content: prompt },
    ]);
    const expected = calculateTokenCost(
      provider,
      modelName,
      estimatedInputTokens,
      1000,
      0,
      0
    );

    const cost = estimateImageGenerationCost({ provider, modelName, prompt });
    expect(cost).toBe(expected);
  });

  it("increases estimated cost as prompt size grows", () => {
    const provider = "openrouter";
    const modelName = "google/gemini-2.5-flash-image";
    const shortPrompt = "A simple icon.";
    const longPrompt =
      "A detailed, ultra-realistic city skyline at night with neon reflections, " +
      "rain-soaked streets, cinematic lighting, and high dynamic range.";

    const shortCost = estimateImageGenerationCost({
      provider,
      modelName,
      prompt: shortPrompt,
    });
    const longCost = estimateImageGenerationCost({
      provider,
      modelName,
      prompt: longPrompt,
    });

    expect(longCost).toBeGreaterThan(shortCost);
  });
});
