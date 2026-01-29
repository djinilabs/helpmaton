import { describe, expect, it } from "vitest";

import { lastAssistantMessageHasText } from "./chatMessageParts";

describe("lastAssistantMessageHasText", () => {
  it("returns false when there are no messages", () => {
    expect(lastAssistantMessageHasText([])).toBe(false);
  });

  it("returns false when the last message is not assistant", () => {
    expect(
      lastAssistantMessageHasText([
        { role: "assistant", parts: [{ type: "text", text: "Hello" }] },
        { role: "user", content: "Follow-up" },
      ]),
    ).toBe(false);
  });

  it("returns false when assistant has only reasoning/tool parts", () => {
    expect(
      lastAssistantMessageHasText([
        {
          role: "assistant",
          parts: [
            { type: "reasoning", text: "Thinking..." },
            { type: "tool-call", toolName: "search", toolCallId: "1" },
          ],
        },
      ]),
    ).toBe(false);
  });

  it("returns false when assistant text is empty or whitespace", () => {
    expect(
      lastAssistantMessageHasText([
        {
          role: "assistant",
          parts: [{ type: "text", text: "   " }],
        },
      ]),
    ).toBe(false);
  });

  it("returns true when assistant has a non-empty text part", () => {
    expect(
      lastAssistantMessageHasText([
        {
          role: "assistant",
          parts: [{ type: "text", text: "Answer here" }],
        },
      ]),
    ).toBe(true);
  });

  it("returns true when assistant content is a non-empty string", () => {
    expect(
      lastAssistantMessageHasText([
        {
          role: "assistant",
          content: "Streamed text",
        },
      ]),
    ).toBe(true);
  });

  it("returns true when assistant content array contains text", () => {
    expect(
      lastAssistantMessageHasText([
        {
          role: "assistant",
          content: ["Hello", { type: "reasoning", text: "..." }],
        },
      ]),
    ).toBe(true);
  });
});
