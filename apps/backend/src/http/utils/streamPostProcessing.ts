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
import { buildConversationMessagesFromObserver } from "./llmObserver";
import type { StreamRequestContext } from "./streamRequestContext";



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
 * Logs the conversation
 */
export async function logConversation(
  context: StreamRequestContext,
  tokenUsage: TokenUsage | undefined,
  streamResult: Awaited<ReturnType<typeof streamText>>,
  generationTimeMs?: number
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

    const messagesForLogging = buildConversationMessagesFromObserver({
      observerEvents: context.llmObserver.getEvents(),
      fallbackInputMessages: context.convertedMessages,
      assistantMeta: {
        tokenUsage: finalTokenUsage,
        modelName: context.finalModelName,
        provider: "openrouter",
        openrouterGenerationId,
        provisionalCostUsd,
        generationTimeMs,
      },
    });

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
  tokenUsage: TokenUsage | undefined,
  streamResult: Awaited<ReturnType<typeof streamText>>,
  generationTimeMs?: number
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
    tokenUsage,
    streamResult,
    generationTimeMs
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

