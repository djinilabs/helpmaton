import { describe, expect, it } from "vitest";

import type { EvalResult } from "../api";
import { canOpenEvalConversation } from "../evalResults";

const baseResult: EvalResult = {
  conversationId: "conv-123",
  judgeId: "judge-1",
  judgeName: "Judge",
  summary: "summary",
  scoreGoalCompletion: 80,
  scoreToolEfficiency: 70,
  scoreFaithfulness: 90,
  criticalFailureDetected: false,
  reasoningTrace: "trace",
  costUsd: null,
  evaluatedAt: "2025-01-01T00:00:00.000Z",
};

describe("canOpenEvalConversation", () => {
  it("returns true when conversationId is present", () => {
    expect(canOpenEvalConversation(baseResult)).toBe(true);
  });

  it("returns false for empty conversationId", () => {
    expect(
      canOpenEvalConversation({
        ...baseResult,
        conversationId: "",
      })
    ).toBe(false);
  });

  it("returns false for whitespace conversationId", () => {
    expect(
      canOpenEvalConversation({
        ...baseResult,
        conversationId: "   ",
      })
    ).toBe(false);
  });

  it("returns false for missing result", () => {
    expect(canOpenEvalConversation(undefined)).toBe(false);
    expect(canOpenEvalConversation(null)).toBe(false);
  });
});
