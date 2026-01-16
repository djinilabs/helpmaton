import { describe, expect, it } from "vitest";

import type { LlmObserverEvent } from "../llmObserver";
import { buildConversationMessagesFromObserver } from "../llmObserver";

describe("buildConversationMessagesFromObserver", () => {
  it("builds assistant content with tool timing and cost extraction", () => {
    const events: LlmObserverEvent[] = [
      {
        type: "input-messages",
        timestamp: "2025-01-01T00:00:00.000Z",
        messages: [{ role: "user", content: "search for docs" }],
      },
      {
        type: "generation-started",
        timestamp: "2025-01-01T00:00:01.000Z",
      },
      {
        type: "tool-call",
        timestamp: "2025-01-01T00:00:02.000Z",
        toolCallId: "call-1",
        toolName: "search_documents",
        args: { query: "docs" },
      },
      {
        type: "tool-execution-started",
        timestamp: "2025-01-01T00:00:03.000Z",
        toolCallId: "call-1",
        toolName: "search_documents",
      },
      {
        type: "tool-execution-ended",
        timestamp: "2025-01-01T00:00:05.000Z",
        toolCallId: "call-1",
        toolName: "search_documents",
        result: "ok",
      },
      {
        type: "tool-result",
        timestamp: "2025-01-01T00:00:05.000Z",
        toolCallId: "call-1",
        toolName: "search_documents",
        result: "result __HM_TOOL_COST__:8000",
      },
      {
        type: "assistant-text",
        timestamp: "2025-01-01T00:00:06.000Z",
        text: "done",
      },
      {
        type: "generation-ended",
        timestamp: "2025-01-01T00:00:07.000Z",
      },
    ];

    const messages = buildConversationMessagesFromObserver({
      observerEvents: events,
      assistantMeta: {
        modelName: "test-model",
        provider: "openrouter",
      },
    });

    expect(messages).toHaveLength(2);
    const assistantMessage = messages[1];
    expect(assistantMessage.role).toBe("assistant");
    expect(Array.isArray(assistantMessage.content)).toBe(true);
    if (Array.isArray(assistantMessage.content)) {
      const toolCall = assistantMessage.content.find(
        (item) => typeof item === "object" && item?.type === "tool-call"
      );
      const toolResult = assistantMessage.content.find(
        (item) => typeof item === "object" && item?.type === "tool-result"
      );

      expect(toolCall).toEqual(
        expect.objectContaining({
          toolCallId: "call-1",
          toolName: "search_documents",
          toolCallStartedAt: "2025-01-01T00:00:02.000Z",
        })
      );

      expect(toolResult).toEqual(
        expect.objectContaining({
          toolCallId: "call-1",
          toolName: "search_documents",
          toolExecutionTimeMs: 2000,
          costUsd: 8000,
        })
      );
    }

    expect(assistantMessage.generationStartedAt).toBe(
      "2025-01-01T00:00:01.000Z"
    );
    expect(assistantMessage.generationEndedAt).toBe(
      "2025-01-01T00:00:07.000Z"
    );
  });

  it("falls back to provided input messages when none observed", () => {
    const events: LlmObserverEvent[] = [
      {
        type: "assistant-text",
        timestamp: "2025-01-01T00:00:02.000Z",
        text: "ok",
      },
    ];

    const messages = buildConversationMessagesFromObserver({
      observerEvents: events,
      fallbackInputMessages: [{ role: "user", content: "hello" }],
      assistantMeta: {
        provider: "openrouter",
      },
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
  });
});
