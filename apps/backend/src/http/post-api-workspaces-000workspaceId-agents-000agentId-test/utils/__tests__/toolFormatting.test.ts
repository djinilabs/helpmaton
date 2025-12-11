import { describe, it, expect } from "vitest";

import {
  formatToolCallMessage,
  formatToolResultMessage,
} from "../toolFormatting";

describe("formatToolCallMessage", () => {
  it("should format tool call with args", () => {
    const toolCall = {
      toolCallId: "call-123",
      toolName: "search_documents",
      args: { query: "test query" },
    };

    const result = formatToolCallMessage(toolCall);
    expect(result).toEqual({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "call-123",
          toolName: "search_documents",
          args: { query: "test query" },
        },
      ],
    });
  });

  it("should format tool call with input instead of args", () => {
    const toolCall = {
      toolCallId: "call-123",
      toolName: "search_documents",
      input: { query: "test query" },
    };

    const result = formatToolCallMessage(toolCall);
    expect(result.content[0].args).toEqual({ query: "test query" });
  });

  it("should use empty object when neither args nor input provided", () => {
    const toolCall = {
      toolCallId: "call-123",
      toolName: "search_documents",
    };

    const result = formatToolCallMessage(toolCall);
    expect(result.content[0].args).toEqual({});
  });

  it("should prefer args over input", () => {
    const toolCall = {
      toolCallId: "call-123",
      toolName: "search_documents",
      args: { query: "args value" },
      input: { query: "input value" },
    };

    const result = formatToolCallMessage(toolCall);
    expect(result.content[0].args).toEqual({ query: "args value" });
  });
});

describe("formatToolResultMessage", () => {
  it("should format tool result with output", () => {
    const toolResult = {
      toolCallId: "call-123",
      toolName: "search_documents",
      output: "Search results here",
    };

    const result = formatToolResultMessage(toolResult);
    expect(result).toEqual({
      role: "assistant",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-123",
          toolName: "search_documents",
          result: "Search results here",
        },
      ],
    });
  });

  it("should format tool result with result instead of output", () => {
    const toolResult = {
      toolCallId: "call-123",
      toolName: "search_documents",
      result: "Search results here",
    };

    const result = formatToolResultMessage(toolResult);
    expect(result.content[0].result).toBe("Search results here");
  });

  it("should truncate long string results", () => {
    const longString = "a".repeat(3000);
    const toolResult = {
      toolCallId: "call-123",
      toolName: "search_documents",
      output: longString,
    };

    const result = formatToolResultMessage(toolResult);
    const formattedResult = result.content[0].result as string;
    expect(formattedResult.length).toBeLessThan(longString.length);
    expect(formattedResult).toContain("[Results truncated");
  });

  it("should not truncate short strings", () => {
    const shortString = "Short result";
    const toolResult = {
      toolCallId: "call-123",
      toolName: "search_documents",
      output: shortString,
    };

    const result = formatToolResultMessage(toolResult);
    expect(result.content[0].result).toBe(shortString);
  });

  it("should handle object results", () => {
    const objectResult = { key: "value", count: 42 };
    const toolResult = {
      toolCallId: "call-123",
      toolName: "search_documents",
      output: objectResult,
    };

    const result = formatToolResultMessage(toolResult);
    expect(result.content[0].result).toEqual(objectResult);
  });

  it("should convert non-string, non-object results to string", () => {
    const toolResult = {
      toolCallId: "call-123",
      toolName: "search_documents",
      output: 42,
    };

    const result = formatToolResultMessage(toolResult);
    expect(result.content[0].result).toBe("42");
  });

  it("should handle null result", () => {
    const toolResult = {
      toolCallId: "call-123",
      toolName: "search_documents",
      output: null,
    };

    const result = formatToolResultMessage(toolResult);
    expect(result.content[0].result).toBe("null");
  });

  it("should use empty string when neither output nor result provided", () => {
    const toolResult = {
      toolCallId: "call-123",
      toolName: "search_documents",
    };

    const result = formatToolResultMessage(toolResult);
    expect(result.content[0].result).toBe("");
  });
});
