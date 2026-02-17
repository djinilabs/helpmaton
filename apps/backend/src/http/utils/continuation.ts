import type { ModelMessage } from "ai";
import { generateText } from "ai";

import { buildSystemPromptWithSkills } from "../../utils/agentSkills";
import {
  extractTokenUsage,
  type GenerateTextResultWithTotalUsage,
  type TokenUsage,
} from "../../utils/conversationLogger";
import type { UIMessage } from "../../utils/messageTypes";

import {
  type WorkspaceAndAgent,
  buildGenerateTextOptions,
  MODEL_NAME,
} from "./agentUtils";
import { convertUIMessagesToModelMessages } from "./messageConversion";
import {
  filterGenerateTextOptionsForCapabilities,
  resolveModelCapabilities,
  resolveToolsForCapabilities,
} from "./modelCapabilities";
import { createModel, getDefaultModel } from "./modelFactory";
import {
  formatToolCallMessage,
  formatToolResultMessage,
} from "./toolFormatting";

export interface ContinuationResult {
  text: string | null;
  tokenUsage: TokenUsage | undefined;
}

/**
 * Builds continuation instructions based on tool result types
 */
export function buildContinuationInstructions(
  toolResults: Array<{ toolName?: string }>
): string {
  const hasNotificationResult = toolResults.some(
    (tr) => tr?.toolName === "send_notification"
  );
  const hasSearchResult = toolResults.some(
    (tr) => tr?.toolName === "search_documents"
  );

  let instructions = "";
  if (hasNotificationResult) {
    instructions +=
      "IMPORTANT: When you receive a notification tool result indicating success (✅), the notification has already been sent successfully. Simply acknowledge this to the user - do NOT ask for channel IDs or try to send the notification again. The notification is complete.\n\n";
  }
  if (hasSearchResult) {
    instructions +=
      "IMPORTANT: When you receive tool results from document searches, you must provide a helpful summary and interpretation. DO NOT simply repeat or copy the raw tool results verbatim. Instead, synthesize the information, extract key points, and provide insights or answers based on what was found. Be concise and focus on what the user asked about.\n\n";
  }

  return instructions;
}

function isValidMessageForContinuation(
  msg: unknown
): msg is UIMessage {
  if (
    !(
      msg != null &&
      typeof msg === "object" &&
      "role" in msg &&
      typeof msg.role === "string" &&
      (msg.role === "user" ||
        msg.role === "assistant" ||
        msg.role === "system" ||
        msg.role === "tool") &&
      "content" in msg
    )
  ) {
    return false;
  }
  if (msg.role === "system") return false;
  if (msg.role === "tool") return false;
  return true;
}

function extractTextFromToolResultContent(
  content: Array<{ type?: string; result?: unknown; output?: unknown }>
): string | undefined {
  for (const item of content) {
    if (item?.type !== "tool-result") continue;
    const result =
      item.result !== undefined
        ? item.result
        : item.output !== undefined
          ? item.output
          : undefined;
    if (result === undefined) continue;
    if (typeof result === "string") return result;
    if (
      result &&
      typeof result === "object" &&
      "type" in result &&
      "value" in result
    ) {
      const r = result as { type: string; value: unknown };
      if (r.type === "text" && typeof r.value === "string") return r.value;
      if (r.type === "json") return JSON.stringify(r.value);
    }
    return result ? String(result) : undefined;
  }
  return undefined;
}

/**
 * Handles continuation when tools are called but no text is generated
 * Returns the continuation text and token usage, or null if no text was generated
 */
export async function handleToolContinuation(
  agent: WorkspaceAndAgent["agent"],
  model: Awaited<ReturnType<typeof createModel>>,
  messages: unknown[],
  toolCalls: unknown[],
  toolResults: unknown[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tools have varying types
  tools?: Record<string, any>,
  abortSignal?: AbortSignal
): Promise<ContinuationResult | null> {
  const continuationInstructions = buildContinuationInstructions(
    toolResults.filter(
      (tr): tr is { toolName?: string } =>
        tr != null && typeof tr === "object" && "toolName" in tr
    )
  );

  // Format tool calls and results as UI messages
  const toolCallUIMessages = toolCalls
    .filter((tc): tc is NonNullable<typeof tc> => tc != null)
    .map(formatToolCallMessage);

  const resolvedModelName =
    typeof agent.modelName === "string" && agent.modelName.length > 0
      ? agent.modelName
      : getDefaultModel();
  const toolResultUIMessages = toolResults
    .filter((tr): tr is NonNullable<typeof tr> => tr != null)
    .map((tr) =>
      formatToolResultMessage(tr, {
        provider: "openrouter",
        modelName: resolvedModelName,
      })
    );

  // Merge all tool calls and tool results into a single assistant message.
  // convertUIMessagesToModelMessages uses appendToolResultsToAssistantWithToolCalls,
  // which appends results to the last assistant message with tool-call content.
  // If we passed multiple assistant messages (one per tool call/result), only the
  // first would get results; merging into one ensures every tool call has a result.
  const toolRoundContent = [
    ...toolCallUIMessages.flatMap((m) => m.content),
    ...toolResultUIMessages.flatMap((m) => m.content),
  ];
  const singleToolRoundMessage: UIMessage = {
    role: "assistant",
    content: toolRoundContent,
  };

  // Combine messages, filtering out existing tool messages and system messages
  // (system prompt is passed separately via the system parameter to streamText)
  const allMessagesForContinuation: UIMessage[] = [
    ...messages.filter(isValidMessageForContinuation),
    singleToolRoundMessage,
  ];

  if (process.env.ARC_ENV !== "production") {
    console.log("[Continuation Handler] Messages for continuation:", {
      messageCount: allMessagesForContinuation.length,
      toolRoundContentParts: singleToolRoundMessage.content.length,
    });
  }

  let continuationModelMessages: ModelMessage[];
  try {
    continuationModelMessages = convertUIMessagesToModelMessages(
      allMessagesForContinuation
    );
  } catch (error) {
    console.error(
      "[Continuation Handler] Error converting messages for continuation:",
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }
    );
    throw error;
  }

  const baseSystemPrompt = await buildSystemPromptWithSkills(
    agent.systemPrompt,
    agent.enabledSkillIds
  );
  const continuationSystemPrompt = `${baseSystemPrompt}\n\n${continuationInstructions}`;

  let continuationResult;

  if (process.env.ARC_ENV !== "production") {
    console.log("[Continuation Handler] Model messages:", {
      messageCount: continuationModelMessages.length,
    });
  }

  try {
    const resolvedModelName =
      typeof agent.modelName === "string" && agent.modelName.length > 0
        ? agent.modelName
        : getDefaultModel();
    const modelCapabilities = resolveModelCapabilities(
      "openrouter",
      resolvedModelName
    );
    const generateOptions = filterGenerateTextOptionsForCapabilities(
      buildGenerateTextOptions(agent),
      modelCapabilities
    );
    const effectiveTools = resolveToolsForCapabilities(
      tools,
      modelCapabilities
    );
    // Use agent's modelName for logging - simpler and more reliable than extracting from model object
    const modelNameForLog = resolvedModelName || MODEL_NAME;
    console.log(
      "[Continuation Handler] Executing generateText with parameters:",
      {
        model: modelNameForLog,
        systemPromptLength: continuationSystemPrompt.length,
        messagesCount: continuationModelMessages.length,
        toolsCount: effectiveTools ? Object.keys(effectiveTools).length : 0,
        ...generateOptions,
      }
    );
    // Log tool definitions before LLM call
    if (effectiveTools) {
      const { logToolDefinitions } = await import("./agentSetup");
      logToolDefinitions(effectiveTools, "Continuation Handler", agent);
    }
    continuationResult = await generateText({
      model: model as unknown as Parameters<typeof generateText>[0]["model"],
      system: continuationSystemPrompt,
      messages: continuationModelMessages,
      ...(effectiveTools ? { tools: effectiveTools } : {}),
      ...generateOptions,
      ...(abortSignal && { abortSignal }),
    });
  } catch (error) {
    console.error("[Continuation Handler] Error in generateText continuation:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }

  // Get continuation text and token usage
  // continuationResult from generateText has totalUsage property
  let continuationText: string;
  const continuationTokenUsage = extractTokenUsage(
    continuationResult as unknown as GenerateTextResultWithTotalUsage
  );
  try {
    continuationText = continuationResult.text;
  } catch (error) {
    console.error("[Continuation Handler] Error getting continuation text:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }

  // If no continuation text was generated (final text is empty), use the latest tool result as the reply
  const hasFinalText = continuationText && continuationText.trim().length > 0;
  if (!hasFinalText && toolResultUIMessages.length > 0) {
    const latestToolResultMessage =
      toolResultUIMessages[toolResultUIMessages.length - 1];
    const toolResultText =
      latestToolResultMessage?.role === "assistant" &&
      Array.isArray(latestToolResultMessage.content)
        ? extractTextFromToolResultContent(latestToolResultMessage.content)
        : undefined;

    if (toolResultText && toolResultText.trim().length > 0) {
      if (process.env.ARC_ENV !== "production") {
        console.log("[Continuation Handler] Using tool result as reply:", {
          length: toolResultText.length,
          preview: toolResultText.slice(0, 80) + (toolResultText.length > 80 ? "…" : ""),
        });
      }
      return {
        text: toolResultText,
        tokenUsage: continuationTokenUsage,
      };
    } else if (process.env.ARC_ENV !== "production") {
      console.log("[Continuation Handler] No tool result text found to use as reply", {
        toolResultUIMessagesCount: toolResultUIMessages.length,
      });
    }
  }

  if (process.env.ARC_ENV !== "production") {
    console.log("[Continuation Handler] Final result:", {
    hasContinuationText: continuationText?.trim().length > 0,
    continuationTextLength: continuationText?.length || 0,
    hasFinalText,
    hasToolResultFallback: !hasFinalText && toolResultUIMessages.length > 0,
    toolResultUIMessagesCount: toolResultUIMessages.length,
  });
  }

  return hasFinalText
    ? {
        text: continuationText,
        tokenUsage: continuationTokenUsage,
      }
    : null;
}
