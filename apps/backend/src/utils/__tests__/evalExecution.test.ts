import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  formatConversationForEval,
  parseEvalResponse,
} from "../evalExecution";
import type { UIMessage } from "../messageTypes";

describe("evalExecution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("parseEvalResponse", () => {
    it("should parse valid JSON response without markdown", () => {
      const validResponse = JSON.stringify({
        summary: "Agent completed the task successfully",
        score_goal_completion: 85,
        score_tool_efficiency: 90,
        score_faithfulness: 95,
        critical_failure_detected: false,
        reasoning_trace: "The agent followed all steps correctly",
      });

      const result = parseEvalResponse(validResponse);

      expect(result.summary).toBe("Agent completed the task successfully");
      expect(result.score_goal_completion).toBe(85);
      expect(result.score_tool_efficiency).toBe(90);
      expect(result.score_faithfulness).toBe(95);
      expect(result.critical_failure_detected).toBe(false);
      expect(result.reasoning_trace).toBe("The agent followed all steps correctly");
    });

    it("should handle JSON wrapped in markdown code blocks with json tag", () => {
      const jsonResponse = {
        summary: "Test summary",
        score_goal_completion: 75,
        score_tool_efficiency: 80,
        score_faithfulness: 85,
        critical_failure_detected: true,
        reasoning_trace: "Test reasoning",
      };

      const withMarkdown = `\`\`\`json\n${JSON.stringify(jsonResponse)}\n\`\`\``;
      const result = parseEvalResponse(withMarkdown);

      expect(result.summary).toBe("Test summary");
      expect(result.score_goal_completion).toBe(75);
      expect(result.score_tool_efficiency).toBe(80);
      expect(result.score_faithfulness).toBe(85);
      expect(result.critical_failure_detected).toBe(true);
    });

    it("should handle JSON wrapped in markdown code blocks without json tag", () => {
      const jsonResponse = {
        summary: "Test summary",
        score_goal_completion: 50,
        score_tool_efficiency: 60,
        score_faithfulness: 70,
        critical_failure_detected: false,
        reasoning_trace: "Test",
      };

      const withMarkdown = `\`\`\`\n${JSON.stringify(jsonResponse)}\n\`\`\``;
      const result = parseEvalResponse(withMarkdown);

      expect(result.summary).toBe("Test summary");
      expect(result.score_goal_completion).toBe(50);
    });

    it("should parse JSON embedded in surrounding text", () => {
      const jsonResponse = {
        summary: "Embedded JSON",
        score_goal_completion: 88,
        score_tool_efficiency: 92,
        score_faithfulness: 90,
        critical_failure_detected: false,
        reasoning_trace: "Embedded reasoning",
      };

      const withText = `Here is the evaluation:\n${JSON.stringify(
        jsonResponse
      )}\nThanks!`;
      const result = parseEvalResponse(withText);

      expect(result.summary).toBe("Embedded JSON");
      expect(result.score_tool_efficiency).toBe(92);
    });

    it("should parse fenced JSON with leading and trailing text", () => {
      const jsonResponse = {
        summary: "Fenced JSON",
        score_goal_completion: 70,
        score_tool_efficiency: 75,
        score_faithfulness: 80,
        critical_failure_detected: false,
        reasoning_trace: "Fenced reasoning",
      };

      const withText = `Preamble\n\`\`\`json\n${JSON.stringify(
        jsonResponse
      )}\n\`\`\`\nPostscript`;
      const result = parseEvalResponse(withText);

      expect(result.summary).toBe("Fenced JSON");
      expect(result.score_faithfulness).toBe(80);
    });

    it("should throw error for invalid response format", () => {
      const invalidResponse = JSON.stringify({
        summary: "Test",
        // Missing required fields
      });

      expect(() => parseEvalResponse(invalidResponse)).toThrow(
        "Invalid evaluation response format"
      );
    });

    it("should throw error for scores out of range", () => {
      const invalidLow = JSON.stringify({
        summary: "Test",
        score_goal_completion: -1,
        score_tool_efficiency: 50,
        score_faithfulness: 50,
        critical_failure_detected: false,
        reasoning_trace: "Test",
      });

      const invalidHigh = JSON.stringify({
        summary: "Test",
        score_goal_completion: 101,
        score_tool_efficiency: 50,
        score_faithfulness: 50,
        critical_failure_detected: false,
        reasoning_trace: "Test",
      });

      expect(() => parseEvalResponse(invalidLow)).toThrow(
        "Scores must be between 0 and 100"
      );
      expect(() => parseEvalResponse(invalidHigh)).toThrow(
        "Scores must be between 0 and 100"
      );
    });

    it("should round scores to integers", () => {
      const response = JSON.stringify({
        summary: "Test",
        score_goal_completion: 85.7,
        score_tool_efficiency: 90.3,
        score_faithfulness: 95.9,
        critical_failure_detected: false,
        reasoning_trace: "Test",
      });

      const result = parseEvalResponse(response);

      expect(result.score_goal_completion).toBe(86);
      expect(result.score_tool_efficiency).toBe(90);
      expect(result.score_faithfulness).toBe(96);
    });

    it("should handle edge case scores (0 and 100)", () => {
      const response = JSON.stringify({
        summary: "Test",
        score_goal_completion: 0,
        score_tool_efficiency: 100,
        score_faithfulness: 50,
        critical_failure_detected: false,
        reasoning_trace: "Test",
      });

      const result = parseEvalResponse(response);

      expect(result.score_goal_completion).toBe(0);
      expect(result.score_tool_efficiency).toBe(100);
      expect(result.score_faithfulness).toBe(50);
    });
  });

  describe("formatConversationForEval", () => {
    it("should extract input prompt from first user message with string content", () => {
      const messages: UIMessage[] = [
        {
          role: "user",
          content: "What is the weather today?",
        },
        {
          role: "assistant",
          content: "I'll check the weather for you.",
        },
      ];

      const result = formatConversationForEval(messages);

      expect(result.input_prompt).toBe("What is the weather today?");
      expect(result.final_response).toBe("I'll check the weather for you.");
    });

    it("should extract input prompt from first user message with array content", () => {
      const messages: UIMessage[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "Hello" },
            { type: "text", text: "World" },
          ],
        },
      ];

      const result = formatConversationForEval(messages);

      expect(result.input_prompt).toBe("Hello World");
    });

    it("should extract final response from last assistant message", () => {
      const messages: UIMessage[] = [
        {
          role: "user",
          content: "What is 2+2?",
        },
        {
          role: "assistant",
          content: "The answer is 4.",
        },
      ];

      const result = formatConversationForEval(messages);

      expect(result.final_response).toBe("The answer is 4.");
    });

    it("should extract tool calls and results as steps", () => {
      const messages: UIMessage[] = [
        {
          role: "user",
          content: "What is the weather?",
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-123",
              toolName: "search",
              args: { query: "weather" },
            },
            {
              type: "tool-result",
              toolCallId: "call-123",
              toolName: "search",
              result: { temperature: "72°F" },
            },
            {
              type: "text",
              text: "The weather is 72°F",
            },
          ],
          generationStartedAt: "2024-01-01T00:00:00Z",
          generationEndedAt: "2024-01-01T00:00:05Z",
        },
      ];

      const result = formatConversationForEval(messages);

      expect(result.steps.length).toBe(2);
      expect(result.steps[0].type).toBe("tool_call");
      expect(result.steps[0].content).toMatchObject({
        toolCallId: "call-123",
        toolName: "search",
        args: { query: "weather" },
      });
      expect(result.steps[1].type).toBe("tool_result");
      expect(result.steps[1].content).toMatchObject({
        toolCallId: "call-123",
        toolName: "search",
        result: { temperature: "72°F" },
      });
      expect(result.final_response).toBe("The weather is 72°F");
    });

    it("should extract reasoning as thought steps", () => {
      const messages: UIMessage[] = [
        {
          role: "assistant",
          content: [
            {
              type: "reasoning",
              text: "I need to search for weather information",
            },
            {
              type: "text",
              text: "Let me check the weather for you.",
            },
          ],
          generationStartedAt: "2024-01-01T00:00:00Z",
        },
      ];

      const result = formatConversationForEval(messages);

      expect(result.steps.length).toBe(1);
      expect(result.steps[0].type).toBe("thought");
      expect(result.steps[0].content).toBe("I need to search for weather information");
    });

    it("should handle empty messages array", () => {
      const messages: UIMessage[] = [];

      const result = formatConversationForEval(messages);

      expect(result.input_prompt).toBe("");
      expect(result.final_response).toBe("");
      expect(result.steps.length).toBe(0);
    });

    it("should handle messages with only user content", () => {
      const messages: UIMessage[] = [
        {
          role: "user",
          content: "Hello",
        },
      ];

      const result = formatConversationForEval(messages);

      expect(result.input_prompt).toBe("Hello");
      expect(result.final_response).toBe("");
    });

    it("should number steps sequentially", () => {
      const messages: UIMessage[] = [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "search",
              args: {},
            },
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "search",
              result: {},
            },
            {
              type: "tool-call",
              toolCallId: "call-2",
              toolName: "fetch",
              args: {},
            },
          ],
          generationStartedAt: "2024-01-01T00:00:00Z",
        },
      ];

      const result = formatConversationForEval(messages);

      expect(result.steps[0].step_id).toBe("step_0");
      expect(result.steps[1].step_id).toBe("step_1");
      expect(result.steps[2].step_id).toBe("step_2");
    });
  });
});
