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
import type { StreamRequestContext } from "./streamRequestContext";
import {
  formatToolCallMessage,
  formatToolResultMessage,
} from "./toolFormatting";



/**
 * Adjusts credit reservation after the stream completes
 */
export async function adjustCreditsAfterStream(
  context: StreamRequestContext,
  tokenUsage: TokenUsage | undefined,
  streamResult: Awaited<ReturnType<typeof streamText>>
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
 * Extracts tool calls and results from stream result
 */
async function extractToolCallsAndResults(streamResult: Awaited<ReturnType<typeof streamText>>): Promise<{
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
              toolCallsFromSteps.push({
                toolCallId: contentItem.toolCallId,
                toolName: contentItem.toolName,
                args: contentItem.input || contentItem.args || {},
              });
            } else if (contentItem.type === "tool-result") {
              toolResultsFromSteps.push({
                toolCallId: contentItem.toolCallId,
                toolName: contentItem.toolName,
                output:
                  contentItem.output?.value ||
                  contentItem.output ||
                  contentItem.result,
                result:
                  contentItem.output?.value ||
                  contentItem.output ||
                  contentItem.result,
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
  }
  if (toolResultsFromSteps.length > 0) {
    toolResultsFromResult = toolResultsFromSteps;
  }

  // Reconstruct tool calls from results if needed
  if (toolCallsFromResult.length === 0 && toolResultsFromResult.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    toolCallsFromResult = toolResultsFromResult.map((toolResult: any) => ({
      toolCallId:
        toolResult.toolCallId ||
        `call-${Math.random().toString(36).substring(7)}`,
      toolName: toolResult.toolName || "unknown",
      args: toolResult.args || toolResult.input || {},
    })) as unknown as typeof toolCallsFromResult;
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
  generationTimeMs?: number
): Promise<void> {
  if (!tokenUsage) {
    return;
  }

  try {
    const { toolCalls, toolResults } = await extractToolCallsAndResults(streamResult);

    const toolCallMessages = toolCalls.map(formatToolCallMessage);
    const toolResultMessages = toolResults.map(formatToolResultMessage);

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
    > = [];

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

    const assistantMessage: UIMessage = {
      role: "assistant",
      content:
        assistantContent.length > 0 ? assistantContent : finalResponseText,
      ...{ tokenUsage },
      modelName: context.finalModelName,
      provider: "openrouter",
      ...(openrouterGenerationId && { openrouterGenerationId }),
      ...(provisionalCostUsd !== undefined && { provisionalCostUsd }),
      ...(generationTimeMs !== undefined && { generationTimeMs }),
    };

    const messagesForLogging: UIMessage[] = [
      ...context.convertedMessages,
      assistantMessage,
    ];

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

    await updateConversation(
      context.db,
      context.workspaceId,
      context.agentId,
      context.conversationId,
      validMessages,
      tokenUsage,
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
  generationTimeMs?: number
): Promise<void> {
  // Adjust credits
  try {
    await adjustCreditsAfterStream(context, tokenUsage, streamResult);
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

  // Log conversation
  await logConversation(
    context,
    finalResponseText,
    tokenUsage,
    streamResult,
    generationTimeMs
  );
}

