/**
 * Validates that the AI SDK expects tool results in a separate message with role "tool",
 * not inside the assistant message. This is the format our convertUIMessagesToModelMessages
 * must produce to avoid AI_MissingToolResultsError during continuation (e.g. agent-schedule-queue).
 *
 * Two levels of testing:
 * 1) Hand-crafted ModelMessage[] vs SDK: proves the expected format (assistant + tool message).
 * 2) Our converter output vs SDK: proves our convertUIMessagesToModelMessages output is always
 *    accepted by the SDK, so the production error won't happen again.
 *
 * @see https://sdk.vercel.ai/docs/09-troubleshooting/21-missing-tool-results-error
 * @see convert-ui-messages-to-model-messages.ts (pushToolResultsMessage)
 */


import type {
  AssistantModelMessage,
  ModelMessage,
  ToolModelMessage,
} from "ai";
import { MissingToolResultsError } from "ai";
import { describe, expect, it } from "vitest";

import type { UIMessage } from "../../../utils/messageTypes";
import { convertUIMessagesToModelMessages } from "../messageConversion";
import {
  formatToolCallMessage,
  formatToolResultMessage,
} from "../toolFormatting";

/**
 * Uses the AI SDK's prompt conversion (which runs the same validation as generateText).
 * The SDK only clears pending tool-call IDs when it sees a message with role "tool";
 * tool-result parts inside an assistant message do not clear them.
 */
async function runAISdkPromptValidation(messages: ModelMessage[]): Promise<void> {
  const { convertToLanguageModelPrompt, standardizePrompt } = await import(
    "ai/internal"
  );
  const prompt = await standardizePrompt({ messages });
  await convertToLanguageModelPrompt({
    prompt,
    supportedUrls: {},
    download: undefined,
  });
}

describe("AI SDK tool message format (convertToLanguageModelPrompt validation)", () => {
  const TOOL_CALL_ID = "tool_get_datetime_abc123";
  const toolCallPart = {
    type: "tool-call" as const,
    toolCallId: TOOL_CALL_ID,
    toolName: "get_datetime",
    input: {},
  };
  const toolResultPart = {
    type: "tool-result" as const,
    toolCallId: TOOL_CALL_ID,
    toolName: "get_datetime",
    output: { type: "text" as const, value: "2026-02-18T12:00:00Z" },
  };

  it("rejects when tool results are inside the assistant message (invalid format)", async () => {
    // Format that used to cause AI_MissingToolResultsError: one assistant message
    // with both tool-call and tool-result parts. The SDK validator only clears
    // tool-call IDs when it sees role === "tool", so this fails.
    const invalidMessages: ModelMessage[] = [
      { role: "user", content: "What time is it?" },
      {
        role: "assistant",
        content: [toolCallPart, toolResultPart],
      } as AssistantModelMessage,
    ];

    const err = await runAISdkPromptValidation(invalidMessages).catch((e) => e);
    expect(MissingToolResultsError.isInstance(err)).toBe(true);
    expect(err).toMatchObject({
      name: "AI_MissingToolResultsError",
      toolCallIds: [TOOL_CALL_ID],
    });
  });

  it("accepts when tool results are in a separate message with role 'tool' (expected format)", async () => {
    // Expected format: assistant message with only tool-call parts, then a
    // separate message with role "tool" and tool-result parts. This is what
    // convertUIMessagesToModelMessages produces via pushToolResultsMessage.
    const validMessages: ModelMessage[] = [
      { role: "user", content: "What time is it?" },
      {
        role: "assistant",
        content: [toolCallPart],
      } as AssistantModelMessage,
      {
        role: "tool",
        content: [toolResultPart],
      } as ToolModelMessage,
    ];

    await expect(
      runAISdkPromptValidation(validMessages)
    ).resolves.toBeUndefined();
  });

  it("accepts multiple tool calls when each has a matching result in the tool message", async () => {
    const call1 = {
      type: "tool-call" as const,
      toolCallId: "tool_posthog_list_events_1",
      toolName: "posthog_list_events",
      input: {},
    };
    const call2 = {
      type: "tool-call" as const,
      toolCallId: "tool_send_notification_2",
      toolName: "send_notification",
      input: {},
    };
    const result1 = {
      type: "tool-result" as const,
      toolCallId: "tool_posthog_list_events_1",
      toolName: "posthog_list_events",
      output: { type: "text" as const, value: "[]" },
    };
    const result2 = {
      type: "tool-result" as const,
      toolCallId: "tool_send_notification_2",
      toolName: "send_notification",
      output: { type: "text" as const, value: "✅" },
    };

    const validMessages: ModelMessage[] = [
      { role: "user", content: "Check PostHog and notify me" },
      {
        role: "assistant",
        content: [call1, call2],
      } as AssistantModelMessage,
      {
        role: "tool",
        content: [result1, result2],
      } as ToolModelMessage,
    ];

    await expect(
      runAISdkPromptValidation(validMessages)
    ).resolves.toBeUndefined();
  });

  it("our convertUIMessagesToModelMessages output is accepted by the SDK (continuation path)", async () => {
    // Same input shape as handleToolContinuation: user + one assistant UI message
    // containing all tool-call parts then all tool-result parts. Our converter
    // must output assistant (tool calls) + tool (results) so the SDK accepts it.
    const toolCalls = [
      {
        toolCallId: "tool_posthog_list_events_1",
        toolName: "posthog_list_events",
        args: {},
      },
      {
        toolCallId: "tool_send_notification_2",
        toolName: "send_notification",
        args: {},
      },
    ];
    const toolResults = [
      {
        toolCallId: "tool_posthog_list_events_1",
        toolName: "posthog_list_events",
        result: "[]",
      },
      {
        toolCallId: "tool_send_notification_2",
        toolName: "send_notification",
        result: "✅",
      },
    ];
    const toolRoundContent = [
      ...toolCalls.map((tc) => formatToolCallMessage(tc)).flatMap((m) => m.content),
      ...toolResults
        .map((tr) => formatToolResultMessage(tr, { provider: "openrouter", modelName: "openai/gpt-4o" }))
        .flatMap((m) => m.content),
    ];
    const allMessagesForContinuation: UIMessage[] = [
      { role: "user", content: "Check PostHog and notify me" },
      { role: "assistant", content: toolRoundContent },
    ];

    const modelMessages = convertUIMessagesToModelMessages(
      allMessagesForContinuation
    );

    const assistantMsg = modelMessages.find((m) => m.role === "assistant");
    const toolMsg = modelMessages.find((m) => m.role === "tool");
    expect(assistantMsg).toBeDefined();
    expect(toolMsg).toBeDefined();
    expect(Array.isArray(assistantMsg?.content)).toBe(true);
    const assistantParts = (assistantMsg?.content ?? []) as Array<{ type: string }>;
    const toolParts = (toolMsg as { content: unknown[] })?.content ?? [];
    expect(assistantParts.filter((p) => p.type === "tool-call")).toHaveLength(2);
    expect(assistantParts.filter((p) => p.type === "tool-result")).toHaveLength(0);
    expect(toolParts).toHaveLength(2);

    await expect(
      runAISdkPromptValidation(modelMessages)
    ).resolves.toBeUndefined();
  });

  it("our converter output for UI role 'tool' messages is accepted by the SDK (buildToolMessage path)", async () => {
    // When conversation history contains a message with role "tool", we output
    // a model message with role "tool" (not "assistant"). SDK must accept it.
    const messagesWithToolRole: UIMessage[] = [
      { role: "user", content: "Run get_datetime" },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tool_get_datetime_xyz",
            toolName: "get_datetime",
            result: "2026-02-18T12:00:00Z",
          },
        ],
      },
    ];

    const modelMessages = convertUIMessagesToModelMessages(messagesWithToolRole);
    const toolMsg = modelMessages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect((toolMsg as { content: unknown[] }).content).toHaveLength(1);

    await expect(
      runAISdkPromptValidation(modelMessages)
    ).resolves.toBeUndefined();
  });
});
