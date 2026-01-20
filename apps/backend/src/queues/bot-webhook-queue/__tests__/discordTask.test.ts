import { describe, expect, it, beforeEach, afterEach } from "vitest";

import {
  extractDiscordToolingFromResult,
  resolveDiscordBaseUrl,
} from "../discordTask";

describe("discordTask helpers", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("resolveDiscordBaseUrl", () => {
    it("prefers WEBHOOK_BASE_URL over BASE_URL", () => {
      process.env.WEBHOOK_BASE_URL = "https://webhook.example.com";
      process.env.BASE_URL = "https://base.example.com";
      expect(resolveDiscordBaseUrl()).toBe("https://webhook.example.com");
    });

    it("falls back to BASE_URL when WEBHOOK_BASE_URL is empty", () => {
      process.env.WEBHOOK_BASE_URL = " ";
      process.env.BASE_URL = "https://base.example.com";
      expect(resolveDiscordBaseUrl()).toBe("https://base.example.com");
    });
  });

  describe("extractDiscordToolingFromResult", () => {
    it("extracts tool calls, results, and reasoning from steps", () => {
      const rawResult = {
        steps: [
          {
            content: [
              {
                type: "tool-call",
                toolCallId: "call-1",
                toolName: "get_datetime",
                args: { zone: "UTC" },
              },
              {
                type: "tool-result",
                toolCallId: "call-1",
                toolName: "get_datetime",
                result: "ok",
              },
              {
                type: "reasoning",
                text: "working",
              },
            ],
          },
        ],
      };

      const result = extractDiscordToolingFromResult({
        rawResult,
        generationStartedAt: "2024-01-01T00:00:00.000Z",
      });

      expect(result.toolCallsFromResult).toHaveLength(1);
      expect(result.toolResultsFromResult).toHaveLength(1);
      expect(result.reasoningFromSteps).toEqual([
        { type: "reasoning", text: "working" },
      ]);
    });

    it("falls back to raw tool arrays when steps missing", () => {
      const rawResult = {
        toolCalls: [{ toolCallId: "call-2", toolName: "search", args: {} }],
        toolResults: [{ toolCallId: "call-2", toolName: "search", result: "ok" }],
      };

      const result = extractDiscordToolingFromResult({ rawResult });

      expect(result.toolCallsFromResult).toHaveLength(1);
      expect(result.toolResultsFromResult).toHaveLength(1);
      expect(result.reasoningFromSteps).toHaveLength(0);
    });
  });
});
