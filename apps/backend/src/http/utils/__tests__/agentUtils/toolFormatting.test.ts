import { describe, it, expect } from "vitest";

import {
  formatToolCallMessage,
  formatToolResultMessage,
  getDefaultMaxToolOutputBytes,
  TOOL_OUTPUT_TRIMMED_SUFFIX,
} from "../../toolFormatting";

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
    const toolResultContent = result.content.find((item) => item.type === "tool-result");
    expect(toolResultContent).toBeDefined();
    expect(toolResultContent && "result" in toolResultContent ? toolResultContent.result : undefined).toBe("Search results here");
  });

  it("should truncate long string results over 1 MB with trimmed-for-brevity indication", () => {
    const maxBytes = getDefaultMaxToolOutputBytes();
    const longString = "a".repeat(maxBytes + 1000);
    const toolResult = {
      toolCallId: "call-123",
      toolName: "search_documents",
      output: longString,
    };

    const result = formatToolResultMessage(toolResult);
    const toolResultContent = result.content.find((item) => item.type === "tool-result");
    expect(toolResultContent).toBeDefined();
    const formattedResult = toolResultContent && "result" in toolResultContent ? toolResultContent.result as string : "";
    expect(formattedResult.length).toBeLessThan(longString.length);
    expect(formattedResult).toContain(TOOL_OUTPUT_TRIMMED_SUFFIX);
    expect(formattedResult.length).toBe(maxBytes + TOOL_OUTPUT_TRIMMED_SUFFIX.length);
  });

  it("should not truncate short strings", () => {
    const shortString = "Short result";
    const toolResult = {
      toolCallId: "call-123",
      toolName: "search_documents",
      output: shortString,
    };

    const result = formatToolResultMessage(toolResult);
    const toolResultContent = result.content.find((item) => item.type === "tool-result");
    expect(toolResultContent).toBeDefined();
    expect(toolResultContent && "result" in toolResultContent ? toolResultContent.result : undefined).toBe(shortString);
  });

  it("should not truncate strings under 1 MB", () => {
    const maxBytes = getDefaultMaxToolOutputBytes();
    const underLimit = "b".repeat(maxBytes - 100);
    const toolResult = {
      toolCallId: "call-123",
      toolName: "search_documents",
      output: underLimit,
    };

    const result = formatToolResultMessage(toolResult);
    const toolResultContent = result.content.find((item) => item.type === "tool-result");
    expect(toolResultContent).toBeDefined();
    const formattedResult = toolResultContent && "result" in toolResultContent ? toolResultContent.result as string : "";
    expect(formattedResult).toBe(underLimit);
    expect(formattedResult).not.toContain(TOOL_OUTPUT_TRIMMED_SUFFIX);
  });

  it("should truncate large object output when stringified length exceeds 1 MB", () => {
    const maxBytes = getDefaultMaxToolOutputBytes();
    const bigPayload = { data: "x".repeat(maxBytes) };
    const toolResult = {
      toolCallId: "call-123",
      toolName: "search_documents",
      output: bigPayload,
    };

    const result = formatToolResultMessage(toolResult);
    const toolResultContent = result.content.find((item) => item.type === "tool-result");
    expect(toolResultContent).toBeDefined();
    const formattedResult = toolResultContent && "result" in toolResultContent ? toolResultContent.result as string : "";
    expect(formattedResult).toContain(TOOL_OUTPUT_TRIMMED_SUFFIX);
    expect(formattedResult.length).toBe(maxBytes + TOOL_OUTPUT_TRIMMED_SUFFIX.length);
  });

  it("should handle object results", () => {
    const objectResult = { key: "value", count: 42 };
    const toolResult = {
      toolCallId: "call-123",
      toolName: "search_documents",
      output: objectResult,
    };

    const result = formatToolResultMessage(toolResult);
    const toolResultContent = result.content.find((item) => item.type === "tool-result");
    expect(toolResultContent).toBeDefined();
    expect(toolResultContent && "result" in toolResultContent ? toolResultContent.result : undefined).toEqual(objectResult);
  });

  it("should append file part for generate_image tool results", () => {
    const toolResult = {
      toolCallId: "call-123",
      toolName: "generate_image",
      output: {
        url: "https://example.com/image.png",
        contentType: "image/png",
        filename: "image.png",
      },
    };

    const result = formatToolResultMessage(toolResult);
    const filePart = result.content.find((item) => item.type === "file");
    expect(filePart).toEqual({
      type: "file",
      file: "https://example.com/image.png",
      mediaType: "image/png",
      filename: "image.png",
    });
  });

  it("should extract tool cost metadata from object results", () => {
    const toolResult = {
      toolCallId: "call-123",
      toolName: "generate_image",
      output: {
        url: "https://example.com/image.png",
        contentType: "image/png",
        filename: "image.png",
        costUsd: 1234,
        openrouterGenerationId: "gen-123",
      },
    };

    const result = formatToolResultMessage(toolResult);
    const toolResultContent = result.content.find((item) => item.type === "tool-result");
    const filePart = result.content.find((item) => item.type === "file");

    expect(toolResultContent).toBeDefined();
    expect(toolResultContent && "costUsd" in toolResultContent ? toolResultContent.costUsd : undefined).toBe(1234);
    expect(
      toolResultContent && "openrouterGenerationId" in toolResultContent
        ? toolResultContent.openrouterGenerationId
        : undefined
    ).toBe("gen-123");
    expect(toolResultContent && "result" in toolResultContent ? toolResultContent.result : undefined).toEqual({
      url: "https://example.com/image.png",
      contentType: "image/png",
      filename: "image.png",
    });
    expect(filePart).toEqual({
      type: "file",
      file: "https://example.com/image.png",
      mediaType: "image/png",
      filename: "image.png",
    });
  });

  it("should convert non-string, non-object results to string", () => {
    const toolResult = {
      toolCallId: "call-123",
      toolName: "search_documents",
      output: 42,
    };

    const result = formatToolResultMessage(toolResult);
    const toolResultContent = result.content.find((item) => item.type === "tool-result");
    expect(toolResultContent).toBeDefined();
    expect(toolResultContent && "result" in toolResultContent ? toolResultContent.result : undefined).toBe("42");
  });

  it("should handle null result", () => {
    const toolResult = {
      toolCallId: "call-123",
      toolName: "search_documents",
      output: null,
    };

    const result = formatToolResultMessage(toolResult);
    const toolResultContent = result.content.find((item) => item.type === "tool-result");
    expect(toolResultContent).toBeDefined();
    expect(toolResultContent && "result" in toolResultContent ? toolResultContent.result : undefined).toBe("null");
  });

  it("should use empty string when neither output nor result provided", () => {
    const toolResult = {
      toolCallId: "call-123",
      toolName: "search_documents",
    };

    const result = formatToolResultMessage(toolResult);
    const toolResultContent = result.content.find((item) => item.type === "tool-result");
    expect(toolResultContent).toBeDefined();
    expect(toolResultContent && "result" in toolResultContent ? toolResultContent.result : undefined).toBe("");
  });

  describe("cost extraction", () => {
    it("should extract cost from __HM_TOOL_COST__:8000 marker and add as costUsd", () => {
      const toolResult = {
        toolCallId: "call-123",
        toolName: "search_web",
        output:
          'Found 5 search results for "TimeClout":\n\n1. **TimeClout**\n   URL: https://example.com\n\n__HM_TOOL_COST__:8000',
      };

      const result = formatToolResultMessage(toolResult);
      const toolResultContent = result.content.find((item) => item.type === "tool-result");
      expect(toolResultContent).toBeDefined();
      expect(toolResultContent && "costUsd" in toolResultContent ? toolResultContent.costUsd : undefined).toBe(8000);
      expect(toolResultContent && "result" in toolResultContent ? toolResultContent.result : undefined).toBe(
        'Found 5 search results for "TimeClout":\n\n1. **TimeClout**\n   URL: https://example.com'
      );
    });

    it("should remove cost marker from result string", () => {
      const toolResult = {
        toolCallId: "call-123",
        toolName: "search_web",
        output: "Search results here\n\n__HM_TOOL_COST__:8000",
      };

      const result = formatToolResultMessage(toolResult);
      const toolResultContent = result.content.find((item) => item.type === "tool-result");
      expect(toolResultContent).toBeDefined();
      expect(toolResultContent && "result" in toolResultContent ? toolResultContent.result : undefined).toBe("Search results here");
      expect(toolResultContent && "costUsd" in toolResultContent ? toolResultContent.costUsd : undefined).toBe(8000);
    });

    it("should extract cost when using result property instead of output", () => {
      const toolResult = {
        toolCallId: "call-123",
        toolName: "search_web",
        result: "Search results here\n\n__HM_TOOL_COST__:8000",
      };

      const result = formatToolResultMessage(toolResult);
      const toolResultContent = result.content.find((item) => item.type === "tool-result");
      expect(toolResultContent).toBeDefined();
      expect(toolResultContent && "costUsd" in toolResultContent ? toolResultContent.costUsd : undefined).toBe(8000);
      expect(toolResultContent && "result" in toolResultContent ? toolResultContent.result : undefined).toBe("Search results here");
    });

    it("should prefer output property over result property for cost extraction", () => {
      const toolResult = {
        toolCallId: "call-123",
        toolName: "search_web",
        output: "Output with cost\n\n__HM_TOOL_COST__:8000",
        result: "Result without cost",
      };

      const result = formatToolResultMessage(toolResult);
      const toolResultContent = result.content.find((item) => item.type === "tool-result");
      expect(toolResultContent).toBeDefined();
      expect(toolResultContent && "costUsd" in toolResultContent ? toolResultContent.costUsd : undefined).toBe(8000);
      expect(toolResultContent && "result" in toolResultContent ? toolResultContent.result : undefined).toBe("Output with cost");
    });

    it("should extract cost from long strings before truncation", () => {
      const longString = "a".repeat(1500) + "\n\n__HM_TOOL_COST__:8000";
      const toolResult = {
        toolCallId: "call-123",
        toolName: "search_web",
        output: longString,
      };

      const result = formatToolResultMessage(toolResult);
      const toolResultContent = result.content.find((item) => item.type === "tool-result");
      expect(toolResultContent).toBeDefined();
      expect(toolResultContent && "costUsd" in toolResultContent ? toolResultContent.costUsd : undefined).toBe(8000);
      // Cost marker should be removed, and string should be truncated if needed
      const formattedResult = toolResultContent && "result" in toolResultContent ? toolResultContent.result as string : "";
      expect(formattedResult).not.toContain("__HM_TOOL_COST__:8000");
    });

    it("should handle cost with different values", () => {
      const toolResult = {
        toolCallId: "call-123",
        toolName: "search_web",
        output: "Results\n\n__HM_TOOL_COST__:16000",
      };

      const result = formatToolResultMessage(toolResult);
      const toolResultContent = result.content.find((item) => item.type === "tool-result");
      expect(toolResultContent).toBeDefined();
      expect(toolResultContent && "costUsd" in toolResultContent ? toolResultContent.costUsd : undefined).toBe(16000);
    });

    it("should not extract cost when marker is missing", () => {
      const toolResult = {
        toolCallId: "call-123",
        toolName: "search_web",
        output: "Search results here",
      };

      const result = formatToolResultMessage(toolResult);
      const toolResultContent = result.content.find((item) => item.type === "tool-result");
      expect(toolResultContent).toBeDefined();
      expect(toolResultContent && "costUsd" in toolResultContent ? toolResultContent.costUsd : undefined).toBeUndefined();
      expect(toolResultContent && "result" in toolResultContent ? toolResultContent.result : undefined).toBe("Search results here");
    });

    it("should not extract cost when marker format is invalid", () => {
      const toolResult = {
        toolCallId: "call-123",
        toolName: "search_web",
        output: "Results\n\n__HM_TOOL_COST__:invalid",
      };

      const result = formatToolResultMessage(toolResult);
      const toolResultContent = result.content.find((item) => item.type === "tool-result");
      expect(toolResultContent).toBeDefined();
      expect(toolResultContent && "costUsd" in toolResultContent ? toolResultContent.costUsd : undefined).toBeUndefined();
      // Invalid marker should remain in result
      const resultValue = toolResultContent && "result" in toolResultContent ? toolResultContent.result as string : "";
      expect(resultValue).toContain("__HM_TOOL_COST__:invalid");
    });

    it("should extract cost when marker appears anywhere in string (uses last occurrence)", () => {
      const toolResult = {
        toolCallId: "call-123",
        toolName: "search_web",
        output:
          "Results with __HM_TOOL_COST__:5000 in the middle and __HM_TOOL_COST__:8000 at end",
      };

      const result = formatToolResultMessage(toolResult);
      const toolResultContent = result.content.find((item) => item.type === "tool-result");
      expect(toolResultContent).toBeDefined();
      // Should use the last occurrence (8000)
      expect(toolResultContent && "costUsd" in toolResultContent ? toolResultContent.costUsd : undefined).toBe(8000);
      // All markers should be removed
      const resultValue = toolResultContent && "result" in toolResultContent ? toolResultContent.result as string : "";
      expect(resultValue).not.toContain("__HM_TOOL_COST__");
      expect(resultValue).toBe(
        "Results with  in the middle and  at end"
      );
    });

    it("should extract cost when marker is at end without trailing newline", () => {
      const toolResult = {
        toolCallId: "call-123",
        toolName: "search_web",
        output: "Results__HM_TOOL_COST__:8000",
      };

      const result = formatToolResultMessage(toolResult);
      const toolResultContent = result.content.find((item) => item.type === "tool-result");
      expect(toolResultContent).toBeDefined();
      expect(toolResultContent && "costUsd" in toolResultContent ? toolResultContent.costUsd : undefined).toBe(8000);
      expect(toolResultContent && "result" in toolResultContent ? toolResultContent.result : undefined).toBe("Results");
    });

    it("should handle multiple markers and use the last one", () => {
      const toolResult = {
        toolCallId: "call-123",
        toolName: "search_web",
        output:
          "Result__HM_TOOL_COST__:1000__HM_TOOL_COST__:2000__HM_TOOL_COST__:3000",
      };

      const result = formatToolResultMessage(toolResult);
      const toolResultContent = result.content.find((item) => item.type === "tool-result");
      expect(toolResultContent).toBeDefined();
      expect(toolResultContent && "costUsd" in toolResultContent ? toolResultContent.costUsd : undefined).toBe(3000);
      expect(toolResultContent && "result" in toolResultContent ? toolResultContent.result : undefined).toBe("Result");
    });
  });

  describe("AI SDK LanguageModelV2ToolResultOutput format handling", () => {
    it("should handle type: 'text' format with cost marker", () => {
      const toolResult = {
        toolCallId: "call-123",
        toolName: "search_web",
        output: {
          type: "text",
          value: "Search results__HM_TOOL_COST__:8000",
        },
      };

      const result = formatToolResultMessage(toolResult);
      const toolResultContent = result.content.find((item) => item.type === "tool-result");
      expect(toolResultContent).toBeDefined();
      expect(toolResultContent && "costUsd" in toolResultContent ? toolResultContent.costUsd : undefined).toBe(8000);
      expect(toolResultContent && "result" in toolResultContent ? toolResultContent.result : undefined).toBe("Search results");
    });

    it("should handle type: 'json' format with cost marker", () => {
      const toolResult = {
        toolCallId: "call-123",
        toolName: "search_web",
        output: {
          type: "json",
          value: { results: ["item1", "item2"], cost: "__HM_TOOL_COST__:8000" },
        },
      };

      const result = formatToolResultMessage(toolResult);
      // JSON is stringified, so cost marker should be extracted from stringified JSON
      const toolResultContent = result.content.find((item) => item.type === "tool-result");
      expect(toolResultContent).toBeDefined();
      const resultString = toolResultContent && "result" in toolResultContent ? toolResultContent.result as string : "";
      expect(toolResultContent && "costUsd" in toolResultContent ? toolResultContent.costUsd : undefined).toBe(8000);
      expect(resultString).not.toContain("__HM_TOOL_COST__");
    });

    it("should handle type: 'text' format without cost marker", () => {
      const toolResult = {
        toolCallId: "call-123",
        toolName: "search_web",
        output: {
          type: "text",
          value: "Search results",
        },
      };

      const result = formatToolResultMessage(toolResult);
      const toolResultContent = result.content.find((item) => item.type === "tool-result");
      expect(toolResultContent).toBeDefined();
      expect(toolResultContent && "costUsd" in toolResultContent ? toolResultContent.costUsd : undefined).toBeUndefined();
      expect(toolResultContent && "result" in toolResultContent ? toolResultContent.result : undefined).toBe("Search results");
    });

    it("should handle other type formats by converting to string", () => {
      const toolResult = {
        toolCallId: "call-123",
        toolName: "search_web",
        output: {
          type: "unknown",
          value: "Result__HM_TOOL_COST__:8000",
        },
      };

      const result = formatToolResultMessage(toolResult);
      const toolResultContent = result.content.find((item) => item.type === "tool-result");
      expect(toolResultContent).toBeDefined();
      expect(toolResultContent && "costUsd" in toolResultContent ? toolResultContent.costUsd : undefined).toBe(8000);
      expect(toolResultContent && "result" in toolResultContent ? toolResultContent.result : undefined).toBe("Result");
    });

    it("should handle nested AI SDK format with cost extraction", () => {
      const toolResult = {
        toolCallId: "call-123",
        toolName: "search_web",
        output: {
          type: "text",
          value: "Results with __HM_TOOL_COST__:5000 and __HM_TOOL_COST__:8000",
        },
      };

      const result = formatToolResultMessage(toolResult);
      const toolResultContent = result.content.find((item) => item.type === "tool-result");
      expect(toolResultContent).toBeDefined();
      expect(toolResultContent && "costUsd" in toolResultContent ? toolResultContent.costUsd : undefined).toBe(8000); // Should use last occurrence
      const resultValue = toolResultContent && "result" in toolResultContent ? toolResultContent.result as string : "";
      expect(resultValue).not.toContain("__HM_TOOL_COST__");
    });
  });
});
