import { generateText } from "ai";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { getWorkspaceApiKey } from "../../http/utils/agentUtils";
import {
  adjustCreditsAfterLLMCall,
  cleanupReservationOnError,
  cleanupReservationWithoutTokenUsage,
} from "../../http/utils/generationCreditManagement";
import { extractTokenUsageAndCosts } from "../../http/utils/generationTokenExtraction";
import { createModel } from "../../http/utils/modelFactory";
import {
  cleanupRequestTimeout,
  createRequestTimeout,
} from "../../http/utils/requestTimeout";
import type { CreditReservation } from "../creditManagement";
import { validateCreditsAndLimitsAndReserve } from "../creditValidation";
import {
  buildEvalFailureRecord,
  buildEvalParseRetryPrompt,
  executeEvaluation,
  formatConversationForEval,
  parseEvalResponse,
} from "../evalExecution";
import type { UIMessage } from "../messageTypes";
import type { AugmentedContext } from "../workspaceCreditContext";

vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

vi.mock("../../http/utils/modelFactory", () => ({
  createModel: vi.fn(),
}));

vi.mock("../creditValidation", () => ({
  validateCreditsAndLimitsAndReserve: vi.fn(),
}));

vi.mock("../../http/utils/generationTokenExtraction", () => ({
  extractTokenUsageAndCosts: vi.fn(),
}));

vi.mock("../../http/utils/generationCreditManagement", () => ({
  adjustCreditsAfterLLMCall: vi.fn(),
  cleanupReservationOnError: vi.fn(),
  cleanupReservationWithoutTokenUsage: vi.fn(),
}));

vi.mock("../../http/utils/requestTimeout", () => ({
  createRequestTimeout: vi.fn(),
  cleanupRequestTimeout: vi.fn(),
}));

vi.mock("../../http/utils/agentUtils", () => ({
  getWorkspaceApiKey: vi.fn(),
}));

describe("evalExecution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const controller = new AbortController();
    vi.mocked(createRequestTimeout).mockReturnValue({
      controller,
      signal: controller.signal,
      timeoutId: setTimeout(() => {}, 0),
    });
    vi.mocked(cleanupRequestTimeout).mockReturnValue(undefined);
    vi.mocked(createModel).mockResolvedValue(
      {} as Awaited<ReturnType<typeof createModel>>
    );
    vi.mocked(validateCreditsAndLimitsAndReserve).mockResolvedValue({
      reservationId: "res-1",
      reservedAmount: 0,
      workspace: {} as CreditReservation["workspace"],
    });
    vi.mocked(extractTokenUsageAndCosts).mockReturnValue({
      tokenUsage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      },
      openrouterGenerationId: "gen-1",
      openrouterGenerationIds: ["gen-1"],
      provisionalCostUsd: 123,
    });
    vi.mocked(adjustCreditsAfterLLMCall).mockResolvedValue(undefined);
    vi.mocked(cleanupReservationOnError).mockResolvedValue(undefined);
    vi.mocked(cleanupReservationWithoutTokenUsage).mockResolvedValue(undefined);
    vi.mocked(getWorkspaceApiKey).mockResolvedValue(null);
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

  describe("buildEvalParseRetryPrompt", () => {
    it("should include the parse error and strict JSON instruction", () => {
      const prompt = buildEvalParseRetryPrompt("Unexpected token");

      expect(prompt).toContain("Error: Unexpected token");
      expect(prompt).toContain("JSON object");
      expect(prompt).toContain("Do not include any extra text");
    });
  });

  describe("buildEvalFailureRecord", () => {
    it("should build a failed evaluation record with error details", () => {
      const record = buildEvalFailureRecord({
        pk: "agent-eval-results/ws/agent/conv/judge",
        sk: "result",
        workspaceId: "ws",
        agentId: "agent",
        conversationId: "conv",
        judgeId: "judge",
        evaluatedAt: "2025-01-01T00:00:00.000Z",
        costUsd: 123,
        usesByok: false,
        tokenUsage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
        errorMessage: "Failed to parse evaluation response",
        errorDetails: "Invalid JSON",
      });

      expect(record).toMatchObject({
        status: "failed",
        summary: "Evaluation failed",
        errorMessage: "Failed to parse evaluation response",
        errorDetails: "Invalid JSON",
        scoreGoalCompletion: null,
        scoreToolEfficiency: null,
        scoreFaithfulness: null,
      });
      expect(record.createdAt).toBe("2025-01-01T00:00:00.000Z");
      expect(record.evaluatedAt).toBe("2025-01-01T00:00:00.000Z");
    });
  });

  describe("executeEvaluation", () => {
    const workspaceId = "ws-1";
    const agentId = "agent-1";
    const conversationId = "conv-1";
    const judgeId = "judge-1";
    const baseMessages: UIMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ];

    const buildDb = () => ({
      "agent-eval-judge": {
        get: vi.fn().mockResolvedValue({
          judgeId,
          enabled: true,
          provider: "openrouter",
          modelName: "test-model",
          evalPrompt: "Evaluate {agent_goal}",
          name: "Judge",
        }),
      },
      "agent-conversations": {
        get: vi.fn().mockResolvedValue({
          workspaceId,
          agentId,
          conversationId,
          messages: baseMessages,
        }),
      },
      agent: {
        get: vi.fn().mockResolvedValue({
          systemPrompt: "Be helpful",
          workspaceId,
        }),
      },
      "agent-eval-result": {
        create: vi.fn().mockResolvedValue(undefined),
      },
    });

    it("retries parsing by including the prior assistant response", async () => {
      const capturedMessages: Array<
        Array<{ role: string; content: unknown }>
      > = [];
      const generateTextMock = vi.mocked(generateText);
      generateTextMock.mockImplementation(async ({ messages }) => {
        capturedMessages.push(JSON.parse(JSON.stringify(messages)));
        if (capturedMessages.length < 3) {
          return { text: "not json" } as Awaited<ReturnType<typeof generateText>>;
        }
        return {
          text: JSON.stringify({
            summary: "OK",
            score_goal_completion: 80,
            score_tool_efficiency: 70,
            score_faithfulness: 90,
            critical_failure_detected: false,
            reasoning_trace: "Looks good",
          }),
        } as Awaited<ReturnType<typeof generateText>>;
      });

      await executeEvaluation(
        buildDb(),
        workspaceId,
        agentId,
        conversationId,
        judgeId,
        {
          addWorkspaceCreditTransaction: vi.fn(),
          awsRequestId: "req-1",
        } as unknown as AugmentedContext
      );

      expect(capturedMessages).toHaveLength(3);
      const secondAttempt = capturedMessages[1];
      expect(
        secondAttempt.some(
          (message) =>
            message.role === "assistant" && message.content === "not json"
        )
      ).toBe(true);
      expect(
        secondAttempt.some(
          (message) =>
            message.role === "user" &&
            typeof message.content === "string" &&
            message.content.includes(
              "previous response could not be parsed as valid JSON"
            )
        )
      ).toBe(true);
    });

    it("stores a failed record after exhausting retries", async () => {
      const generateTextMock = vi.mocked(generateText);
      generateTextMock.mockResolvedValue(
        { text: "not json" } as Awaited<ReturnType<typeof generateText>>
      );
      const db = buildDb();

      await executeEvaluation(
        db,
        workspaceId,
        agentId,
        conversationId,
        judgeId,
        {
          addWorkspaceCreditTransaction: vi.fn(),
          awsRequestId: "req-2",
        } as unknown as AugmentedContext
      );

      expect(db["agent-eval-result"].create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          errorMessage: "Failed to parse evaluation response",
          scoreGoalCompletion: null,
          scoreToolEfficiency: null,
          scoreFaithfulness: null,
        })
      );
    });
  });
});
