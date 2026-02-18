import { describe, it, expect } from "vitest";

import { buildContinuationInstructions } from "../../continuation";
import { convertUIMessagesToModelMessages } from "../../messageConversion";
import {
  formatToolCallMessage,
  formatToolResultMessage,
} from "../../toolFormatting";

describe("buildContinuationInstructions", () => {
  it("should return empty string when no tool results", () => {
    const result = buildContinuationInstructions([]);
    expect(result).toBe("");
  });

  it("should include notification instructions when notification result present", () => {
    const toolResults = [{ toolName: "send_notification" }];
    const result = buildContinuationInstructions(toolResults);
    expect(result).toContain("notification");
    expect(result).toContain("✅");
  });

  it("should include search instructions when search result present", () => {
    const toolResults = [{ toolName: "search_documents" }];
    const result = buildContinuationInstructions(toolResults);
    expect(result).toContain("document searches");
    expect(result).toContain("summary");
  });

  it("should include both instructions when both results present", () => {
    const toolResults = [
      { toolName: "send_notification" },
      { toolName: "search_documents" },
    ];
    const result = buildContinuationInstructions(toolResults);
    expect(result).toContain("notification");
    expect(result).toContain("document searches");
  });

  it("should handle tool results without toolName", () => {
    const toolResults = [{}];
    const result = buildContinuationInstructions(toolResults);
    expect(result).toBe("");
  });

  it("should handle mixed tool results", () => {
    const toolResults = [
      { toolName: "send_notification" },
      {},
      { toolName: "other_tool" },
    ];
    const result = buildContinuationInstructions(toolResults);
    expect(result).toContain("notification");
    expect(result).not.toContain("other_tool");
  });
});

describe("continuation tool-round message (MissingToolResultsError fix)", () => {
  it("single assistant message with multiple tool calls and results converts so every tool call has a result", () => {
    // Simulate the structure handleToolContinuation now builds: one assistant
    // message with all tool-call parts then all tool-result parts.
    const toolCalls = [
      {
        toolCallId: "tool_call_agent_async_LC4Khiq8Gi3O0ZShw0X1",
        toolName: "call_agent_async",
        args: { agentId: "agent1", message: "Do X" },
      },
      {
        toolCallId: "tool_call_agent_async_DeKiDsEhVdOh01my2GoP",
        toolName: "call_agent_async",
        args: { agentId: "agent2", message: "Do Y" },
      },
    ];
    const toolResults = [
      {
        toolCallId: "tool_call_agent_async_LC4Khiq8Gi3O0ZShw0X1",
        toolName: "call_agent_async",
        result: "Task created: t1",
      },
      {
        toolCallId: "tool_call_agent_async_DeKiDsEhVdOh01my2GoP",
        toolName: "call_agent_async",
        result: "Task created: t2",
      },
    ];
    const toolCallUIMessages = toolCalls.map(formatToolCallMessage);
    const toolResultUIMessages = toolResults.map((tr) =>
      formatToolResultMessage(tr),
    );
    const toolRoundContent = [
      ...toolCallUIMessages.flatMap((m) => m.content),
      ...toolResultUIMessages.flatMap((m) => m.content),
    ];
    const messages = [
      { role: "user" as const, content: "Run both" },
      { role: "assistant" as const, content: toolRoundContent },
    ];

    const modelMessages = convertUIMessagesToModelMessages(messages);

    // Tool results are emitted as a separate message with role "tool" so the AI SDK
    // validator clears pending tool-call IDs (avoids AI_MissingToolResultsError).
    const assistantMessages = modelMessages.filter((m) => m.role === "assistant");
    const toolMessages = modelMessages.filter((m) => m.role === "tool");
    expect(assistantMessages).toHaveLength(1);
    expect(toolMessages).toHaveLength(1);
    const assistantContent = (assistantMessages[0] as { content: unknown[] }).content;
    const calls = assistantContent.filter(
      (p: unknown) =>
        p && typeof p === "object" && "type" in p && p.type === "tool-call"
    );
    const toolContent = (toolMessages[0] as { content: Array<{ toolCallId?: string }> }).content;
    expect(calls).toHaveLength(2);
    expect(toolContent).toHaveLength(2);
    const resultIds = new Set(toolContent.map((r) => r.toolCallId));
    for (const c of calls as { toolCallId?: string }[]) {
      expect(resultIds.has(c.toolCallId)).toBe(true);
    }
  });
});

// Note: handleToolContinuation is an integration function that requires
// extensive mocking of AI SDK and other dependencies.
// Unit tests for this function would require complex setup and are better
// suited for integration tests.

