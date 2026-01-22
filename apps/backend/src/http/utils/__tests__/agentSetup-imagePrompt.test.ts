import { describe, expect, it } from "vitest";

import type { UIMessage } from "../../../utils/messageTypes";
import { resolveImagePrompt } from "../agentSetup";
import type { LlmObserverEvent } from "../llmObserver";

const createObserver = (messages: UIMessage[]) => {
  const events: LlmObserverEvent[] = [
    {
      type: "input-messages",
      timestamp: new Date().toISOString(),
      messages,
    },
  ];
  return {
    getEvents: () => events,
  };
};

describe("resolveImagePrompt", () => {
  it("prefers explicit prompt over observer messages", () => {
    const observer = createObserver([
      { role: "user", content: "fallback" },
    ]);

    const prompt = resolveImagePrompt("  direct prompt  ", observer as never);

    expect(prompt).toBe("direct prompt");
  });

  it("uses last user string message when prompt missing", () => {
    const observer = createObserver([
      { role: "assistant", content: "ignore" },
      { role: "user", content: "first prompt" },
      { role: "user", content: "latest prompt" },
    ]);

    const prompt = resolveImagePrompt(undefined, observer as never);

    expect(prompt).toBe("latest prompt");
  });

  it("uses text parts from last user message array", () => {
    const observer = createObserver([
      {
        role: "user",
        content: [
          { type: "text", text: "make" },
          { type: "text", text: "a cat" },
        ],
      },
    ]);

    const prompt = resolveImagePrompt(undefined, observer as never);

    expect(prompt).toBe("make\na cat");
  });

  it("returns null when no prompt or user messages found", () => {
    const observer = createObserver([{ role: "assistant", content: "hi" }]);

    const prompt = resolveImagePrompt(undefined, observer as never);

    expect(prompt).toBeNull();
  });
});
