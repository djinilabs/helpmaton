import { describe, expect, it } from "vitest";

import {
  formatTextChunk,
  formatToolCallChunk,
  formatAssistantResponse,
} from "../responseFormatting";

describe("responseFormatting", () => {
  describe("formatTextChunk", () => {
    it("should format simple text correctly", () => {
      const result = formatTextChunk("Hello, world!");
      expect(result).toBe('0:"Hello, world!"\n');
    });

    it("should format text with special characters", () => {
      const result = formatTextChunk('Text with "quotes" and\nnewlines');
      expect(result).toBe('0:"Text with \\"quotes\\" and\\nnewlines"\n');
    });

    it("should format empty string", () => {
      const result = formatTextChunk("");
      expect(result).toBe('0:""\n');
    });

    it("should format text with unicode characters", () => {
      const result = formatTextChunk("Hello 🌍");
      expect(result).toBe('0:"Hello 🌍"\n');
    });
  });

  describe("formatToolCallChunk", () => {
    it("should format tool call correctly", () => {
      const toolCall = {
        toolCallId: "call_123",
        toolName: "search",
        args: { query: "test" },
      };
      const result = formatToolCallChunk(toolCall);
      expect(result).toContain("1:");
      expect(result).toContain('"type":"tool-call"');
      expect(result).toContain('"toolCallId":"call_123"');
      expect(result).toContain('"toolName":"search"');
      expect(result).toContain('"args":{"query":"test"}');
      expect(result).toMatch(/\n$/);
    });

    it("should format tool call with complex args", () => {
      const toolCall = {
        toolCallId: "call_456",
        toolName: "execute",
        args: { action: "create", data: { name: "test", count: 42 } },
      };
      const result = formatToolCallChunk(toolCall);
      expect(result).toContain("1:");
      expect(result).toContain('"toolCallId":"call_456"');
      expect(result).toContain('"toolName":"execute"');
      expect(result).toContain('"action":"create"');
      expect(result).toMatch(/\n$/);
    });

    it("should format tool call with empty args", () => {
      const toolCall = {
        toolCallId: "call_789",
        toolName: "noop",
        args: {},
      };
      const result = formatToolCallChunk(toolCall);
      expect(result).toContain("1:");
      expect(result).toContain('"toolCallId":"call_789"');
      expect(result).toContain('"toolName":"noop"');
      expect(result).toContain('"args":{}');
      expect(result).toMatch(/\n$/);
    });
  });

  describe("formatAssistantResponse", () => {
    it("should format text-only response", () => {
      const result = {
        text: "Hello, world!",
        toolCalls: [],
      };
      const clientToolNames = new Set<string>();
      const responseText = "Hello, world!";

      const formatted = formatAssistantResponse(
        result,
        clientToolNames,
        responseText
      );

      expect(formatted).toBe('0:"Hello, world!"\n');
    });

    it("should format response with client-side tool calls", () => {
      const result = {
        text: "I'll search for that.",
        toolCalls: [
          {
            toolCallId: "call_1",
            toolName: "search",
            args: { query: "test" },
          },
        ],
      };
      const clientToolNames = new Set(["search"]);
      const responseText = "I'll search for that.";

      const formatted = formatAssistantResponse(
        result,
        clientToolNames,
        responseText
      );

      // Tool calls should come before text
      expect(formatted).toContain("1:");
      expect(formatted).toContain('"toolName":"search"');
      expect(formatted).toContain("0:");
      expect(formatted).toContain('"I\'ll search for that."');

      // Check order: tool call first, then text
      const toolCallIndex = formatted.indexOf("1:");
      const textIndex = formatted.indexOf("0:");
      expect(toolCallIndex).toBeLessThan(textIndex);
    });

    it("should not include server-side tool calls in response", () => {
      const result = {
        text: "Processing...",
        toolCalls: [
          {
            toolCallId: "call_1",
            toolName: "server_tool",
            args: { action: "process" },
          },
        ],
      };
      const clientToolNames = new Set<string>(); // Empty - no client tools
      const responseText = "Processing...";

      const formatted = formatAssistantResponse(
        result,
        clientToolNames,
        responseText
      );

      // Should only have text, no tool calls
      expect(formatted).toBe('0:"Processing..."\n');
      expect(formatted).not.toContain("1:");
    });

    it("should format response with multiple client-side tool calls", () => {
      const result = {
        text: "I'll do both actions.",
        toolCalls: [
          {
            toolCallId: "call_1",
            toolName: "action1",
            args: { param: "value1" },
          },
          {
            toolCallId: "call_2",
            toolName: "action2",
            args: { param: "value2" },
          },
        ],
      };
      const clientToolNames = new Set(["action1", "action2"]);
      const responseText = "I'll do both actions.";

      const formatted = formatAssistantResponse(
        result,
        clientToolNames,
        responseText
      );

      // Should have both tool calls
      expect(formatted).toContain('"toolName":"action1"');
      expect(formatted).toContain('"toolName":"action2"');
      expect(formatted).toContain("0:");
      expect(formatted).toContain('"I\'ll do both actions."');
    });

    it("should format response with mixed client and server-side tools", () => {
      const result = {
        text: "Mixed tools response.",
        toolCalls: [
          {
            toolCallId: "call_1",
            toolName: "client_tool",
            args: { query: "test" },
          },
          {
            toolCallId: "call_2",
            toolName: "server_tool",
            args: { action: "process" },
          },
        ],
      };
      const clientToolNames = new Set(["client_tool"]);
      const responseText = "Mixed tools response.";

      const formatted = formatAssistantResponse(
        result,
        clientToolNames,
        responseText
      );

      // Should only include client tool, not server tool
      expect(formatted).toContain('"toolName":"client_tool"');
      expect(formatted).not.toContain('"toolName":"server_tool"');
      expect(formatted).toContain("0:");
    });

    it("should handle empty response text", () => {
      const result = {
        text: "",
        toolCalls: [
          {
            toolCallId: "call_1",
            toolName: "search",
            args: { query: "test" },
          },
        ],
      };
      const clientToolNames = new Set(["search"]);
      const responseText = "";

      const formatted = formatAssistantResponse(
        result,
        clientToolNames,
        responseText
      );

      // Should only have tool call, no text
      expect(formatted).toContain("1:");
      expect(formatted).not.toContain("0:");
    });

    it("should handle tool calls with input instead of args", () => {
      const result = {
        text: "Response with input field.",
        toolCalls: [
          {
            toolCallId: "call_1",
            toolName: "search",
            input: { query: "test" }, // Using 'input' instead of 'args'
          },
        ],
      };
      const clientToolNames = new Set(["search"]);
      const responseText = "Response with input field.";

      const formatted = formatAssistantResponse(
        result,
        clientToolNames,
        responseText
      );

      expect(formatted).toContain('"toolName":"search"');
      expect(formatted).toContain('"args":{"query":"test"}');
    });

    it("should handle missing toolCallId gracefully", () => {
      const result = {
        text: "Response",
        toolCalls: [
          {
            toolName: "search",
            args: { query: "test" },
          },
        ],
      };
      const clientToolNames = new Set(["search"]);
      const responseText = "Response";

      const formatted = formatAssistantResponse(
        result,
        clientToolNames,
        responseText
      );

      expect(formatted).toContain('"toolCallId":""');
      expect(formatted).toContain('"toolName":"search"');
    });

    it("should handle empty response", () => {
      const result = {
        text: "",
        toolCalls: [],
      };
      const clientToolNames = new Set<string>();
      const responseText = "";

      const formatted = formatAssistantResponse(
        result,
        clientToolNames,
        responseText
      );

      expect(formatted).toBe("");
    });
  });
});

