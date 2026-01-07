import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  markdownToDiscord,
  truncateDiscordMessage,
  createDiscordInteractionResponse,
  createDiscordDeferredResponse,
  updateDiscordMessage,
} from "../discordResponse";

// Mock global fetch
global.fetch = vi.fn();

describe("markdownToDiscord", () => {
  it("should preserve bold **text** (no change)", () => {
    const input = "This is **bold** text";
    const result = markdownToDiscord(input);
    expect(result).toBe("This is **bold** text");
  });

  it("should convert bold __text__ to **text**", () => {
    const input = "This is __bold__ text";
    const result = markdownToDiscord(input);
    expect(result).toBe("This is **bold** text");
  });

  it("should preserve italic *text* (no change)", () => {
    const input = "This is *italic* text";
    const result = markdownToDiscord(input);
    expect(result).toBe("This is *italic* text");
  });

  it("should convert italic _text_ to *text*", () => {
    const input = "This is _italic_ text";
    const result = markdownToDiscord(input);
    expect(result).toBe("This is *italic* text");
  });

  it("should handle mixed formatting", () => {
    const input = "**bold** *italic*";
    const result = markdownToDiscord(input);
    expect(result).toBe("**bold** *italic*");
  });

  it("should preserve code blocks: ```code```", () => {
    const input = "```\nconst x = 1;\n```";
    const result = markdownToDiscord(input);
    expect(result).toBe("```\nconst x = 1;\n```");
  });

  it("should preserve inline code: `code`", () => {
    const input = "This is `inline code` text";
    const result = markdownToDiscord(input);
    expect(result).toBe("This is `inline code` text");
  });

  it("should preserve links: [text](url)", () => {
    const input = "Check [this link](https://example.com)";
    const result = markdownToDiscord(input);
    expect(result).toBe("Check [this link](https://example.com)");
  });

  it("should handle edge cases with lookbehind/lookahead regex", () => {
    const input = "*text* **bold** _italic_";
    const result = markdownToDiscord(input);
    // Should preserve *text* and **bold**, convert _italic_ to *italic*
    expect(result).toContain("*text*");
    expect(result).toContain("**bold**");
    expect(result).toContain("*italic*");
  });

  it("should handle empty string", () => {
    const result = markdownToDiscord("");
    expect(result).toBe("");
  });
});

describe("truncateDiscordMessage", () => {
  it("should not truncate text under 2000 chars", () => {
    const text = "Short text";
    const result = truncateDiscordMessage(text);
    expect(result).toBe(text);
  });

  it("should not truncate text exactly at limit", () => {
    const text = "x".repeat(2000);
    const result = truncateDiscordMessage(text);
    expect(result).toBe(text);
  });

  it("should truncate text over limit with ...", () => {
    const text = "x".repeat(3000);
    const result = truncateDiscordMessage(text);
    expect(result.length).toBe(2000);
    expect(result.endsWith("...")).toBe(true);
    expect(result.substring(0, result.length - 3)).toBe("x".repeat(1997));
  });

  it("should respect custom maxLength parameter", () => {
    const text = "x".repeat(100);
    const result = truncateDiscordMessage(text, 50);
    expect(result.length).toBe(50);
    expect(result.endsWith("...")).toBe(true);
  });
});

describe("createDiscordInteractionResponse", () => {
  it("should create channel message response", () => {
    const result = createDiscordInteractionResponse("Test message", false);
    expect(result).toEqual({
      type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
      data: {
        content: "Test message",
      },
    });
  });

  it("should create ephemeral response", () => {
    const result = createDiscordInteractionResponse("Test message", true);
    expect(result).toEqual({
      type: 4,
      data: {
        content: "Test message",
        flags: 64, // EPHEMERAL
      },
    });
  });

  it("should convert markdown in content", () => {
    const result = createDiscordInteractionResponse("**bold** text", false);
    expect(result.data.content).toBe("**bold** text");
  });

  it("should truncate long content", () => {
    const longText = "x".repeat(3000);
    const result = createDiscordInteractionResponse(longText, false);
    expect(result.data.content.length).toBe(2000);
    expect(result.data.content.endsWith("...")).toBe(true);
  });
});

describe("createDiscordDeferredResponse", () => {
  it("should create deferred response", () => {
    const result = createDiscordDeferredResponse();
    expect(result).toEqual({
      type: 5, // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
    });
  });
});

describe("updateDiscordMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should successfully update message", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
    };
    vi.mocked(global.fetch).mockResolvedValue(mockResponse as unknown as Response);

    await updateDiscordMessage(
      "bot-token",
      "application-id",
      "interaction-token",
      "Updated message"
    );

    expect(global.fetch).toHaveBeenCalledWith(
      "https://discord.com/api/v10/webhooks/application-id/interaction-token/messages/@original",
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bot bot-token",
        },
        body: JSON.stringify({
          content: "Updated message",
        }),
      }
    );
  });

  it("should convert markdown in message text", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
    };
    vi.mocked(global.fetch).mockResolvedValue(mockResponse as unknown as Response);

    await updateDiscordMessage(
      "bot-token",
      "application-id",
      "interaction-token",
      "**bold** text"
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({
          content: "**bold** text",
        }),
      })
    );
  });

  it("should throw error on 404 response", async () => {
    const mockResponse = {
      ok: false,
      status: 404,
      text: async () => "Not Found",
    };
    vi.mocked(global.fetch).mockResolvedValue(mockResponse as unknown as Response);

    await expect(
      updateDiscordMessage("bot-token", "application-id", "interaction-token", "Message")
    ).rejects.toThrow("Failed to update Discord message: 404");
  });

  it("should throw error on 401 response", async () => {
    const mockResponse = {
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    };
    vi.mocked(global.fetch).mockResolvedValue(mockResponse as unknown as Response);

    await expect(
      updateDiscordMessage("bot-token", "application-id", "interaction-token", "Message")
    ).rejects.toThrow("Failed to update Discord message: 401");
  });

  it("should throw error on 403 response", async () => {
    const mockResponse = {
      ok: false,
      status: 403,
      text: async () => "Forbidden",
    };
    vi.mocked(global.fetch).mockResolvedValue(mockResponse as unknown as Response);

    await expect(
      updateDiscordMessage("bot-token", "application-id", "interaction-token", "Message")
    ).rejects.toThrow("Failed to update Discord message: 403");
  });

  it("should throw error on 500 response", async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    };
    vi.mocked(global.fetch).mockResolvedValue(mockResponse as unknown as Response);

    await expect(
      updateDiscordMessage("bot-token", "application-id", "interaction-token", "Message")
    ).rejects.toThrow("Failed to update Discord message: 500");
  });

  it("should handle network errors", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error("Network error"));

    await expect(
      updateDiscordMessage("bot-token", "application-id", "interaction-token", "Message")
    ).rejects.toThrow("Network error");
  });

  it("should handle error when response.text() fails", async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      text: async () => {
        throw new Error("Failed to read response");
      },
    };
    vi.mocked(global.fetch).mockResolvedValue(mockResponse as unknown as Response);

    await expect(
      updateDiscordMessage("bot-token", "application-id", "interaction-token", "Message")
    ).rejects.toThrow("Failed to update Discord message: 500");
  });
});

