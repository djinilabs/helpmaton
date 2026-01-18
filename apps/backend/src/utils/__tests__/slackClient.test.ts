import { describe, it, expect, beforeEach, vi } from "vitest";

import * as slackClient from "../slackClient";

// Mock fetch
global.fetch = vi.fn();

// Mock OAuth utilities
vi.mock("../googleApi/oauth", () => ({
  getOAuthTokens: vi.fn().mockResolvedValue({
    accessToken: "test-access-token",
    refreshToken: "test-refresh-token",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  }),
  ensureValidToken: vi.fn().mockResolvedValue("test-access-token"),
  updateOAuthTokens: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../oauth/mcp/slack", () => ({
  refreshSlackToken: vi.fn().mockResolvedValue({
    accessToken: "refreshed-token",
    refreshToken: "refreshed-token",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  }),
}));

describe("Slack API Client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listChannels", () => {
    it("should list channels", async () => {
      const mockChannels = [
        {
          id: "C123",
          name: "general",
          is_private: false,
          topic: { value: "Company updates" },
          purpose: { value: "General chat" },
        },
      ];

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          ok: true,
          channels: mockChannels,
          response_metadata: { next_cursor: "next" },
        }),
      } as Partial<Response> as Response);

      const result = await slackClient.listChannels("workspace-1", "server-1");

      expect(result.channels[0]).toEqual({
        id: "C123",
        name: "general",
        isPrivate: false,
        topic: "Company updates",
        purpose: "General chat",
      });
      expect(result.nextCursor).toBe("next");
    });
  });

  describe("getChannelHistory", () => {
    it("should return formatted channel history", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          ok: true,
          messages: [
            {
              ts: "1700000000.000000",
              user: "U123",
              blocks: [
                {
                  type: "section",
                  text: { type: "mrkdwn", text: "Hello from blocks" },
                },
              ],
            },
          ],
          has_more: false,
          response_metadata: { next_cursor: "" },
        }),
      } as Partial<Response> as Response);

      const result = await slackClient.getChannelHistory(
        "workspace-1",
        "server-1",
        "C123"
      );

      expect(result.channelId).toBe("C123");
      expect(result.messages[0].user).toBe("U123");
      expect(result.messages[0].text).toContain("U123:");
      expect(result.messages[0].text).toContain("Hello from blocks");
      expect(result.hasMore).toBe(false);
    });
  });

  describe("postMessage", () => {
    it("should post a message", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          ok: true,
          channel: "C123",
          ts: "1700000001.000000",
          message: { text: "Hello!" },
        }),
      } as Partial<Response> as Response);

      const result = await slackClient.postMessage(
        "workspace-1",
        "server-1",
        "C123",
        "Hello!"
      );

      expect(result).toEqual({
        channel: "C123",
        ts: "1700000001.000000",
        text: "Hello!",
      });
    });
  });
});
