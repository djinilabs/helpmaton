import { describe, it, expect } from "vitest";

import {
  aggregateTokenUsage,
  extractTokenUsage,
  type TokenUsage,
} from "../conversationLogger";

describe("conversationLogger", () => {
  describe("extractTokenUsage", () => {
    it("should extract token usage from standard AI SDK format", () => {
      const result = {
        usage: {
          promptTokens: 1000,
          completionTokens: 500,
          totalTokens: 1500,
        },
      };

      const usage = extractTokenUsage(result);

      expect(usage).toEqual({
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      });
    });

    it("should extract token usage from inputTokens/outputTokens format", () => {
      const result = {
        usage: {
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
        },
      };

      const usage = extractTokenUsage(result);

      expect(usage).toEqual({
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      });
    });

    it("should extract reasoning tokens when present", () => {
      const result = {
        usage: {
          promptTokens: 1000,
          completionTokens: 500,
          totalTokens: 1500,
          reasoningTokens: 200,
        },
      };

      const usage = extractTokenUsage(result);

      // totalTokens should be max(1500, 1000 + 500 + 200) = 1700
      expect(usage).toEqual({
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1700, // Includes reasoning tokens
        reasoningTokens: 200,
      });
    });

    it("should extract reasoning tokens from nested location", () => {
      const result = {
        usage: {
          promptTokens: 1000,
          completionTokens: 500,
          totalTokens: 1500,
        },
        reasoningTokens: 200,
      };

      const usage = extractTokenUsage(result);

      // totalTokens should be max(1500, 1000 + 500 + 200) = 1700
      expect(usage).toEqual({
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1700, // Includes reasoning tokens
        reasoningTokens: 200,
      });
    });

    it("should not include reasoningTokens when zero or missing", () => {
      const result1 = {
        usage: {
          promptTokens: 1000,
          completionTokens: 500,
          totalTokens: 1500,
          reasoningTokens: 0,
        },
      };

      const result2 = {
        usage: {
          promptTokens: 1000,
          completionTokens: 500,
          totalTokens: 1500,
        },
      };

      const usage1 = extractTokenUsage(result1);
      const usage2 = extractTokenUsage(result2);

      expect(usage1?.reasoningTokens).toBeUndefined();
      expect(usage2?.reasoningTokens).toBeUndefined();
    });

    it("should extract cached prompt tokens when present", () => {
      const result = {
        usage: {
          promptTokenCount: 1000,
          cachedPromptTokenCount: 200,
          completionTokenCount: 500,
          totalTokenCount: 1500,
        },
      };

      const usage = extractTokenUsage(result);

      expect(usage).toEqual({
        promptTokens: 800, // 1000 - 200 cached
        completionTokens: 500,
        totalTokens: 1500,
        cachedPromptTokens: 200,
      });
    });

    it("should extract cached tokens from various field names", () => {
      const result1 = {
        usage: {
          promptTokens: 1000,
          cachedPromptTokens: 200,
          completionTokens: 500,
          totalTokens: 1500,
        },
      };

      const result2 = {
        usage: {
          promptTokens: 1000,
          cachedTokens: 200,
          completionTokens: 500,
          totalTokens: 1500,
        },
      };

      const usage1 = extractTokenUsage(result1);
      const usage2 = extractTokenUsage(result2);

      expect(usage1?.cachedPromptTokens).toBe(200);
      expect(usage1?.promptTokens).toBe(800); // 1000 - 200
      expect(usage2?.cachedPromptTokens).toBe(200);
      expect(usage2?.promptTokens).toBe(800); // 1000 - 200
    });

    it("should not include cachedPromptTokens when zero or missing", () => {
      const result1 = {
        usage: {
          promptTokens: 1000,
          completionTokens: 500,
          totalTokens: 1500,
          cachedPromptTokenCount: 0,
        },
      };

      const result2 = {
        usage: {
          promptTokens: 1000,
          completionTokens: 500,
          totalTokens: 1500,
        },
      };

      const usage1 = extractTokenUsage(result1);
      const usage2 = extractTokenUsage(result2);

      expect(usage1?.cachedPromptTokens).toBeUndefined();
      expect(usage2?.cachedPromptTokens).toBeUndefined();
    });

    it("should handle both cached tokens and reasoning tokens", () => {
      const result = {
        usage: {
          promptTokenCount: 1000,
          cachedPromptTokenCount: 200,
          completionTokenCount: 500,
          totalTokenCount: 1500,
          reasoningTokens: 100,
        },
      };

      const usage = extractTokenUsage(result);

      expect(usage).toEqual({
        promptTokens: 800, // 1000 - 200 cached
        completionTokens: 500,
        totalTokens: 1500,
        cachedPromptTokens: 200,
        reasoningTokens: 100,
      });
    });

    it("should return undefined for invalid result", () => {
      expect(extractTokenUsage(null)).toBeUndefined();
      expect(extractTokenUsage(undefined)).toBeUndefined();
      expect(extractTokenUsage({})).toBeUndefined();
      expect(extractTokenUsage({ usage: null })).toBeUndefined();
    });

    it("should handle missing token fields gracefully", () => {
      const result = {
        usage: {
          totalTokens: 1500,
        },
      };

      const usage = extractTokenUsage(result);

      expect(usage).toEqual({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 1500,
      });
    });
  });

  describe("aggregateTokenUsage", () => {
    it("should aggregate multiple token usage objects", () => {
      const usage1: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      };

      const usage2: TokenUsage = {
        promptTokens: 2000,
        completionTokens: 1000,
        totalTokens: 3000,
      };

      const aggregated = aggregateTokenUsage(usage1, usage2);

      // totalTokens is calculated as promptTokens + completionTokens + reasoningTokens
      // = 3000 + 1500 + 0 = 4500
      expect(aggregated).toEqual({
        promptTokens: 3000,
        completionTokens: 1500,
        totalTokens: 4500,
      });
    });

    it("should aggregate reasoning tokens when present", () => {
      const usage1: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        reasoningTokens: 200,
      };

      const usage2: TokenUsage = {
        promptTokens: 2000,
        completionTokens: 1000,
        totalTokens: 3000,
        reasoningTokens: 300,
      };

      const aggregated = aggregateTokenUsage(usage1, usage2);

      // totalTokens is calculated as promptTokens + completionTokens + reasoningTokens
      // = 3000 + 1500 + 500 = 5000 (not 4500 from summing individual totalTokens)
      expect(aggregated).toEqual({
        promptTokens: 3000,
        completionTokens: 1500,
        totalTokens: 5000, // 3000 + 1500 + 500 (includes reasoning tokens)
        reasoningTokens: 500,
      });
    });

    it("should not include reasoningTokens when all are zero or missing", () => {
      const usage1: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      };

      const usage2: TokenUsage = {
        promptTokens: 2000,
        completionTokens: 1000,
        totalTokens: 3000,
      };

      const aggregated = aggregateTokenUsage(usage1, usage2);

      expect(aggregated.reasoningTokens).toBeUndefined();
    });

    it("should handle undefined usage objects", () => {
      const usage1: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      };

      const aggregated = aggregateTokenUsage(usage1, undefined, undefined);

      expect(aggregated).toEqual(usage1);
    });

    it("should handle empty array", () => {
      const aggregated = aggregateTokenUsage();

      expect(aggregated).toEqual({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      });
    });

    it("should handle partial token usage", () => {
      const usage1: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 0,
        totalTokens: 1000,
      };

      const usage2: TokenUsage = {
        promptTokens: 0,
        completionTokens: 500,
        totalTokens: 500,
      };

      const aggregated = aggregateTokenUsage(usage1, usage2);

      expect(aggregated).toEqual({
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      });
    });

    it("should handle mixed reasoning token presence", () => {
      const usage1: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        reasoningTokens: 200,
      };

      const usage2: TokenUsage = {
        promptTokens: 2000,
        completionTokens: 1000,
        totalTokens: 3000,
        // No reasoningTokens
      };

      const aggregated = aggregateTokenUsage(usage1, usage2);

      expect(aggregated.reasoningTokens).toBe(200);
    });

    it("should aggregate cached prompt tokens when present", () => {
      const usage1: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        cachedPromptTokens: 200,
      };

      const usage2: TokenUsage = {
        promptTokens: 2000,
        completionTokens: 1000,
        totalTokens: 3000,
        cachedPromptTokens: 300,
      };

      const aggregated = aggregateTokenUsage(usage1, usage2);

      expect(aggregated).toEqual({
        promptTokens: 3000,
        completionTokens: 1500,
        totalTokens: 4500,
        cachedPromptTokens: 500,
      });
    });

    it("should not include cachedPromptTokens when all are zero or missing", () => {
      const usage1: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      };

      const usage2: TokenUsage = {
        promptTokens: 2000,
        completionTokens: 1000,
        totalTokens: 3000,
      };

      const aggregated = aggregateTokenUsage(usage1, usage2);

      expect(aggregated.cachedPromptTokens).toBeUndefined();
    });

    it("should handle mixed cached token presence", () => {
      const usage1: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        cachedPromptTokens: 200,
      };

      const usage2: TokenUsage = {
        promptTokens: 2000,
        completionTokens: 1000,
        totalTokens: 3000,
        // No cachedPromptTokens
      };

      const aggregated = aggregateTokenUsage(usage1, usage2);

      expect(aggregated.cachedPromptTokens).toBe(200);
    });

    it("should aggregate all token types together", () => {
      const usage1: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        cachedPromptTokens: 200,
        reasoningTokens: 100,
      };

      const usage2: TokenUsage = {
        promptTokens: 2000,
        completionTokens: 1000,
        totalTokens: 3000,
        cachedPromptTokens: 300,
        reasoningTokens: 200,
      };

      const aggregated = aggregateTokenUsage(usage1, usage2);

      // totalTokens is calculated as promptTokens + completionTokens + reasoningTokens
      // = 3000 + 1500 + 300 = 4800 (not 4500 from summing individual totalTokens)
      expect(aggregated).toEqual({
        promptTokens: 3000,
        completionTokens: 1500,
        totalTokens: 4800, // 3000 + 1500 + 300 (includes reasoning tokens)
        cachedPromptTokens: 500,
        reasoningTokens: 300,
      });
    });
  });
});
