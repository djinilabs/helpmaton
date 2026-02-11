import type {
  UserModelMessage,
  AssistantModelMessage,
  SystemModelMessage,
  ToolModelMessage,
} from "ai";
import { describe, it, expect } from "vitest";

import type { UIMessage } from "../../../../utils/messageTypes";
import {
  createToolResultPart,
  convertUIMessagesToModelMessages,
  convertAiSdkUIMessageToUIMessage,
} from "../../messageConversion";

describe("createToolResultPart", () => {
  it("should create a ToolResultPart with string output formatted as text", () => {
    const result = createToolResultPart("call-123", "test_tool", "output text");
    expect(result).toEqual({
      type: "tool-result",
      toolCallId: "call-123",
      toolName: "test_tool",
      output: { type: "text", value: "output text" },
    });
  });

  it("should create a ToolResultPart with object output formatted as json", () => {
    const outputObj = { key: "value" };
    const result = createToolResultPart("call-123", "test_tool", outputObj);
    expect(result).toEqual({
      type: "tool-result",
      toolCallId: "call-123",
      toolName: "test_tool",
      output: { type: "json", value: outputObj },
    });
  });

  it("should convert null to empty text output", () => {
    const result = createToolResultPart("call-123", "test_tool", null);
    expect(result.output).toEqual({ type: "text", value: "" });
  });

  it("should convert undefined to empty text output", () => {
    const result = createToolResultPart("call-123", "test_tool", undefined);
    expect(result.output).toEqual({ type: "text", value: "" });
  });

  it("should convert number to text output", () => {
    const result = createToolResultPart("call-123", "test_tool", 42);
    expect(result.output).toEqual({ type: "text", value: "42" });
  });
});

describe("convertUIMessagesToModelMessages", () => {
  it("should convert simple user message", () => {
    const messages: UIMessage[] = [
      {
        role: "user",
        content: "Hello",
      },
    ];

    const result = convertUIMessagesToModelMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: "user",
      content: "Hello",
    } as UserModelMessage);
  });

  it("should convert user message with array content", () => {
    const messages: UIMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      },
    ];

    const result = convertUIMessagesToModelMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: "user",
      content: "Hello",
    } as UserModelMessage);
  });

  it("should convert system message", () => {
    const messages: UIMessage[] = [
      {
        role: "system",
        content: "You are a helpful assistant",
      },
    ];

    const result = convertUIMessagesToModelMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: "system",
      content: "You are a helpful assistant",
    } as SystemModelMessage);
  });

  it("should convert assistant message with text", () => {
    const messages: UIMessage[] = [
      {
        role: "assistant",
        content: "Hello, how can I help?",
      },
    ];

    const result = convertUIMessagesToModelMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: "assistant",
      content: "Hello, how can I help?",
    } as AssistantModelMessage);
  });

  it("should convert assistant message with tool calls", () => {
    const messages: UIMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-123",
            toolName: "search_documents",
            args: { query: "test" },
          },
        ],
      },
    ];

    const result = convertUIMessagesToModelMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "call-123",
          toolName: "search_documents",
          input: { query: "test" },
        },
      ],
    } as AssistantModelMessage);
  });

  it("should convert single assistant with multiple tool calls and results (continuation format, avoids MissingToolResultsError)", () => {
    // Structure built by handleToolContinuation: one assistant message containing
    // all tool-call parts then all tool-result parts, so every tool call has a result.
    const messages: UIMessage[] = [
      {
        role: "user",
        content: "Run both tools",
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "tool_call_agent_async_ABC",
            toolName: "call_agent_async",
            args: { agentId: "a1", message: "Task 1" },
          },
          {
            type: "tool-call",
            toolCallId: "tool_call_agent_async_XYZ",
            toolName: "call_agent_async",
            args: { agentId: "a2", message: "Task 2" },
          },
          {
            type: "tool-result",
            toolCallId: "tool_call_agent_async_ABC",
            toolName: "call_agent_async",
            result: "Task ID: t1",
          },
          {
            type: "tool-result",
            toolCallId: "tool_call_agent_async_XYZ",
            toolName: "call_agent_async",
            result: "Task ID: t2",
          },
        ],
      },
    ];

    const result = convertUIMessagesToModelMessages(messages);
    expect(result).toHaveLength(2); // user + assistant
    const assistantMsg = result.find((m) => m.role === "assistant") as
      | AssistantModelMessage
      | undefined;
    expect(assistantMsg).toBeDefined();
    expect(Array.isArray(assistantMsg.content)).toBe(true);
    const content = assistantMsg.content as Array<
      { type: string; toolCallId?: string } & Record<string, unknown>
    >;
    const toolCalls = content.filter((p) => p.type === "tool-call");
    const toolResults = content.filter((p) => p.type === "tool-result");
    expect(toolCalls).toHaveLength(2);
    expect(toolResults).toHaveLength(2);
    const resultIds = new Set(toolResults.map((r) => r.toolCallId));
    for (const tc of toolCalls) {
      expect(resultIds.has(tc.toolCallId)).toBe(true);
    }
  });

  it("should convert tool message with tool results", () => {
    const messages: UIMessage[] = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-123",
            toolName: "search_documents",
            result: "Found results",
          },
        ],
      },
    ];

    const result = convertUIMessagesToModelMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toEqual("assistant" as const);
    const toolMessage = result[0] as ToolModelMessage;
    expect(toolMessage.content).toHaveLength(1);
    expect(toolMessage.content[0]).toMatchObject({
      type: "tool-result",
      toolCallId: "call-123",
      toolName: "search_documents",
      output: { type: "text", value: "Found results" },
    });
  });

  it("should skip empty messages", () => {
    const messages: UIMessage[] = [
      {
        role: "user",
        content: "   ",
      },
      {
        role: "system",
        content: "",
      },
    ];

    const result = convertUIMessagesToModelMessages(messages);
    expect(result).toHaveLength(0);
  });

  it("should skip invalid messages", () => {
    const messages = [
      null,
      undefined,
      {},
      { role: "invalid" },
    ] as unknown as UIMessage[];

    const result = convertUIMessagesToModelMessages(messages);
    expect(result).toHaveLength(0);
  });

  it("should handle assistant message with both text and tool calls", () => {
    const messages: UIMessage[] = [
      {
        role: "assistant",
        content: [
          "Some text",
          {
            type: "tool-call",
            toolCallId: "call-123",
            toolName: "search_documents",
            args: { query: "test" },
          },
        ],
      },
    ];

    const result = convertUIMessagesToModelMessages(messages);
    // Should create separate messages for tool calls and text
    expect(result.length).toBeGreaterThanOrEqual(1);
    const toolCallMessage = result.find(
      (msg) => msg.role === "assistant" && Array.isArray(msg.content)
    ) as AssistantModelMessage;
    expect(toolCallMessage).toBeDefined();
    expect(Array.isArray(toolCallMessage.content)).toBe(true);
  });

  describe("convertAiSdkUIMessageToUIMessage - cost extraction", () => {
    it("should extract cost from assistant message with tool-result parts", () => {
      const message = {
        role: "assistant",
        parts: [
          {
            type: "tool-result",
            toolCallId: "call-123",
            toolName: "search_web",
            result: "Search results__HM_TOOL_COST__:8000",
          },
        ],
      };

      const result = convertAiSdkUIMessageToUIMessage(message);
      expect(result).not.toBeNull();
      if (result && Array.isArray(result.content)) {
        const toolResult = result.content.find(
          (item) =>
            typeof item === "object" &&
            item !== null &&
            "type" in item &&
            item.type === "tool-result"
        ) as
          | { type: "tool-result"; costUsd?: number; result: unknown }
          | undefined;
        expect(toolResult?.costUsd).toBe(8000);
        expect(toolResult?.result).toBe("Search results");
      }
    });

    it("should extract cost from tool message with tool-result parts", () => {
      const message = {
        role: "tool",
        parts: [
          {
            type: "tool-result",
            toolCallId: "call-123",
            toolName: "search_web",
            output: "Results__HM_TOOL_COST__:8000",
          },
        ],
      };

      const result = convertAiSdkUIMessageToUIMessage(message);
      expect(result).not.toBeNull();
      if (result && result.role === "tool" && Array.isArray(result.content)) {
        const toolResult = result.content[0] as {
          type: "tool-result";
          costUsd?: number;
          result: unknown;
        };
        expect(toolResult.costUsd).toBe(8000);
        expect(toolResult.result).toBe("Results");
      }
    });

    it("should use last cost marker when multiple markers exist", () => {
      const message = {
        role: "assistant",
        parts: [
          {
            type: "tool-result",
            toolCallId: "call-123",
            toolName: "search_web",
            result:
              "Result__HM_TOOL_COST__:1000__HM_TOOL_COST__:2000__HM_TOOL_COST__:3000",
          },
        ],
      };

      const result = convertAiSdkUIMessageToUIMessage(message);
      expect(result).not.toBeNull();
      if (result && Array.isArray(result.content)) {
        const toolResult = result.content.find(
          (item) =>
            typeof item === "object" &&
            item !== null &&
            "type" in item &&
            item.type === "tool-result"
        ) as
          | { type: "tool-result"; costUsd?: number; result: unknown }
          | undefined;
        expect(toolResult?.costUsd).toBe(3000);
        expect(toolResult?.result).toBe("Result");
      }
    });

    it("should not extract cost when marker is missing", () => {
      const message = {
        role: "assistant",
        parts: [
          {
            type: "tool-result",
            toolCallId: "call-123",
            toolName: "search_web",
            result: "Search results",
          },
        ],
      };

      const result = convertAiSdkUIMessageToUIMessage(message);
      expect(result).not.toBeNull();
      if (result && Array.isArray(result.content)) {
        const toolResult = result.content.find(
          (item) =>
            typeof item === "object" &&
            item !== null &&
            "type" in item &&
            item.type === "tool-result"
        ) as
          | { type: "tool-result"; costUsd?: number; result: unknown }
          | undefined;
        expect(toolResult?.costUsd).toBeUndefined();
        expect(toolResult?.result).toBe("Search results");
      }
    });

    it("should handle zero cost", () => {
      const message = {
        role: "assistant",
        parts: [
          {
            type: "tool-result",
            toolCallId: "call-123",
            toolName: "search_web",
            result: "Free result__HM_TOOL_COST__:0",
          },
        ],
      };

      const result = convertAiSdkUIMessageToUIMessage(message);
      expect(result).not.toBeNull();
      if (result && Array.isArray(result.content)) {
        const toolResult = result.content.find(
          (item) =>
            typeof item === "object" &&
            item !== null &&
            "type" in item &&
            item.type === "tool-result"
        ) as
          | { type: "tool-result"; costUsd?: number; result: unknown }
          | undefined;
        expect(toolResult?.costUsd).toBe(0);
        expect(toolResult?.result).toBe("Free result");
      }
    });

    it("should prefer output property over result property for cost extraction", () => {
      const message = {
        role: "tool",
        parts: [
          {
            type: "tool-result",
            toolCallId: "call-123",
            toolName: "search_web",
            output: "Output with cost__HM_TOOL_COST__:8000",
            result: "Result without cost",
          },
        ],
      };

      const result = convertAiSdkUIMessageToUIMessage(message);
      expect(result).not.toBeNull();
      if (result && result.role === "tool" && Array.isArray(result.content)) {
        const toolResult = result.content[0] as {
          type: "tool-result";
          costUsd?: number;
          result: unknown;
        };
        expect(toolResult.costUsd).toBe(8000);
        expect(toolResult.result).toBe("Output with cost");
      }
    });
  });
});
