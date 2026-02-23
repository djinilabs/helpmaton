import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  DISCORD_MESSAGE_MAX_LENGTH,
  normalizeDiscordContent,
  sendDiscordMessage,
} from "../discord";

describe("normalizeDiscordContent", () => {
  it("returns trimmed content when within limit", () => {
    expect(normalizeDiscordContent("  hello world  ")).toBe("hello world");
    expect(normalizeDiscordContent("x")).toBe("x");
    expect(normalizeDiscordContent("a".repeat(2000))).toBe("a".repeat(2000));
  });

  it("throws when trimmed content is empty", () => {
    expect(() => normalizeDiscordContent("")).toThrow(
      /content cannot be empty/
    );
    expect(() => normalizeDiscordContent("   ")).toThrow(
      /content cannot be empty/
    );
    expect(() => normalizeDiscordContent("\t\n")).toThrow(
      /content cannot be empty/
    );
  });

  it("truncates to 2000 characters with ellipsis when over limit", () => {
    const long = "a".repeat(2500);
    const result = normalizeDiscordContent(long);
    expect(result.length).toBe(DISCORD_MESSAGE_MAX_LENGTH);
    expect(result.endsWith("…")).toBe(true);
    expect(result).toBe("a".repeat(1999) + "…");
  });
});

describe("sendDiscordMessage", () => {
  const botToken = "test-bot-token";
  const channelId = "123456789012345678";

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("sends normalized content (trimmed and truncated when over 2000)", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "msg-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const longContent = "  " + "x".repeat(2001) + "  ";
    await sendDiscordMessage(botToken, channelId, longContent);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain(channelId);
    const body = JSON.parse(options?.body as string);
    expect(body.content.length).toBe(DISCORD_MESSAGE_MAX_LENGTH);
    expect(body.content.endsWith("…")).toBe(true);
  });

  it("throws when content is empty after trim", async () => {
    await expect(
      sendDiscordMessage(botToken, channelId, "   ")
    ).rejects.toThrow(/cannot be empty/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("includes Discord errors detail in thrown message on 400", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          message: "Invalid Form Body",
          code: 50035,
          errors: {
            content: {
              _errors: [
                {
                  message: "Must be 2000 or fewer in length.",
                  code: "STRING_MAX_LENGTH",
                },
              ],
            },
          },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    );

    let err: unknown;
    await sendDiscordMessage(botToken, channelId, "short").catch((e) => {
      err = e;
    });
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/Invalid Form Body/);
    expect((err as Error).message).toContain("errors");
  });

  it("throws clear error on 403", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ message: "Missing Access" }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      )
    );

    await expect(
      sendDiscordMessage(botToken, channelId, "hello")
    ).rejects.toThrow("Bot lacks permission to send messages in this channel");
  });
});
