import { describe, it, expect } from "vitest";

import type { UIMessage } from "../../utils/messageTypes";
import { getMessageCost } from "../messageCostCalculation";

describe("getMessageCost", () => {
  describe("assistant messages", () => {
    it("should return finalCostUsd when available", () => {
      const message: UIMessage = {
        role: "assistant",
        content: "Hello",
        finalCostUsd: 1000,
      };

      const result = getMessageCost(message);

      expect(result).toEqual({
        costUsd: 1000,
        isFinal: true,
      });
    });

    it("should prefer finalCostUsd over provisionalCostUsd", () => {
      const message: UIMessage = {
        role: "assistant",
        content: "Hello",
        finalCostUsd: 1000,
        provisionalCostUsd: 900,
      };

      const result = getMessageCost(message);

      expect(result).toEqual({
        costUsd: 1000,
        isFinal: true,
      });
    });

    it("should return provisionalCostUsd when finalCostUsd not available", () => {
      const message: UIMessage = {
        role: "assistant",
        content: "Hello",
        provisionalCostUsd: 900,
      };

      const result = getMessageCost(message);

      expect(result).toEqual({
        costUsd: 900,
        isFinal: false,
      });
    });

    it("should calculate from tokenUsage when neither finalCostUsd nor provisionalCostUsd available", () => {
      const message: UIMessage = {
        role: "assistant",
        content: "Hello",
        tokenUsage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
        modelName: "gemini-2.0-flash-exp",
        provider: "google",
      };

      const result = getMessageCost(message);

      expect(result).toBeDefined();
      expect(result?.costUsd).toBeGreaterThan(0);
      expect(result?.isFinal).toBeUndefined(); // Calculated, not final or provisional
    });

    it("should return undefined when no cost information available", () => {
      const message: UIMessage = {
        role: "assistant",
        content: "Hello",
      };

      const result = getMessageCost(message);

      expect(result).toBeUndefined();
    });
  });

  describe("tool messages", () => {
    it("should return individual tool costs from tool-result content items", () => {
      const message: UIMessage = {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call1",
            toolName: "search_web",
            result: "result1",
            costUsd: 8000, // $0.008
          },
          {
            type: "tool-result",
            toolCallId: "call2",
            toolName: "fetch_url",
            result: "result2",
            costUsd: 5000, // $0.005
          },
        ],
      };

      const result = getMessageCost(message);

      expect(result).toEqual({
        toolCosts: [
          { toolName: "search_web", costUsd: 8000 },
          { toolName: "fetch_url", costUsd: 5000 },
        ],
        isFinal: true,
      });
    });

    it("should return individual costs (not cumulative) for multiple tool results", () => {
      const message: UIMessage = {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call1",
            toolName: "tool1",
            result: "result1",
            costUsd: 1000,
          },
          {
            type: "tool-result",
            toolCallId: "call2",
            toolName: "tool2",
            result: "result2",
            costUsd: 2000,
          },
          {
            type: "tool-result",
            toolCallId: "call3",
            toolName: "tool3",
            result: "result3",
            costUsd: 3000,
          },
        ],
      };

      const result = getMessageCost(message);

      expect(result?.toolCosts).toEqual([
        { toolName: "tool1", costUsd: 1000 },
        { toolName: "tool2", costUsd: 2000 },
        { toolName: "tool3", costUsd: 3000 },
      ]);
      // Verify costs are individual, not cumulative
      expect(result?.toolCosts?.[0].costUsd).toBe(1000); // First tool: $0.001
      expect(result?.toolCosts?.[1].costUsd).toBe(2000); // Second tool: $0.002 (not $0.003)
      expect(result?.toolCosts?.[2].costUsd).toBe(3000); // Third tool: $0.003 (not $0.006)
    });

    it("should return undefined when no tool results have costs", () => {
      const message: UIMessage = {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call1",
            toolName: "tool1",
            result: "result1",
          },
        ],
      };

      const result = getMessageCost(message);

      expect(result).toBeUndefined();
    });

    it("should handle tool messages with string content", () => {
      const message: UIMessage = {
        role: "tool",
        content: "Some text",
      };

      const result = getMessageCost(message);

      expect(result).toBeUndefined();
    });
  });

  describe("other message types", () => {
    it("should return undefined for user messages", () => {
      const message: UIMessage = {
        role: "user",
        content: "Hello",
      };

      const result = getMessageCost(message);

      expect(result).toBeUndefined();
    });

    it("should return undefined for system messages", () => {
      const message: UIMessage = {
        role: "system",
        content: "System message",
      };

      const result = getMessageCost(message);

      expect(result).toBeUndefined();
    });
  });
});

