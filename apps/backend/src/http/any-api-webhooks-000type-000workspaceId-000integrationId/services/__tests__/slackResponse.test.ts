import { WebClient } from "@slack/web-api";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  markdownToSlack,
  truncateSlackMessage,
  postSlackMessage,
  updateSlackMessage,
} from "../slackResponse";

describe("markdownToSlack", () => {
  it("should convert bold **text** to *text*", () => {
    const input = "This is **bold** text";
    const result = markdownToSlack(input);
    expect(result).toBe("This is *bold* text");
  });

  it("should convert bold __text__ to *text*", () => {
    const input = "This is __bold__ text";
    const result = markdownToSlack(input);
    expect(result).toBe("This is *bold* text");
  });

  it("should convert italic *text* to _text_", () => {
    const input = "This is *italic* text";
    const result = markdownToSlack(input);
    expect(result).toBe("This is _italic_ text");
  });

  it("should convert italic _text_ to _text_", () => {
    const input = "This is _italic_ text";
    const result = markdownToSlack(input);
    expect(result).toBe("This is _italic_ text");
  });

  it("should handle mixed formatting: **bold** *italic*", () => {
    const input = "**bold** *italic*";
    const result = markdownToSlack(input);
    expect(result).toBe("*bold* _italic_");
  });

  it("should handle nested formatting: **bold *italic* bold**", () => {
    const input = "**bold *italic* bold**";
    const result = markdownToSlack(input);
    // The italic inside bold should be preserved
    expect(result).toContain("*bold");
    expect(result).toContain("italic");
  });

  it("should preserve code blocks: ```code```", () => {
    const input = "```\nconst x = 1;\n```";
    const result = markdownToSlack(input);
    expect(result).toContain("```");
    expect(result).toContain("const x = 1;");
  });

  it("should preserve code blocks with language: ```javascript\ncode\n```", () => {
    const input = "```javascript\nconst x = 1;\n```";
    const result = markdownToSlack(input);
    expect(result).toContain("```javascript");
    expect(result).toContain("const x = 1;");
  });

  it("should preserve inline code: `code`", () => {
    const input = "This is `inline code` text";
    const result = markdownToSlack(input);
    expect(result).toBe("This is `inline code` text");
  });

  it("should convert links: [text](url) to <url|text>", () => {
    const input = "Check [this link](https://example.com)";
    const result = markdownToSlack(input);
    expect(result).toBe("Check <https://example.com|this link>");
  });

  it("should handle multiple links in one message", () => {
    const input = "[First](https://example.com) and [Second](https://test.com)";
    const result = markdownToSlack(input);
    expect(result).toBe("<https://example.com|First> and <https://test.com|Second>");
  });

  it("should convert line breaks: \\n\\n to \\n", () => {
    const input = "Line 1\n\nLine 2";
    const result = markdownToSlack(input);
    expect(result).toBe("Line 1\nLine 2");
  });

  it("should handle empty string", () => {
    const result = markdownToSlack("");
    expect(result).toBe("");
  });

  it("should handle text with only formatting", () => {
    const input = "**bold**";
    const result = markdownToSlack(input);
    expect(result).toBe("*bold*");
  });

  it("should handle text with no formatting", () => {
    const input = "Plain text with no formatting";
    const result = markdownToSlack(input);
    expect(result).toBe("Plain text with no formatting");
  });

  it("should handle complex markdown with all features", () => {
    const input = "**Bold** *italic* `code` [link](url)\n\n```\ncode block\n```";
    const result = markdownToSlack(input);
    expect(result).toContain("*Bold*");
    expect(result).toContain("_italic_");
    expect(result).toContain("`code`");
    expect(result).toContain("<url|link>");
    expect(result).toContain("```");
  });
});

describe("truncateSlackMessage", () => {
  it("should not truncate text under limit", () => {
    const text = "Short text";
    const result = truncateSlackMessage(text);
    expect(result).toBe(text);
  });

  it("should not truncate text exactly at limit", () => {
    const text = "x".repeat(4000);
    const result = truncateSlackMessage(text);
    expect(result).toBe(text);
  });

  it("should truncate text over limit with ...", () => {
    const text = "x".repeat(5000);
    const result = truncateSlackMessage(text);
    expect(result.length).toBe(4000);
    expect(result.endsWith("...")).toBe(true);
    expect(result.substring(0, result.length - 3)).toBe("x".repeat(3997));
  });

  it("should respect custom maxLength parameter", () => {
    const text = "x".repeat(100);
    const result = truncateSlackMessage(text, 50);
    expect(result.length).toBe(50);
    expect(result.endsWith("...")).toBe(true);
  });
});

describe("postSlackMessage", () => {
  let mockClient: WebClient;

  beforeEach(() => {
    mockClient = {
      chat: {
        postMessage: vi.fn(),
      },
    } as unknown as WebClient;
  });

  it("should successfully post message", async () => {
    const mockResponse = {
      ok: true,
      ts: "1234567890.123456",
      channel: "C123456",
    };
    vi.mocked(mockClient.chat.postMessage).mockResolvedValue(mockResponse);

    const result = await postSlackMessage(mockClient, "C123456", "Test message");

    expect(result).toEqual({
      ts: "1234567890.123456",
      channel: "C123456",
    });
    expect(mockClient.chat.postMessage).toHaveBeenCalledWith({
      channel: "C123456",
      text: "Test message",
      thread_ts: undefined,
    });
  });

  it("should post message with thread_ts", async () => {
    const mockResponse = {
      ok: true,
      ts: "1234567890.123456",
      channel: "C123456",
    };
    vi.mocked(mockClient.chat.postMessage).mockResolvedValue(mockResponse);

    await postSlackMessage(mockClient, "C123456", "Test message", "1234567890.123455");

    expect(mockClient.chat.postMessage).toHaveBeenCalledWith({
      channel: "C123456",
      text: "Test message",
      thread_ts: "1234567890.123455",
    });
  });

  it("should convert markdown in message text", async () => {
    const mockResponse = {
      ok: true,
      ts: "1234567890.123456",
      channel: "C123456",
    };
    vi.mocked(mockClient.chat.postMessage).mockResolvedValue(mockResponse);

    await postSlackMessage(mockClient, "C123456", "**bold** text");

    expect(mockClient.chat.postMessage).toHaveBeenCalledWith({
      channel: "C123456",
      text: "*bold* text",
      thread_ts: undefined,
    });
  });

  it("should throw error when Slack API returns error", async () => {
    const mockResponse = {
      ok: false,
      error: "invalid_auth",
    };
    vi.mocked(mockClient.chat.postMessage).mockResolvedValue(mockResponse);

    await expect(
      postSlackMessage(mockClient, "C123456", "Test message")
    ).rejects.toThrow("Failed to post Slack message");
  });

  it("should throw error when ts is missing", async () => {
    const mockResponse = {
      ok: true,
      channel: "C123456",
      // ts is missing
    };
    vi.mocked(mockClient.chat.postMessage).mockResolvedValue(mockResponse);

    await expect(
      postSlackMessage(mockClient, "C123456", "Test message")
    ).rejects.toThrow("Failed to post Slack message");
  });

  it("should throw error when channel is missing", async () => {
    const mockResponse = {
      ok: true,
      ts: "1234567890.123456",
      // channel is missing
    };
    vi.mocked(mockClient.chat.postMessage).mockResolvedValue(mockResponse);

    await expect(
      postSlackMessage(mockClient, "C123456", "Test message")
    ).rejects.toThrow("Failed to post Slack message");
  });
});

describe("updateSlackMessage", () => {
  let mockClient: WebClient;

  beforeEach(() => {
    mockClient = {
      chat: {
        update: vi.fn(),
      },
    } as unknown as WebClient;
  });

  it("should successfully update message", async () => {
    const mockResponse = {
      ok: true,
    };
    vi.mocked(mockClient.chat.update).mockResolvedValue(mockResponse);

    await updateSlackMessage(mockClient, "C123456", "1234567890.123456", "Updated message");

    expect(mockClient.chat.update).toHaveBeenCalledWith({
      channel: "C123456",
      ts: "1234567890.123456",
      text: "Updated message",
    });
  });

  it("should convert markdown in message text", async () => {
    const mockResponse = {
      ok: true,
    };
    vi.mocked(mockClient.chat.update).mockResolvedValue(mockResponse);

    await updateSlackMessage(mockClient, "C123456", "1234567890.123456", "**bold** text");

    expect(mockClient.chat.update).toHaveBeenCalledWith({
      channel: "C123456",
      ts: "1234567890.123456",
      text: "*bold* text",
    });
  });

  it("should throw error when Slack API returns error", async () => {
    const mockResponse = {
      ok: false,
      error: "message_not_found",
    };
    vi.mocked(mockClient.chat.update).mockResolvedValue(mockResponse);

    await expect(
      updateSlackMessage(mockClient, "C123456", "1234567890.123456", "Updated message")
    ).rejects.toThrow("Failed to update Slack message");
  });
});

