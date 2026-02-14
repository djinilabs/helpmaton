import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHandleToolContinuation = vi.fn();
const mockCreateModel = vi.fn();
const mockExtractTokenUsage = vi.fn();
const mockBuildSystemPromptWithSkills = vi.fn();

vi.mock("../../../utils/conversationLogger", () => ({
  extractTokenUsage: (...args: unknown[]) => mockExtractTokenUsage(...args),
}));

vi.mock("../continuation", () => ({
  handleToolContinuation: (...args: unknown[]) =>
    mockHandleToolContinuation(...args),
}));

vi.mock("../modelFactory", () => ({
  createModel: (...args: unknown[]) => mockCreateModel(...args),
}));

vi.mock("../../../utils/agentSkills", () => ({
  buildSystemPromptWithSkills: (...args: unknown[]) =>
    mockBuildSystemPromptWithSkills(...args),
}));

import type { WorkspaceAndAgent } from "../agentUtils";
import { processNonStreamingResponse } from "../streaming";

describe("processNonStreamingResponse", () => {
  const mockAgent = {
    pk: "AGENT#test",
    systemPrompt: "You are helpful",
    modelName: "openai/gpt-4o",
  } as WorkspaceAndAgent["agent"];
  const mockModel = {};
  const mockMessages: unknown[] = [{ role: "user", content: "Send a notification" }];

  beforeEach(() => {
    vi.clearAllMocks();
    mockExtractTokenUsage.mockReturnValue({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
    mockCreateModel.mockResolvedValue(mockModel);
  });

  it("returns text directly when no tool continuation needed", async () => {
    const result = {
      text: "Here is your response",
      toolCalls: [],
      toolResults: [],
    };
    const output = await processNonStreamingResponse(
      result,
      mockAgent,
      mockModel as never,
      mockMessages
    );
    expect(output.text).toBe("Here is your response");
    expect(mockHandleToolContinuation).not.toHaveBeenCalled();
  });

  it("calls handleToolContinuation when tools executed but no text", async () => {
    const result = {
      text: "",
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
    mockHandleToolContinuation.mockResolvedValue({
      text: "Notification sent successfully.",
      tokenUsage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
    });

    const output = await processNonStreamingResponse(
      result,
      mockAgent,
      mockModel as never,
      mockMessages
    );

    expect(mockHandleToolContinuation).toHaveBeenCalledWith(
      mockAgent,
      mockModel,
      mockMessages,
      expect.arrayContaining([
        expect.objectContaining({
          toolCallId: "call_1",
          toolName: "send_notification",
        }),
      ]),
      expect.arrayContaining([
        expect.objectContaining({
          toolCallId: "call_1",
          result: "✅ Sent",
        }),
      ]),
      undefined,
      undefined
    );
    expect(output.text).toBe("Notification sent successfully.");
  });

  it("passes corrected tool results when tool call has no matching result (production bug fix)", async () => {
    const result = {
      text: "",
      toolCalls: [
        {
          toolCallId: "tool_send_notification_AbDbv7CS5uL4XrRdBNGp",
          toolName: "send_notification",
          args: { content: "hello" },
        },
      ],
      toolResults: [],
    };
    mockHandleToolContinuation.mockResolvedValue({
      text: "I attempted to send the notification.",
      tokenUsage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
    });

    const output = await processNonStreamingResponse(
      result,
      mockAgent,
      mockModel as never,
      mockMessages
    );

    expect(mockHandleToolContinuation).toHaveBeenCalled();
    const [, , , toolCalls, toolResults] = mockHandleToolContinuation.mock.calls[0];
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].toolCallId).toBe(
      "tool_send_notification_AbDbv7CS5uL4XrRdBNGp"
    );
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].toolCallId).toBe(
      "tool_send_notification_AbDbv7CS5uL4XrRdBNGp"
    );
    expect(toolResults[0].result).toContain("Tool execution did not complete");
    expect(toolResults[0].result).toContain("send_notification");
    expect(output.text).toBe("I attempted to send the notification.");
  });

  it("uses step-based extraction when steps available", async () => {
    const result = {
      text: "",
      steps: [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "step_call_1",
              toolName: "send_notification",
              input: { content: "from steps" },
            },
            {
              type: "tool-result",
              toolCallId: "step_call_1",
              toolName: "send_notification",
              output: { type: "text", value: "✅ From steps" },
            },
          ],
        },
      ],
      toolCalls: [{ toolCallId: "top_call", toolName: "x", args: {} }],
      toolResults: [{ toolCallId: "top_call", toolName: "x", result: "top" }],
    };
    mockHandleToolContinuation.mockResolvedValue({
      text: "Done.",
      tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });

    await processNonStreamingResponse(
      result,
      mockAgent,
      mockModel as never,
      mockMessages
    );

    const [, , , toolCalls] = mockHandleToolContinuation.mock.calls[0];
    expect(toolCalls[0].toolCallId).toBe("step_call_1");
    expect(toolCalls[0].args).toEqual({ content: "from steps" });
  });

  it("returns empty string when continuation returns null", async () => {
    const result = {
      text: "",
      toolCalls: [
        { toolCallId: "call_1", toolName: "send_notification", args: {} },
      ],
      toolResults: [
        { toolCallId: "call_1", toolName: "send_notification", result: "✅" },
      ],
    };
    mockHandleToolContinuation.mockResolvedValue(null);

    const output = await processNonStreamingResponse(
      result,
      mockAgent,
      mockModel as never,
      mockMessages
    );

    expect(output.text).toBe("");
  });
});
