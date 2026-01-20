import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { buildConversationErrorInfo } from "../conversationErrorInfo";

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
});
