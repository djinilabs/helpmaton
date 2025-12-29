import { describe, it, expect, vi, beforeEach } from "vitest";

import { sendSlackMessage } from "../slack";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("sendSlackMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should send a message successfully", async () => {
    const webhookUrl = "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX";
    const content = "Test message";

    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => "ok",
    });

    await sendSlackMessage(webhookUrl, content);

    expect(mockFetch).toHaveBeenCalledWith(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: content,
      }),
    });
  });

  it("should throw error for 401 status", async () => {
    const webhookUrl = "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX";
    const content = "Test message";

    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => JSON.stringify({ error: "invalid_token" }),
    });

    await expect(sendSlackMessage(webhookUrl, content)).rejects.toThrow(
      "Invalid Slack webhook URL or token"
    );
  });

  it("should throw error for 403 status", async () => {
    const webhookUrl = "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX";
    const content = "Test message";

    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => JSON.stringify({ error: "forbidden" }),
    });

    await expect(sendSlackMessage(webhookUrl, content)).rejects.toThrow(
      "Slack webhook lacks permission to send messages"
    );
  });

  it("should throw error for 404 status", async () => {
    const webhookUrl = "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX";
    const content = "Test message";

    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => JSON.stringify({ error: "channel_not_found" }),
    });

    await expect(sendSlackMessage(webhookUrl, content)).rejects.toThrow(
      "Slack webhook not found or has been deleted"
    );
  });

  it("should throw error for 500 status", async () => {
    const webhookUrl = "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX";
    const content = "Test message";

    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => JSON.stringify({ error: "internal_error" }),
    });

    await expect(sendSlackMessage(webhookUrl, content)).rejects.toThrow(
      "Slack API error: internal_error"
    );
  });

  it("should handle network errors", async () => {
    const webhookUrl = "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX";
    const content = "Test message";

    mockFetch.mockRejectedValue(new Error("Network error"));

    await expect(sendSlackMessage(webhookUrl, content)).rejects.toThrow(
      "Network error"
    );
  });

  it("should handle non-JSON error responses", async () => {
    const webhookUrl = "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX";
    const content = "Test message";

    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: async () => "Invalid request",
    });

    await expect(sendSlackMessage(webhookUrl, content)).rejects.toThrow(
      "Slack API error: Invalid request"
    );
  });
});

