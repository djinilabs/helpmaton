import { describe, it, expect } from "vitest";

import {
  extractToolCallsAndResults,
  ensureToolCallsHaveMatchingResults,
} from "../extractToolCallsAndResults";

describe("extractToolCallsAndResults", () => {
  it("extracts from top-level when no steps", () => {
    const result = {
      text: "Hello",
      toolCalls: [
        {
          toolCallId: "call_1",
          toolName: "send_notification",
          args: { content: "test" },
        },
      ],
      toolResults: [
        {
          toolCallId: "call_1",
          toolName: "send_notification",
          result: "✅ Sent",
        },
      ],
    };
    const { toolCalls, toolResults } = extractToolCallsAndResults(result);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].toolCallId).toBe("call_1");
    expect(toolCalls[0].toolName).toBe("send_notification");
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].toolCallId).toBe("call_1");
  });

  it("extracts from steps when available", () => {
    const result = {
      text: "",
      steps: [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "tool_send_notification_AbDbv7CS5uL4XrRdBNGp",
              toolName: "send_notification",
              input: { content: "hello" },
            },
            {
              type: "tool-result",
              toolCallId: "tool_send_notification_AbDbv7CS5uL4XrRdBNGp",
              toolName: "send_notification",
              output: { type: "text", value: "✅ Sent" },
            },
          ],
        },
      ],
    };
    const { toolCalls, toolResults } = extractToolCallsAndResults(result);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].toolCallId).toBe(
      "tool_send_notification_AbDbv7CS5uL4XrRdBNGp"
    );
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].toolCallId).toBe(
      "tool_send_notification_AbDbv7CS5uL4XrRdBNGp"
    );
    expect(toolResults[0].result).toBe("✅ Sent");
  });

  it("extracts from _steps.status.value when steps is not direct", () => {
    const result = {
      text: "",
      _steps: {
        status: {
          value: [
            {
              content: [
                {
                  type: "tool-call",
                  toolCallId: "call_from_steps",
                  toolName: "get_datetime",
                  args: {},
                },
                {
                  type: "tool-result",
                  toolCallId: "call_from_steps",
                  toolName: "get_datetime",
                  result: "2026-02-14T12:00:00Z",
                },
              ],
            },
          ],
        },
      },
    };
    const { toolCalls, toolResults } = extractToolCallsAndResults(result);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].toolCallId).toBe("call_from_steps");
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].result).toBe("2026-02-14T12:00:00Z");
  });

  it("extracts multiple tool calls and results from steps", () => {
    const result = {
      text: "",
      steps: [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "call_a",
              toolName: "search_documents",
              input: { query: "test" },
            },
            {
              type: "tool-result",
              toolCallId: "call_a",
              toolName: "search_documents",
              output: { type: "text", value: "Found 3 docs" },
            },
            {
              type: "tool-call",
              toolCallId: "call_b",
              toolName: "send_notification",
              input: { content: "alert" },
            },
            {
              type: "tool-result",
              toolCallId: "call_b",
              toolName: "send_notification",
              result: "✅ Sent",
            },
          ],
        },
      ],
    };
    const { toolCalls, toolResults } = extractToolCallsAndResults(result);
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0].toolCallId).toBe("call_a");
    expect(toolCalls[1].toolCallId).toBe("call_b");
    expect(toolResults).toHaveLength(2);
    expect(toolResults[0].result).toBe("Found 3 docs");
    expect(toolResults[1].result).toBe("✅ Sent");
  });

  it("uses args when input is missing for tool-call", () => {
    const result = {
      steps: [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "call_1",
              toolName: "send_notification",
              args: { content: "via args" },
            },
          ],
        },
      ],
    };
    const { toolCalls } = extractToolCallsAndResults(result);
    expect(toolCalls[0].args).toEqual({ content: "via args" });
  });

  it("extracts tool-result with result field when output has value object", () => {
    const result = {
      steps: [
        {
          content: [
            {
              type: "tool-result",
              toolCallId: "call_1",
              toolName: "send_notification",
              result: "Direct result string",
            },
          ],
        },
      ],
    };
    const { toolResults } = extractToolCallsAndResults(result);
    expect(toolResults[0].result).toBe("Direct result string");
  });

  it("returns empty arrays when result has no tool data", () => {
    const result = { text: "Hello" };
    const { toolCalls, toolResults } = extractToolCallsAndResults(result);
    expect(toolCalls).toHaveLength(0);
    expect(toolResults).toHaveLength(0);
  });

  it("returns empty arrays when steps is empty", () => {
    const result = { text: "", steps: [] };
    const { toolCalls, toolResults } = extractToolCallsAndResults(result);
    expect(toolCalls).toHaveLength(0);
    expect(toolResults).toHaveLength(0);
  });

  it("falls back to top-level when steps has no tool content", () => {
    const result = {
      steps: [{ content: [{ type: "text", text: "no tools" }] }],
      toolCalls: [{ toolCallId: "top_1", toolName: "x", args: {} }],
      toolResults: [{ toolCallId: "top_1", toolName: "x", result: "ok" }],
    };
    const { toolCalls, toolResults } = extractToolCallsAndResults(result);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].toolCallId).toBe("top_1");
    expect(toolResults).toHaveLength(1);
  });

  it("handles null/undefined result safely", () => {
    const { toolCalls, toolResults } = extractToolCallsAndResults(null);
    expect(toolCalls).toHaveLength(0);
    expect(toolResults).toHaveLength(0);
  });

  it("handles non-array top-level toolCalls/toolResults", () => {
    const result = {
      toolCalls: "not-an-array",
      toolResults: null,
    };
    const { toolCalls, toolResults } = extractToolCallsAndResults(result);
    expect(toolCalls).toHaveLength(0);
    expect(toolResults).toHaveLength(0);
  });

  it("skips tool-call with missing toolCallId or toolName", () => {
    const result = {
      steps: [
        {
          content: [
            { type: "tool-call", toolName: "x", args: {} },
            { type: "tool-call", toolCallId: "valid", toolName: "send_notification", args: {} },
          ],
        },
      ],
    };
    const { toolCalls } = extractToolCallsAndResults(result);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].toolCallId).toBe("valid");
    expect(toolCalls[0].toolName).toBe("send_notification");
  });

  it("skips tool-result with missing toolCallId or toolName", () => {
    const result = {
      steps: [
        {
          content: [
            { type: "tool-result", toolName: "x", result: "bad" },
            {
              type: "tool-result",
              toolCallId: "valid",
              toolName: "x",
              result: "ok",
            },
          ],
        },
      ],
    };
    const { toolResults } = extractToolCallsAndResults(result);
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].toolCallId).toBe("valid");
  });
});

describe("ensureToolCallsHaveMatchingResults", () => {
  it("returns existing results when all tool calls have matches", () => {
    const toolCalls = [
      { toolCallId: "call_1", toolName: "send_notification", args: {} },
    ];
    const toolResults = [
      { toolCallId: "call_1", toolName: "send_notification", result: "✅" },
    ];
    const result = ensureToolCallsHaveMatchingResults(toolCalls, toolResults);
    expect(result).toHaveLength(1);
    expect(result[0].result).toBe("✅");
  });

  it("adds synthetic error result when tool call has no matching result", () => {
    const toolCalls = [
      {
        toolCallId: "tool_send_notification_AbDbv7CS5uL4XrRdBNGp",
        toolName: "send_notification",
        args: {},
      },
    ];
    const toolResults: Array<{
      toolCallId: string;
      toolName: string;
      result?: string;
    }> = [];
    const result = ensureToolCallsHaveMatchingResults(toolCalls, toolResults);
    expect(result).toHaveLength(1);
    expect(result[0].toolCallId).toBe(
      "tool_send_notification_AbDbv7CS5uL4XrRdBNGp"
    );
    expect(result[0].result).toContain("Tool execution did not complete");
    expect(result[0].result).toContain("send_notification");
  });

  it("handles partial matches - uses existing for matches, synthetic for missing", () => {
    const toolCalls = [
      { toolCallId: "call_1", toolName: "tool_a", args: {} },
      { toolCallId: "call_2", toolName: "tool_b", args: {} },
    ];
    const toolResults = [
      { toolCallId: "call_1", toolName: "tool_a", result: "ok" },
    ];
    const result = ensureToolCallsHaveMatchingResults(toolCalls, toolResults);
    expect(result).toHaveLength(2);
    expect(result[0].result).toBe("ok");
    expect(result[1].result).toContain("Tool execution did not complete");
    expect(result[1].result).toContain("tool_b");
  });

  it("returns empty array when toolCalls is empty", () => {
    const result = ensureToolCallsHaveMatchingResults([], [
      { toolCallId: "orphan", toolName: "x", result: "ok" },
    ]);
    expect(result).toHaveLength(0);
  });

  it("preserves result order to match tool call order", () => {
    const toolCalls = [
      { toolCallId: "call_2", toolName: "b", args: {} },
      { toolCallId: "call_1", toolName: "a", args: {} },
    ];
    const toolResults = [
      { toolCallId: "call_1", toolName: "a", result: "first" },
      { toolCallId: "call_2", toolName: "b", result: "second" },
    ];
    const result = ensureToolCallsHaveMatchingResults(toolCalls, toolResults);
    expect(result).toHaveLength(2);
    expect(result[0].toolCallId).toBe("call_2");
    expect(result[0].result).toBe("second");
    expect(result[1].toolCallId).toBe("call_1");
    expect(result[1].result).toBe("first");
  });

  it("ignores tool results without toolCallId", () => {
    const toolCalls = [
      { toolCallId: "call_1", toolName: "x", args: {} },
    ];
    const toolResults = [
      { toolName: "x", result: "no-id" },
    ] as Array<{ toolCallId: string; toolName: string; result?: string }>;
    const result = ensureToolCallsHaveMatchingResults(toolCalls, toolResults);
    expect(result).toHaveLength(1);
    expect(result[0].result).toContain("Tool execution did not complete");
    expect(result[0].result).toContain("x");
  });
});
