import { describe, expect, it } from "vitest";

import type { LlmObserverEvent } from "../llmObserver";
import {
  buildConversationMessagesFromObserver,
  createLlmObserver,
  withLlmObserver,
  wrapToolsWithObserver,
} from "../llmObserver";

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
    expect(assistantMessage.generationEndedAt).toBe("2025-01-01T00:00:07.000Z");
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

  it("adds fallback assistant text when observer has no text", () => {
    const events: LlmObserverEvent[] = [
      {
        type: "input-messages",
        timestamp: "2025-01-01T00:00:00.000Z",
        messages: [{ role: "user", content: "hello" }],
      },
    ];

    const messages = buildConversationMessagesFromObserver({
      observerEvents: events,
      fallbackAssistantText: "fallback response",
      assistantMeta: {
        provider: "openrouter",
      },
    });

    expect(messages).toHaveLength(2);
    const assistantMessage = messages[1];
    expect(assistantMessage.role).toBe("assistant");
    expect(Array.isArray(assistantMessage.content)).toBe(true);
    if (Array.isArray(assistantMessage.content)) {
      expect(assistantMessage.content).toContainEqual({
        type: "text",
        text: "fallback response",
      });
    }
  });

  it("includes assistant file parts from observer events", () => {
    const events: LlmObserverEvent[] = [
      {
        type: "input-messages",
        timestamp: "2025-01-01T00:00:00.000Z",
        messages: [{ role: "user", content: "share file" }],
      },
      {
        type: "assistant-file",
        timestamp: "2025-01-01T00:00:02.000Z",
        fileUrl: "https://example.com/file.pdf",
        mediaType: "application/pdf",
        filename: "file.pdf",
      },
    ];

    const messages = buildConversationMessagesFromObserver({
      observerEvents: events,
      assistantMeta: {
        provider: "openrouter",
      },
    });

    const assistantMessage = messages[1];
    expect(assistantMessage.role).toBe("assistant");
    expect(Array.isArray(assistantMessage.content)).toBe(true);
    if (Array.isArray(assistantMessage.content)) {
      expect(assistantMessage.content).toContainEqual({
        type: "file",
        file: "https://example.com/file.pdf",
        mediaType: "application/pdf",
        filename: "file.pdf",
      });
    }
  });

  it("deduplicates file parts from tool results and observer file events", () => {
    const events: LlmObserverEvent[] = [
      {
        type: "input-messages",
        timestamp: "2025-01-01T00:00:00.000Z",
        messages: [{ role: "user", content: "generate image" }],
      },
      {
        type: "tool-result",
        timestamp: "2025-01-01T00:00:01.000Z",
        toolCallId: "call-1",
        toolName: "generate_image",
        result: {
          url: "https://example.com/image.png",
          contentType: "image/png",
          filename: "image.png",
        },
      },
      {
        type: "assistant-file",
        timestamp: "2025-01-01T00:00:02.000Z",
        fileUrl: "https://example.com/image.png",
        mediaType: "image/png",
        filename: "image.png",
      },
    ];

    const messages = buildConversationMessagesFromObserver({
      observerEvents: events,
      assistantMeta: {
        provider: "openrouter",
      },
    });

    const assistantMessage = messages[1];
    expect(assistantMessage.role).toBe("assistant");
    expect(Array.isArray(assistantMessage.content)).toBe(true);
    if (Array.isArray(assistantMessage.content)) {
      const fileParts = assistantMessage.content.filter(
        (item) =>
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          item.type === "file"
      );
      expect(fileParts).toHaveLength(1);
    }
  });

  it("adds tool call/results from tool execution events", () => {
    const events: LlmObserverEvent[] = [
      {
        type: "input-messages",
        timestamp: "2025-01-01T00:00:00.000Z",
        messages: [{ role: "user", content: "what time is it" }],
      },
      {
        type: "tool-execution-started",
        timestamp: "2025-01-01T00:00:01.000Z",
        toolName: "get_datetime",
      },
      {
        type: "tool-execution-ended",
        timestamp: "2025-01-01T00:00:02.000Z",
        toolName: "get_datetime",
        result: "ok",
      },
    ];

    const messages = buildConversationMessagesFromObserver({
      observerEvents: events,
      assistantMeta: {
        provider: "openrouter",
      },
    });

    const assistantMessage = messages[1];
    expect(assistantMessage.role).toBe("assistant");
    expect(Array.isArray(assistantMessage.content)).toBe(true);
    if (Array.isArray(assistantMessage.content)) {
      expect(
        assistantMessage.content.some(
          (item) =>
            typeof item === "object" &&
            item?.type === "tool-call" &&
            item.toolName === "get_datetime"
        )
      ).toBe(true);
      expect(
        assistantMessage.content.some(
          (item) =>
            typeof item === "object" &&
            item?.type === "tool-result" &&
            item.toolName === "get_datetime"
        )
      ).toBe(true);
    }
  });
});

describe("llmObserver helpers", () => {
  it("records events from AI SDK-style result steps", () => {
    const observer = createLlmObserver();
    observer.recordFromResult({
      steps: [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "search_documents",
              input: { query: "docs" },
            },
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "search_documents",
              result: "ok",
            },
            { type: "reasoning", text: "thinking" },
          ],
        },
      ],
      text: "done",
    });

    const events = observer.getEvents();
    expect(events.some((event) => event.type === "tool-call")).toBe(true);
    expect(events.some((event) => event.type === "tool-result")).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "assistant-reasoning" && event.text === "thinking"
      )
    ).toBe(true);
    expect(
      events.some(
        (event) => event.type === "assistant-text" && event.text === "done"
      )
    ).toBe(true);
  });

  it("records tool calls and results from result arrays", () => {
    const observer = createLlmObserver();
    observer.recordFromResult({
      toolCalls: [
        {
          toolCallId: "call-2",
          toolName: "search_memory",
          input: { query: "notes" },
        },
      ],
      toolResults: [
        {
          toolCallId: "call-2",
          toolName: "search_memory",
          result: "ok",
        },
      ],
      text: "finished",
    });

    const events = observer.getEvents();
    expect(
      events.some(
        (event) => event.type === "tool-call" && event.toolCallId === "call-2"
      )
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "tool-result" && event.toolCallId === "call-2"
      )
    ).toBe(true);
  });

  it("deduplicates tool results recorded from steps and arrays", () => {
    const observer = createLlmObserver();
    observer.recordFromResult({
      steps: [
        {
          content: [
            {
              type: "tool-result",
              toolCallId: "call-3",
              toolName: "get_datetime",
              result: "ok",
            },
          ],
        },
      ],
      toolResults: [
        {
          toolCallId: "call-3",
          toolName: "get_datetime",
          result: "ok",
        },
      ],
    });

    const events = observer
      .getEvents()
      .filter((event) => event.type === "tool-result");
    expect(events).toHaveLength(1);
  });

  it("deduplicates generation start/end events", () => {
    const observer = createLlmObserver();
    observer.recordGenerationStarted();
    observer.recordGenerationStarted();
    observer.recordGenerationEnded();
    observer.recordGenerationEnded();

    const events = observer.getEvents();
    const startCount = events.filter(
      (event) => event.type === "generation-started"
    ).length;
    const endCount = events.filter(
      (event) => event.type === "generation-ended"
    ).length;
    expect(startCount).toBe(1);
    expect(endCount).toBe(1);
  });

  it("wraps models to record generation events", async () => {
    const observer = createLlmObserver();
    const model = {
      doGenerate: async () => {
        return {
          steps: [
            {
              content: [
                {
                  type: "tool-call",
                  toolCallId: "call-1",
                  toolName: "search_documents",
                  args: { query: "docs" },
                },
              ],
            },
          ],
          text: "ok",
        };
      },
    };

    const wrapped = withLlmObserver(model, observer);
    await wrapped.doGenerate?.();

    const events = observer.getEvents();
    expect(events.some((event) => event.type === "generation-started")).toBe(
      true
    );
    expect(events.some((event) => event.type === "generation-ended")).toBe(
      true
    );
    expect(events.some((event) => event.type === "tool-call")).toBe(true);
  });

  it("wraps tools and records execution timing events", async () => {
    const observer = createLlmObserver();
    const tools = {
      search_documents: {
        description: "Search docs",
        execute: async () => "ok",
      },
    };

    const wrapped = wrapToolsWithObserver(tools, observer);
    await wrapped.search_documents.execute?.();

    const events = observer.getEvents();
    expect(
      events.some((event) => event.type === "tool-execution-started")
    ).toBe(true);
    expect(events.some((event) => event.type === "tool-execution-ended")).toBe(
      true
    );
  });

  it("returns tool error results instead of throwing", async () => {
    const observer = createLlmObserver();
    const tools = {
      search_documents: {
        description: "Search docs",
        execute: async () => {
          throw new Error("Tool failed");
        },
      },
    };

    const wrapped = wrapToolsWithObserver(tools, observer);
    const result = await wrapped.search_documents.execute?.();

    expect(result).toEqual({
      error: {
        message: "Tool failed",
        name: "Error",
      },
      isError: true,
    });

    const events = observer.getEvents();
    const endedEvent = events.find(
      (event) => event.type === "tool-execution-ended"
    );
    expect(endedEvent).toBeDefined();
    if (endedEvent && endedEvent.type === "tool-execution-ended") {
      expect(endedEvent.error).toBe("Tool failed");
    }
  });
});
