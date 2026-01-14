import { streamText } from "ai";

import {
  type StreamTextResultWithResolvedUsage,
  type TokenUsage,
} from "../../utils/conversationLogger";
import { updateConversation } from "../../utils/conversationLogger";
import type { UIMessage } from "../../utils/messageTypes";
import { extractAllOpenRouterGenerationIds } from "../../utils/openrouterUtils";
import { Sentry, ensureError } from "../../utils/sentry";
import { getContextFromRequestId } from "../../utils/workspaceCreditContext";

import {
  adjustCreditsAfterLLMCall,
  enqueueCostVerificationIfNeeded,
} from "./generationCreditManagement";
import { trackSuccessfulRequest } from "./generationRequestTracking";
import { extractTokenUsageAndCosts } from "./generationTokenExtraction";
import type { StreamEventTimestamps } from "./streamEventTracking";
import type { StreamRequestContext } from "./streamRequestContext";
import {
  formatToolCallMessage,
  formatToolResultMessage,
} from "./toolFormatting";



/**
 * Adjusts credit reservation after the stream completes
 * @param enqueueCostVerification - Whether to enqueue cost verification (default: true)
 *                                  Set to false if cost verification will be enqueued separately after conversation is saved
 */
export async function adjustCreditsAfterStream(
  context: StreamRequestContext,
  tokenUsage: TokenUsage | undefined,
  streamResult: Awaited<ReturnType<typeof streamText>>,
  enqueueCostVerification: boolean = true
): Promise<void> {
  const openrouterGenerationIds =
    extractAllOpenRouterGenerationIds(streamResult);
  const openrouterGenerationId =
    openrouterGenerationIds.length > 0 ? openrouterGenerationIds[0] : undefined;

  const lambdaContext = getContextFromRequestId(context.awsRequestId);
  if (!lambdaContext) {
    throw new Error("Context not available for workspace credit transactions");
  }

  await adjustCreditsAfterLLMCall(
    context.db,
    context.workspaceId,
    context.agentId,
    context.reservationId,
    "openrouter",
    context.finalModelName,
    tokenUsage,
    context.usesByok,
    openrouterGenerationId,
    openrouterGenerationIds,
    context.endpointType as "test" | "stream",
    lambdaContext,
    context.conversationId
  );

  if (enqueueCostVerification) {
    await enqueueCostVerificationIfNeeded(
      openrouterGenerationId,
      openrouterGenerationIds,
      context.workspaceId,
      context.reservationId,
      context.conversationId,
      context.agentId,
      context.endpointType as "test" | "stream"
    );
  }
}

/**
 * Tracks the successful LLM request
 */
export async function trackRequestUsage(
  context: StreamRequestContext
): Promise<void> {
  await trackSuccessfulRequest(
    context.subscriptionId,
    context.workspaceId,
    context.agentId,
    context.endpointType as "test" | "stream"
  );
}

/**
 * Extracts reasoning content from stream result
 */
async function extractReasoning(
  streamResult: Awaited<ReturnType<typeof streamText>>
): Promise<Array<{ type: "reasoning"; text: string }>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- streamText result types are complex
  const resultAny = streamResult as any;
  const reasoningContent: Array<{ type: "reasoning"; text: string }> = [];

  // Extract from _steps if available (preferred source)
  const stepsValue = resultAny?._steps?.status?.value;
  if (Array.isArray(stepsValue)) {
    for (const step of stepsValue) {
      if (step?.content && Array.isArray(step.content)) {
        for (const contentItem of step.content) {
          if (
            typeof contentItem === "object" &&
            contentItem !== null &&
            "type" in contentItem &&
            contentItem.type === "reasoning" &&
            "text" in contentItem &&
            typeof contentItem.text === "string"
          ) {
            reasoningContent.push({
              type: "reasoning",
              text: contentItem.text,
            });
          }
        }
      }
    }
  }

  // Also check direct properties (fallback)
  // Some AI SDK versions might expose reasoning differently
  if (reasoningContent.length === 0) {
    if (resultAny?.reasoning && typeof resultAny.reasoning === "string") {
      reasoningContent.push({
        type: "reasoning",
        text: resultAny.reasoning,
      });
    } else if (Array.isArray(resultAny?.reasoning)) {
      // Handle array of reasoning strings
      for (const reasoningText of resultAny.reasoning) {
        if (typeof reasoningText === "string") {
          reasoningContent.push({
            type: "reasoning",
            text: reasoningText,
          });
        }
      }
    }
  }

  return reasoningContent;
}

/**
 * Extracts tool calls and results from stream result
 * Uses event timestamps when available, otherwise falls back to step extraction
 */
async function extractToolCallsAndResults(
  streamResult: Awaited<ReturnType<typeof streamText>>,
  eventTimestamps?: StreamEventTimestamps
): Promise<{
  toolCalls: unknown[];
  toolResults: unknown[];
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- streamText result types are complex
  const resultAny = streamResult as any;
  
  const toolCallsFromSteps: unknown[] = [];
  const toolResultsFromSteps: unknown[] = [];

  // Extract from _steps if available
  const stepsValue = resultAny?._steps?.status?.value;
  if (Array.isArray(stepsValue)) {
    for (const step of stepsValue) {
      if (step?.content && Array.isArray(step.content)) {
        for (const contentItem of step.content) {
          if (
            typeof contentItem === "object" &&
            contentItem !== null &&
            "type" in contentItem
          ) {
            if (contentItem.type === "tool-call") {
              const toolCallId = contentItem.toolCallId;
              // Use event timestamp if available, otherwise use step timestamp
              let toolCallStartedAt: string | undefined;
              if (toolCallId && eventTimestamps) {
                const timestamp = eventTimestamps.toolCallTimestamps.get(toolCallId);
                toolCallStartedAt = timestamp?.startedAt;
              }
              // If no event timestamp, use current time as fallback
              if (!toolCallStartedAt) {
                toolCallStartedAt = new Date().toISOString();
              }
              
              toolCallsFromSteps.push({
                toolCallId: toolCallId,
                toolName: contentItem.toolName,
                args: contentItem.input || contentItem.args || {},
                toolCallStartedAt,
              });
            } else if (contentItem.type === "tool-result") {
              const toolCallId = contentItem.toolCallId;
              // Use event execution time if available
              let toolExecutionTimeMs: number | undefined;
              if (toolCallId && eventTimestamps) {
                toolExecutionTimeMs = eventTimestamps.toolExecutionTimes.get(toolCallId);
              }
              
              toolResultsFromSteps.push({
                toolCallId: toolCallId,
                toolName: contentItem.toolName,
                output:
                  contentItem.output?.value ||
                  contentItem.output ||
                  contentItem.result,
                result:
                  contentItem.output?.value ||
                  contentItem.output ||
                  contentItem.result,
                ...(toolExecutionTimeMs !== undefined && { toolExecutionTimeMs }),
              });
            }
          }
        }
      }
    }
  }

  // Get from direct properties or steps - these may be Promises
  const [toolCallsFromResultRaw, toolResultsFromResultRaw] = await Promise.all([
    Promise.resolve(streamResult?.toolCalls).then((tc) => tc || []),
    Promise.resolve(streamResult?.toolResults).then((tr) => tr || []),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK tool result types vary
  let toolCallsFromResult: any[] = Array.isArray(toolCallsFromResultRaw)
    ? toolCallsFromResultRaw
    : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK tool result types vary
  let toolResultsFromResult: any[] = Array.isArray(toolResultsFromResultRaw)
    ? toolResultsFromResultRaw
    : [];

  // Prefer steps if available
  if (toolCallsFromSteps.length > 0) {
    toolCallsFromResult = toolCallsFromSteps;
  } else {
    // Add timestamps to tool calls from direct properties if not already present
    // Use event timestamps if available
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK tool call types vary
    toolCallsFromResult = toolCallsFromResult.map((toolCall: any) => {
      if (!toolCall.toolCallStartedAt) {
        const toolCallId = toolCall.toolCallId;
        let toolCallStartedAt: string | undefined;
        if (toolCallId && eventTimestamps) {
          const timestamp = eventTimestamps.toolCallTimestamps.get(toolCallId);
          toolCallStartedAt = timestamp?.startedAt;
        }
        if (!toolCallStartedAt) {
          toolCallStartedAt = new Date().toISOString();
        }
        return {
          ...toolCall,
          toolCallStartedAt,
        };
      }
      return toolCall;
    });
  }

  if (toolResultsFromSteps.length > 0) {
    toolResultsFromResult = toolResultsFromSteps;
  } else {
    // Add execution time to tool results from direct properties if not already present
    // Use event timestamps if available
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK tool result types vary
    toolResultsFromResult = toolResultsFromResult.map((toolResult: any) => {
      if (toolResult.toolExecutionTimeMs === undefined) {
        const toolCallId = toolResult.toolCallId;
        if (toolCallId && eventTimestamps) {
          const executionTimeMs = eventTimestamps.toolExecutionTimes.get(toolCallId);
          if (executionTimeMs !== undefined) {
            return {
              ...toolResult,
              toolExecutionTimeMs: executionTimeMs,
            };
          }
        }
      }
      return toolResult;
    });
  }

  // Reconstruct tool calls from results if needed
  if (toolCallsFromResult.length === 0 && toolResultsFromResult.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    toolCallsFromResult = toolResultsFromResult.map((toolResult: any) => {
      const toolCallId =
        toolResult.toolCallId ||
        `call-${Math.random().toString(36).substring(7)}`;
      let toolCallStartedAt: string;
      if (toolCallId && eventTimestamps) {
        const timestamp = eventTimestamps.toolCallTimestamps.get(toolCallId);
        toolCallStartedAt = timestamp?.startedAt || new Date().toISOString();
      } else {
        toolCallStartedAt = new Date().toISOString();
      }
      return {
        toolCallId,
        toolName: toolResult.toolName || "unknown",
        args: toolResult.args || toolResult.input || {},
        toolCallStartedAt,
      };
    }) as unknown as typeof toolCallsFromResult;
  }

  return {
    toolCalls: toolCallsFromResult,
    toolResults: toolResultsFromResult,
  };
}

/**
 * Logs the conversation
 */
export async function logConversation(
  context: StreamRequestContext,
  finalResponseText: string,
  tokenUsage: TokenUsage | undefined,
  streamResult: Awaited<ReturnType<typeof streamText>>,
  generationTimeMs?: number,
  generationStartedAt?: string,
  generationEndedAt?: string,
  eventTimestamps?: StreamEventTimestamps
): Promise<void> {
  try {
    // Extract tokenUsage from streamResult if not provided
    // This ensures we always have tokenUsage when the LLM call succeeded,
    // even if no response text was generated (input tokens were still consumed)
    let finalTokenUsage = tokenUsage;
    if (!finalTokenUsage) {
      const totalUsage = await streamResult.totalUsage;
      const { tokenUsage: extractedTokenUsage } = extractTokenUsageAndCosts(
        { totalUsage } as unknown as StreamTextResultWithResolvedUsage,
        undefined,
        context.finalModelName,
        "stream"
      );
      finalTokenUsage = extractedTokenUsage;
    }

    // If we still don't have tokenUsage, we can't calculate costs, so skip logging
    // This should be rare - if streamResult exists, we should have tokenUsage
    if (!finalTokenUsage) {
      console.warn(
        "[Stream Handler] No tokenUsage available for conversation logging, skipping",
        {
          workspaceId: context.workspaceId,
          agentId: context.agentId,
          conversationId: context.conversationId,
        }
      );
      return;
    }

    const { toolCalls, toolResults } = await extractToolCallsAndResults(
      streamResult,
      eventTimestamps
    );

    // Extract reasoning content from stream result
    const reasoningContent = await extractReasoning(streamResult);

    const toolCallMessages = toolCalls.map(formatToolCallMessage);
    const toolResultMessages = toolResults.map(formatToolResultMessage);

    // Always use the original generationEndedAt which includes the full LLM call time
    // (including text generation after tool execution)
    // The expandMessagesWithToolCalls function will split this correctly
    const finalGenerationEndedAt = generationEndedAt;

    const assistantContent: Array<
      | { type: "text"; text: string }
      | {
          type: "tool-call";
          toolCallId: string;
          toolName: string;
          args: unknown;
        }
      | {
          type: "tool-result";
          toolCallId: string;
          toolName: string;
          result: unknown;
        }
      | {
          type: "reasoning";
          text: string;
        }
    > = [];

    // Add reasoning content first (it typically comes before tool calls or text)
    assistantContent.push(...reasoningContent);

    for (const toolCallMsg of toolCallMessages) {
      if (Array.isArray(toolCallMsg.content)) {
        assistantContent.push(...toolCallMsg.content);
      }
    }

    for (const toolResultMsg of toolResultMessages) {
      if (Array.isArray(toolResultMsg.content)) {
        assistantContent.push(...toolResultMsg.content);
      }
    }

    if (finalResponseText && finalResponseText.trim().length > 0) {
      assistantContent.push({ type: "text", text: finalResponseText });
    }

    const totalUsage = await streamResult.totalUsage;
    const {
      openrouterGenerationId,
      provisionalCostUsd: extractedProvisionalCostUsd,
    } = extractTokenUsageAndCosts(
      { totalUsage } as unknown as StreamTextResultWithResolvedUsage,
      undefined,
      context.finalModelName,
      "stream"
    );
    const provisionalCostUsd = extractedProvisionalCostUsd;

    // Always create assistant message, even if content is empty
    // Empty content means no text response, but input tokens were still consumed
    const assistantMessage: UIMessage = {
      role: "assistant",
      content:
        assistantContent.length > 0 ? assistantContent : finalResponseText || "",
      ...{ tokenUsage: finalTokenUsage },
      modelName: context.finalModelName,
      provider: "openrouter",
      ...(openrouterGenerationId && { openrouterGenerationId }),
      ...(provisionalCostUsd !== undefined && { provisionalCostUsd }),
      ...(generationTimeMs !== undefined && { generationTimeMs }),
      ...(generationStartedAt && { generationStartedAt }),
      ...(finalGenerationEndedAt && { generationEndedAt: finalGenerationEndedAt }),
    };

    const messagesForLogging: UIMessage[] = [
      ...context.convertedMessages,
      assistantMessage,
    ];

    // Log messages with file parts before filtering
    const messagesWithFiles = messagesForLogging.filter(
      (msg) =>
        msg &&
        typeof msg === "object" &&
        "role" in msg &&
        msg.role === "user" &&
        "content" in msg &&
        Array.isArray(msg.content) &&
        msg.content.some(
          (part) =>
            part &&
            typeof part === "object" &&
            "type" in part &&
            part.type === "file"
        )
    );
    if (messagesWithFiles.length > 0) {
      console.log("[Stream Handler] Messages with file parts before logging:", {
        count: messagesWithFiles.length,
        files: messagesWithFiles.map((msg) => ({
          role: msg.role,
          fileParts: Array.isArray(msg.content)
            ? msg.content.filter(
                (part) =>
                  part &&
                  typeof part === "object" &&
                  "type" in part &&
                  part.type === "file"
              )
            : [],
        })),
      });
    }

    const validMessages: UIMessage[] = messagesForLogging.filter(
      (msg): msg is UIMessage =>
        msg != null &&
        typeof msg === "object" &&
        "role" in msg &&
        typeof msg.role === "string" &&
        (msg.role === "user" ||
          msg.role === "assistant" ||
          msg.role === "system" ||
          msg.role === "tool") &&
        "content" in msg
    );

    // Log messages with file parts after filtering to ensure they're preserved
    const validMessagesWithFiles = validMessages.filter(
      (msg) =>
        msg.role === "user" &&
        Array.isArray(msg.content) &&
        msg.content.some(
          (part) =>
            part &&
            typeof part === "object" &&
            "type" in part &&
            part.type === "file"
        )
    );
    if (validMessagesWithFiles.length > 0) {
      console.log("[Stream Handler] Valid messages with file parts for logging:", {
        count: validMessagesWithFiles.length,
        files: validMessagesWithFiles.map((msg) => ({
          role: msg.role,
          fileParts: Array.isArray(msg.content)
            ? msg.content.filter(
                (part) =>
                  part &&
                  typeof part === "object" &&
                  "type" in part &&
                  part.type === "file"
              )
            : [],
        })),
      });
    }

    await updateConversation(
      context.db,
      context.workspaceId,
      context.agentId,
      context.conversationId,
      validMessages,
      finalTokenUsage,
      context.usesByok,
      undefined,
      context.awsRequestId,
      context.endpointType as "test" | "stream"
    ).catch((error) => {
      console.error("[Stream Handler] Error logging conversation:", {
        error: error instanceof Error ? error.message : String(error),
        workspaceId: context.workspaceId,
        agentId: context.agentId,
      });
      Sentry.captureException(ensureError(error), {
        tags: {
          endpoint: context.endpointType,
          operation: "conversation_logging",
        },
        extra: {
          workspaceId: context.workspaceId,
          agentId: context.agentId,
        },
      });
    });
  } catch (error) {
    console.error("[Stream Handler] Error preparing conversation log:", {
      error: error instanceof Error ? error.message : String(error),
      workspaceId: context.workspaceId,
      agentId: context.agentId,
    });
    Sentry.captureException(ensureError(error), {
      tags: {
        endpoint: context.endpointType,
        operation: "conversation_logging",
      },
      extra: {
        workspaceId: context.workspaceId,
        agentId: context.agentId,
      },
    });
  }
}

/**
 * Performs all post-processing steps after stream completes
 */
export async function performPostProcessing(
  context: StreamRequestContext,
  finalResponseText: string,
  tokenUsage: TokenUsage | undefined,
  streamResult: Awaited<ReturnType<typeof streamText>>,
  generationTimeMs?: number,
  generationStartedAt?: string,
  generationEndedAt?: string,
  eventTimestamps?: StreamEventTimestamps
): Promise<void> {
  // Adjust credits (but don't enqueue cost verification yet - we'll do that after saving conversation)
  try {
    await adjustCreditsAfterStream(context, tokenUsage, streamResult, false);
  } catch (error) {
    console.error(
      "[Stream Handler] Error adjusting credit reservation after stream:",
      {
        error: error instanceof Error ? error.message : String(error),
        workspaceId: context.workspaceId,
        agentId: context.agentId,
      }
    );
    Sentry.captureException(ensureError(error), {
      tags: {
        endpoint: context.endpointType,
        operation: "credit_adjustment",
      },
    });
  }

  // Track usage
  await trackRequestUsage(context);

  // Log conversation FIRST - this ensures messages are saved before cost verification runs
  await logConversation(
    context,
    finalResponseText,
    tokenUsage,
    streamResult,
    generationTimeMs,
    generationStartedAt,
    generationEndedAt,
    eventTimestamps
  );

  // Enqueue cost verification AFTER conversation is saved
  // This prevents race condition where cost verification runs before message is in DB
  try {
    const openrouterGenerationIds = extractAllOpenRouterGenerationIds(streamResult);
    const openrouterGenerationId =
      openrouterGenerationIds.length > 0 ? openrouterGenerationIds[0] : undefined;

    await enqueueCostVerificationIfNeeded(
      openrouterGenerationId,
      openrouterGenerationIds,
      context.workspaceId,
      context.reservationId,
      context.conversationId,
      context.agentId,
      context.endpointType as "test" | "stream"
    );
  } catch (error) {
    console.error(
      "[Stream Handler] Error enqueueing cost verification:",
      {
        error: error instanceof Error ? error.message : String(error),
        workspaceId: context.workspaceId,
        agentId: context.agentId,
      }
    );
    Sentry.captureException(ensureError(error), {
      tags: {
        endpoint: context.endpointType,
        operation: "enqueue-cost-verification",
      },
    });
  }
}

