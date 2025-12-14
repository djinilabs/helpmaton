import type { ModelMessage } from "ai";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pricing module
const { mockCalculateTokenCosts } = vi.hoisted(() => {
  return {
    mockCalculateTokenCosts: vi.fn(),
  };
});

vi.mock("../pricing", () => ({
  calculateTokenCosts: mockCalculateTokenCosts,
}));

// Import after mocks are set up
import {
  estimateInputTokens,
  estimateOutputTokens,
  estimateTokenCost,
} from "../tokenEstimation";

describe("tokenEstimation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("estimateInputTokens", () => {
    it("should estimate tokens from simple string messages", () => {
      const messages: ModelMessage[] = [
        { role: "user", content: "Hello, world!" },
        { role: "assistant", content: "Hi there!" },
      ];

      const tokens = estimateInputTokens(messages);

      // "Hello, world!" = 13 chars, "Hi there!" = 9 chars
      // Total: 22 chars / 4 = 5.5 tokens, + 2 messages * 3 = 6 overhead
      // Expected: ~12 tokens
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(50); // Reasonable upper bound
    });

    it("should handle empty messages", () => {
      const messages: ModelMessage[] = [];

      const tokens = estimateInputTokens(messages);

      expect(tokens).toBe(0);
    });

    it("should include system prompt in token count", () => {
      const messages: ModelMessage[] = [{ role: "user", content: "Test" }];
      const systemPrompt = "You are a helpful assistant. ".repeat(10); // ~300 chars

      const tokens = estimateInputTokens(messages, systemPrompt);

      const tokensWithoutSystem = estimateInputTokens(messages);
      expect(tokens).toBeGreaterThan(tokensWithoutSystem);
    });

    it("should include tool definitions in token count", () => {
      const messages: ModelMessage[] = [{ role: "user", content: "Test" }];
      const toolDefinitions = [
        { name: "search", description: "Search the web" },
        { name: "calculate", description: "Perform calculations" },
      ];

      const tokens = estimateInputTokens(messages, undefined, toolDefinitions);

      const tokensWithoutTools = estimateInputTokens(messages);
      expect(tokens).toBeGreaterThan(tokensWithoutTools);
    });

    it("should handle array content in messages", () => {
      const messages: ModelMessage[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "Hello" },
            { type: "text", text: "World" },
          ],
        },
      ];

      const tokens = estimateInputTokens(messages);

      expect(tokens).toBeGreaterThan(0);
    });

    it("should handle mixed content types", () => {
      const messages: ModelMessage[] = [
        { role: "user", content: "String content" },
        {
          role: "assistant",
          content: [{ type: "text", text: "Array content" }],
        },
      ];

      const tokens = estimateInputTokens(messages);

      expect(tokens).toBeGreaterThan(0);
    });

    it("should add overhead for message formatting", () => {
      const singleMessage: ModelMessage[] = [{ role: "user", content: "Test" }];
      const multipleMessages: ModelMessage[] = [
        { role: "user", content: "Test" },
        { role: "assistant", content: "Test" },
        { role: "user", content: "Test" },
      ];

      const singleTokens = estimateInputTokens(singleMessage);
      const multipleTokens = estimateInputTokens(multipleMessages);

      // Multiple messages should have more overhead (3 messages * 3 = 9 vs 1 * 3 = 3)
      expect(multipleTokens).toBeGreaterThan(singleTokens);
    });

    it("should handle tool definitions serialization failure gracefully", () => {
      const messages: ModelMessage[] = [{ role: "user", content: "Test" }];
      // Create circular reference to cause JSON.stringify to fail
      const circularTool: { name: string; ref?: unknown } = {
        name: "test",
      };
      circularTool.ref = circularTool;

      const tokens = estimateInputTokens(messages, undefined, [circularTool]);

      // Should still return a valid token count (fallback to length * 100)
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe("estimateOutputTokens", () => {
    it("should estimate 20% of input tokens", () => {
      const inputTokens = 1000;
      const outputTokens = estimateOutputTokens(inputTokens);

      expect(outputTokens).toBe(200); // 20% of 1000
    });

    it("should enforce minimum of 100 tokens", () => {
      const inputTokens = 100; // 20% would be 20, but minimum is 100
      const outputTokens = estimateOutputTokens(inputTokens);

      expect(outputTokens).toBe(100);
    });

    it("should handle zero input tokens", () => {
      const outputTokens = estimateOutputTokens(0);

      expect(outputTokens).toBe(100); // Minimum
    });

    it("should handle very large input tokens", () => {
      const inputTokens = 100000;
      const outputTokens = estimateOutputTokens(inputTokens);

      expect(outputTokens).toBe(20000); // 20% of 100000
    });

    it("should round up fractional results", () => {
      const inputTokens = 600; // 20% = 120, Math.ceil = 120, Math.max(120, 100) = 120
      const outputTokens = estimateOutputTokens(inputTokens);

      // Math.ceil(600 * 0.2) = Math.ceil(120) = 120, Math.max(120, 100) = 120
      expect(outputTokens).toBe(120);
    });
  });

  describe("estimateTokenCost", () => {
    beforeEach(() => {
      mockCalculateTokenCosts.mockReturnValue({
        usd: 0.01,
        eur: 0.009,
        gbp: 0.008,
      });
    });

    it("should estimate cost for given provider and model", () => {
      const messages: ModelMessage[] = [
        { role: "user", content: "Test message" },
      ];

      const cost = estimateTokenCost("google", "gemini-pro", messages);

      expect(mockCalculateTokenCosts).toHaveBeenCalledWith(
        "google",
        "gemini-pro",
        expect.any(Number), // inputTokens
        expect.any(Number) // outputTokens
      );
      expect(cost).toBe(0.01); // USD default
    });

    it("should return cost in specified currency", () => {
      const messages: ModelMessage[] = [
        { role: "user", content: "Test message" },
      ];

      const costEur = estimateTokenCost(
        "google",
        "gemini-pro",
        messages,
        undefined,
        undefined,
        "eur"
      );
      const costGbp = estimateTokenCost(
        "google",
        "gemini-pro",
        messages,
        undefined,
        undefined,
        "gbp"
      );

      expect(costEur).toBe(0.009);
      expect(costGbp).toBe(0.008);
      // Should have been called twice (once for EUR, once for GBP)
      expect(mockCalculateTokenCosts).toHaveBeenCalledTimes(2);
    });

    it("should include system prompt in estimation", () => {
      const messages: ModelMessage[] = [{ role: "user", content: "Test" }];
      const systemPrompt = "You are helpful";

      estimateTokenCost("google", "gemini-pro", messages, systemPrompt);

      const callArgs = mockCalculateTokenCosts.mock.calls[0];
      const inputTokens = callArgs[2];
      const outputTokens = callArgs[3];

      // Should have estimated tokens including system prompt
      expect(inputTokens).toBeGreaterThan(0);
      expect(outputTokens).toBeGreaterThanOrEqual(100);
    });

    it("should include tool definitions in estimation", () => {
      const messages: ModelMessage[] = [{ role: "user", content: "Test" }];
      const toolDefinitions = [{ name: "search", description: "Search" }];

      estimateTokenCost(
        "google",
        "gemini-pro",
        messages,
        undefined,
        toolDefinitions
      );

      const callArgs = mockCalculateTokenCosts.mock.calls[0];
      const inputTokens = callArgs[2];

      // Should have estimated tokens including tools
      expect(inputTokens).toBeGreaterThan(0);
    });

    it("should handle empty messages", () => {
      const messages: ModelMessage[] = [];

      const cost = estimateTokenCost("google", "gemini-pro", messages);

      expect(cost).toBeDefined();
      // Even with no input, output tokens minimum is 100
      expect(mockCalculateTokenCosts).toHaveBeenCalledWith(
        "google",
        "gemini-pro",
        0, // inputTokens
        100 // outputTokens (minimum)
      );
    });
  });
});




