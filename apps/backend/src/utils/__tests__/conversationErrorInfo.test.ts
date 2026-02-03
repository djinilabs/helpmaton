import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  buildConversationErrorInfo,
  isCreditOrBudgetConversationError,
} from "../conversationErrorInfo";

describe("conversationErrorInfo", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("prefers data.error.message over generic wrapper text", () => {
    const error = new Error("No output generated");
    (error as { data?: { error?: { message?: string } } }).data = {
      error: { message: "Provider said no" },
    };

    const info = buildConversationErrorInfo(error);

    expect(info.message).toBe("Provider said no");
  });

  it("uses cause data.error.message for wrapper errors", () => {
    const cause = new Error("ignored");
    (cause as { data?: { error?: { message?: string } } }).data = {
      error: { message: "Root cause message" },
    };
    const wrapper = new Error("No output generated");
    (wrapper as { cause?: unknown }).cause = cause;

    const info = buildConversationErrorInfo(wrapper);

    expect(info.message).toBe("Root cause message");
  });

  it("extracts code and message from responseBody JSON", () => {
    const error = new Error("fallback");
    (error as { responseBody?: string }).responseBody = JSON.stringify({
      error: {
        message: "Invalid API key",
        code: "invalid_api_key",
      },
    });

    const info = buildConversationErrorInfo(error);

    expect(info.message).toBe("Invalid API key");
    expect(info.code).toBe("invalid_api_key");
  });

  it("captures status codes from response status", () => {
    const error = new Error("rate limited");
    (error as { response?: { status?: number } }).response = { status: 429 };

    const info = buildConversationErrorInfo(error);

    expect(info.statusCode).toBe(429);
  });

  it("captures status codes from non-Error objects", () => {
    const info = buildConversationErrorInfo({ statusCode: 503 });

    expect(info.statusCode).toBe(503);
  });

  describe("isCreditOrBudgetConversationError", () => {
    it("returns true when statusCode is 402", () => {
      expect(
        isCreditOrBudgetConversationError({
          message: "Payment required",
          statusCode: 402,
        }),
      ).toBe(true);
    });

    it("returns true when name is InsufficientCreditsError", () => {
      expect(
        isCreditOrBudgetConversationError({
          message: "Insufficient credits",
          name: "InsufficientCreditsError",
        }),
      ).toBe(true);
    });

    it("returns true when name is SpendingLimitExceededError", () => {
      expect(
        isCreditOrBudgetConversationError({
          message: "Spending limit exceeded",
          name: "SpendingLimitExceededError",
        }),
      ).toBe(true);
    });

    it("returns false when statusCode is not 402", () => {
      expect(
        isCreditOrBudgetConversationError({
          message: "Server error",
          statusCode: 500,
        }),
      ).toBe(false);
    });

    it("returns false when name is not a credit/budget error", () => {
      expect(
        isCreditOrBudgetConversationError({
          message: "Rate limited",
          name: "RateLimitError",
        }),
      ).toBe(false);
    });

    it("returns false when error has no statusCode and no matching name", () => {
      expect(
        isCreditOrBudgetConversationError({
          message: "Something went wrong",
        }),
      ).toBe(false);
    });
  });
});
