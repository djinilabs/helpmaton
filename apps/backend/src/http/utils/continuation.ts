import type { ModelMessage } from "ai";
import { generateText } from "ai";

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

  const toolResultUIMessages = toolResults
    .filter((tr): tr is NonNullable<typeof tr> => tr != null)
    .map(formatToolResultMessage);

  // Merge all tool calls and tool results into a single assistant message.
  // convertUIMessagesToModelMessages uses appendToolResultsToFirstAssistant, which
  // only appends results to the first assistant message. If we pass multiple
  // assistant messages (one per tool call/result), only the first tool call would
  // get results, causing AI_MissingToolResultsError for the rest.
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
    ...messages.filter((msg): msg is UIMessage => {
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

      // Filter out system messages since we pass system separately
      if (msg.role === "system") {
        return false;
      }

      // Filter out tool messages (we'll add tool results separately as assistant messages)
      if (msg.role === "tool") {
        return false;
      }

      return true;
    }),
    singleToolRoundMessage,
  ];

  console.log(
    "allMessagesForContinuation",
    JSON.stringify(allMessagesForContinuation, null, 2)
  );

  let continuationModelMessages: ModelMessage[];
  try {
    continuationModelMessages = convertUIMessagesToModelMessages(
      allMessagesForContinuation
    );
  } catch (error) {
    console.error(
      "[Agent Test Handler] Error converting messages for continuation:",
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }
    );
    throw error;
  }

  const continuationSystemPrompt = `${agent.systemPrompt}\n\n${continuationInstructions}`;

  let continuationResult;

  console.log(
    "continuationModelMessages",
    JSON.stringify(continuationModelMessages, null, 2)
  );

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
    console.error("[Agent Test Handler] Error in generateText continuation:", {
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
    console.error("[Agent Test Handler] Error getting continuation text:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }

  // If no continuation text was generated (final text is empty), use the latest tool result as the reply
  const hasFinalText = continuationText && continuationText.trim().length > 0;
  if (!hasFinalText && toolResultUIMessages.length > 0) {
    // Get the latest tool result message (which is formatted as an assistant message)
    const latestToolResultMessage =
      toolResultUIMessages[toolResultUIMessages.length - 1];

    // Extract text from tool result content
    // The tool result is in the content array as { type: 'tool-result', result: ... }
    let toolResultText: string | undefined;

    if (
      latestToolResultMessage &&
      latestToolResultMessage.role === "assistant" &&
      Array.isArray(latestToolResultMessage.content)
    ) {
      // Find the tool-result in the content array
      for (const item of latestToolResultMessage.content) {
        if (
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          item.type === "tool-result"
        ) {
          // Check for both "result" (from UI messages) and "output" (from converted ModelMessages)
          const result =
            "result" in item && item.result !== undefined
              ? item.result
              : "output" in item && item.output !== undefined
              ? item.output
              : undefined;

          if (result === undefined) {
            continue;
          }

          // Handle different result formats
          if (typeof result === "string") {
            toolResultText = result;
          } else if (
            result &&
            typeof result === "object" &&
            "type" in result &&
            "value" in result
          ) {
            // LanguageModelV2ToolResultOutput format: { type: 'text', value: string }
            if (result.type === "text" && typeof result.value === "string") {
              toolResultText = result.value;
            } else if (result.type === "json") {
              // For JSON outputs, stringify them
              toolResultText = JSON.stringify(result.value);
            }
          } else if (result) {
            toolResultText = String(result);
          }
          break; // Use the first tool-result found
        }
      }
    }

    if (toolResultText && toolResultText.trim().length > 0) {
      console.log("[Continuation] Using tool result as reply:", toolResultText);
      return {
        text: toolResultText,
        tokenUsage: continuationTokenUsage,
      };
    } else {
      console.log("[Continuation] No tool result text found to use as reply", {
        latestToolResultMessage,
        toolResultUIMessages: toolResultUIMessages.length,
      });
    }
  }

  console.log("[Continuation] Final result:", {
    hasContinuationText: continuationText?.trim().length > 0,
    continuationTextLength: continuationText?.length || 0,
    hasFinalText,
    hasToolResultFallback: !hasFinalText && toolResultUIMessages.length > 0,
    toolResultUIMessagesCount: toolResultUIMessages.length,
  });

  return hasFinalText
    ? {
        text: continuationText,
        tokenUsage: continuationTokenUsage,
      }
    : null;
}
