import { randomUUID } from "crypto";

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";

import {
  enqueueCostVerificationIfNeeded,
} from "../../http/utils/generationCreditManagement";
import {
  isByokAuthenticationError,
  normalizeByokError,
  handleByokAuthenticationErrorApiGateway,
  handleCreditErrors,
  logErrorDetails,
} from "../../http/utils/generationErrorHandling";
import {
  validateSubscriptionAndLimits,
  trackSuccessfulRequest,
} from "../../http/utils/generationRequestTracking";
import { reconstructToolCallsFromResults } from "../../http/utils/generationToolReconstruction";
import { database } from "../../tables";
import {
  isMessageContentEmpty,
  startConversation,
  buildConversationErrorInfo,
} from "../../utils/conversationLogger";
import {
  handlingErrors,
} from "../../utils/handlingErrors";
import { adaptHttpHandler } from "../../utils/httpEventAdapter";
import type { UIMessage } from "../../utils/messageTypes";
import { Sentry, ensureError } from "../../utils/sentry";
import { trackBusinessEvent } from "../../utils/tracking";
import {
  getContextFromRequestId,
  getTransactionBuffer,
} from "../../utils/workspaceCreditContext";
import { updateTransactionBufferConversationId } from "../../utils/workspaceCreditTransactions";
import { callAgentNonStreaming } from "../utils/agentCallNonStreaming";
import { buildConversationMessagesFromObserver } from "../utils/llmObserver";
import {
  convertTextToUIMessage,
} from "../utils/messageConversion";
import {
  createRequestTimeout,
  cleanupRequestTimeout,
  isTimeoutError,
  createTimeoutError,
} from "../utils/requestTimeout";
import {
  validateWebhookRequest,
  validateWebhookKey,
} from "../utils/requestValidation";
import {
  formatToolCallMessage,
  formatToolResultMessage,
} from "../utils/toolFormatting";

async function persistWebhookConversationError(options: {
  db: Awaited<ReturnType<typeof database>>;
  workspaceId: string;
  agentId: string;
  uiMessage: UIMessage;
  usesByok?: boolean;
  finalModelName?: string;
  error: unknown;
  awsRequestId?: string;
}): Promise<void> {
  try {
    const messages = [options.uiMessage].filter(
      (msg) => !isMessageContentEmpty(msg)
    );

    // Log error structure before extraction (especially for BYOK)
    if (options.usesByok) {
      type ErrorWithCustomFields = Error & {
        data?: { error?: { message?: string } };
        statusCode?: number;
        response?: { data?: { error?: { message?: string } } };
      };
      const errorAny =
        options.error instanceof Error
          ? (options.error as ErrorWithCustomFields)
          : undefined;

      const causeAny =
        options.error instanceof Error && options.error.cause instanceof Error
          ? (options.error.cause as ErrorWithCustomFields)
          : undefined;
      console.log("[Webhook Handler] BYOK error before extraction:", {
        errorType:
          options.error instanceof Error
            ? options.error.constructor.name
            : typeof options.error,
        errorName: options.error instanceof Error ? options.error.name : "N/A",
        errorMessage:
          options.error instanceof Error
            ? options.error.message
            : String(options.error),
        hasData: !!errorAny?.data,
        dataError: errorAny?.data?.error,
        dataErrorMessage: errorAny?.data?.error?.message,
        hasCause: options.error instanceof Error && !!options.error.cause,
        causeType:
          options.error instanceof Error && options.error.cause instanceof Error
            ? options.error.cause.constructor.name
            : undefined,
        causeMessage:
          options.error instanceof Error && options.error.cause instanceof Error
            ? options.error.cause.message
            : undefined,
        causeData: causeAny?.data?.error?.message,
      });
    }

    const errorInfo = buildConversationErrorInfo(options.error, {
      provider: "openrouter",
      modelName: options.finalModelName,
      endpoint: "webhook",
      metadata: {
        usesByok: options.usesByok,
      },
    });

    // Log extracted error info (especially for BYOK)
    if (options.usesByok) {
      console.log("[Webhook Handler] BYOK error after extraction:", {
        message: errorInfo.message,
        name: errorInfo.name,
        code: errorInfo.code,
        statusCode: errorInfo.statusCode,
      });
    }

    await startConversation(options.db, {
      workspaceId: options.workspaceId,
      agentId: options.agentId,
      conversationType: "webhook",
      messages,
      usesByok: options.usesByok,
      error: errorInfo,
      awsRequestId: options.awsRequestId,
    });
  } catch (logError) {
    console.error("[Webhook Handler] Failed to persist conversation error:", {
      workspaceId: options.workspaceId,
      agentId: options.agentId,
      originalError:
        options.error instanceof Error
          ? options.error.message
          : String(options.error),
      logError: logError instanceof Error ? logError.message : String(logError),
    });
    Sentry.captureException(ensureError(logError), {
      tags: {
        context: "conversation-logging",
        operation: "persist-error",
        handler: "webhook",
      },
    });
  }
}

export const handler = adaptHttpHandler(
  handlingErrors(
    async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
      // Extract request ID for logging
      const awsRequestId = event.requestContext?.requestId;

      // Get context for workspace credit transactions
      const context = getContextFromRequestId(awsRequestId);
      if (!context) {
        throw new Error(
          "Context not available for workspace credit transactions"
        );
      }

      // Validate request
      const { workspaceId, agentId, key, bodyText } =
        validateWebhookRequest(event);

      // Validate webhook key
      await validateWebhookKey(workspaceId, agentId, key);

      // Validate subscription and limits
      const subscriptionId = await validateSubscriptionAndLimits(
        workspaceId,
        "webhook"
      );

      // Convert plain text body to UIMessage format
      const uiMessage = convertTextToUIMessage(bodyText);

      // Generate conversationId BEFORE calling the agent
      // This ensures delegation tools (like call_agent_async) have access to conversationId
      // for proper tracking in the delegations array
      const conversationId = randomUUID();

      // TEMPORARY: This check can be disabled via ENABLE_CREDIT_VALIDATION and ENABLE_SPENDING_LIMIT_CHECKS env vars
      const db = await database();
      let agentResult;
      let usesByok: boolean | undefined;
      let finalModelName: string | undefined;

      // Create request timeout (10 minutes)
      const requestTimeout = createRequestTimeout();

      try {
        // Call agent using the shared non-streaming utility
        // This handles credit validation, reservation, LLM call, and tool continuation
        // Pass conversationId so delegation tools can track delegations properly
        const generationStartTime = Date.now();
        const generationStartedAt = new Date().toISOString();
        agentResult = await callAgentNonStreaming(
          workspaceId,
          agentId,
          bodyText,
          {
            modelReferer: "http://localhost:3000/api/webhook",
            context,
            endpointType: "webhook",
            conversationId, // Pass conversationId so delegation tools can use it
            abortSignal: requestTimeout.signal,
          }
        );
        const generationTimeMs = Date.now() - generationStartTime;
        const generationEndedAt = new Date().toISOString();

      // Track successful LLM request
      await trackSuccessfulRequest(
        subscriptionId,
        workspaceId,
        agentId,
        "webhook"
      );

        // Get agent info for model name (needed for conversation logging)
        const { setupAgentAndTools } = await import("../utils/agentSetup");
        const { agent, usesByok: agentUsesByok } = await setupAgentAndTools(
          workspaceId,
          agentId,
          [],
          {
            modelReferer: "http://localhost:3000/api/webhook",
            callDepth: 0,
            maxDelegationDepth: 3,
            context,
          }
        );
        usesByok = agentUsesByok;
        finalModelName =
          typeof agent.modelName === "string" ? agent.modelName : "openrouter/gemini-2.0-flash-exp";

        // Extract response content from agent result
        const responseContent = agentResult.text;

        // Extract tool calls and results from raw result (same logic as before)
      let toolCallsFromResult: unknown[];
      let toolResultsFromResult: unknown[];
      let reasoningFromSteps: Array<{ type: "reasoning"; text: string }> = [];
      try {
          if (!agentResult.rawResult) {
            throw new Error("Raw result not available from agent call");
          }

        // Also extract steps/_steps as the source of truth for tool calls/results
        // generateText returns result.steps (array), streamText returns result._steps.status.value
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK generateText result types are complex
          const resultAny = agentResult.rawResult as any;
        // Check both result.steps (generateText) and result._steps.status.value (streamText)
        const stepsValue = Array.isArray(resultAny.steps)
          ? resultAny.steps
          : resultAny._steps?.status?.value;

        // Extract tool calls, results, and reasoning from steps (source of truth for server-side tool execution)
        const toolCallsFromSteps: unknown[] = [];
        const toolResultsFromSteps: unknown[] = [];
        reasoningFromSteps = []; // Reset for this result
        const toolCallStartTimes = new Map<string, number>(); // Track when each tool call started

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
                    // Validate required fields before adding
                    if (
                      contentItem.toolCallId &&
                      contentItem.toolName &&
                      typeof contentItem.toolCallId === "string" &&
                      typeof contentItem.toolName === "string"
                    ) {
                      // Use generation start time as baseline for tool call timestamp
                      const toolCallStartTime = generationStartTime;
                      toolCallStartTimes.set(contentItem.toolCallId, toolCallStartTime);
                      // Convert AI SDK tool-call format to our format
                      toolCallsFromSteps.push({
                        toolCallId: contentItem.toolCallId,
                        toolName: contentItem.toolName,
                        args: contentItem.input || contentItem.args || {},
                        toolCallStartedAt: generationStartedAt,
                      });
                    } else {
                      console.warn(
                        "[Webhook Handler] Skipping tool call with missing/invalid fields:",
                        {
                          hasToolCallId: !!contentItem.toolCallId,
                          hasToolName: !!contentItem.toolName,
                          toolCallIdType: typeof contentItem.toolCallId,
                          toolNameType: typeof contentItem.toolName,
                          contentItem,
                        }
                      );
                    }
                  } else if (contentItem.type === "tool-result") {
                    // Validate required fields before adding
                    if (
                      contentItem.toolCallId &&
                      contentItem.toolName &&
                      typeof contentItem.toolCallId === "string" &&
                      typeof contentItem.toolName === "string"
                    ) {
                      // Convert AI SDK tool-result format to our format
                      // Handle both string outputs and object outputs with .value property
                      let resultValue = contentItem.output;
                      if (
                        typeof resultValue === "object" &&
                        resultValue !== null &&
                        "value" in resultValue
                      ) {
                        resultValue = resultValue.value;
                      }
                      // Calculate tool execution time if we have the start time
                      const toolCallStartTime = toolCallStartTimes.get(contentItem.toolCallId);
                      let toolExecutionTimeMs: number | undefined;
                      if (toolCallStartTime !== undefined) {
                        // For non-streaming, we can't accurately measure tool execution time
                        // without wrapping tool execution, so we'll leave it undefined
                        // The expandMessagesWithToolCalls function will handle it
                      }
                      toolResultsFromSteps.push({
                        toolCallId: contentItem.toolCallId,
                        toolName: contentItem.toolName,
                        output:
                          resultValue ||
                          contentItem.output ||
                          contentItem.result,
                        result: resultValue || contentItem.result,
                        ...(toolExecutionTimeMs !== undefined && { toolExecutionTimeMs }),
                      });
                    } else {
                      console.warn(
                        "[Webhook Handler] Skipping tool result with missing/invalid fields:",
                        {
                          hasToolCallId: !!contentItem.toolCallId,
                          hasToolName: !!contentItem.toolName,
                          toolCallIdType: typeof contentItem.toolCallId,
                          toolNameType: typeof contentItem.toolName,
                          contentItem,
                        }
                      );
                    }
                  } else if (
                    contentItem.type === "reasoning" &&
                    "text" in contentItem &&
                    typeof contentItem.text === "string"
                  ) {
                    // Extract reasoning content
                    reasoningFromSteps.push({
                      type: "reasoning",
                      text: contentItem.text,
                    });
                  }
                }
              }
            }
          }
        }

        // Use steps as source of truth - prefer tool calls/results from steps if available
        // Only fall back to direct properties if steps doesn't have them
        if (toolCallsFromSteps.length > 0) {
          toolCallsFromResult = toolCallsFromSteps;
        } else {
            toolCallsFromResult = (agentResult.rawResult as { toolCalls?: unknown[] }).toolCalls || [];
        }

        if (toolResultsFromSteps.length > 0) {
          toolResultsFromResult = toolResultsFromSteps;
        } else {
            toolResultsFromResult = (agentResult.rawResult as { toolResults?: unknown[] }).toolResults || [];
        }

        // DIAGNOSTIC: Log tool calls and results extracted from result
        console.log("[Webhook Handler] Tool calls extracted from result:", {
          toolCallsCount: toolCallsFromResult.length,
          toolCalls: toolCallsFromResult,
          toolResultsCount: toolResultsFromResult.length,
          toolResults: toolResultsFromResult,
            resultKeys: agentResult.rawResult ? Object.keys(agentResult.rawResult) : [],
            hasToolCalls: agentResult.rawResult && "toolCalls" in agentResult.rawResult,
            hasToolResults: agentResult.rawResult && "toolResults" in agentResult.rawResult,
          hasSteps: "steps" in resultAny,
          has_steps: "_steps" in resultAny,
          stepsCount: Array.isArray(stepsValue) ? stepsValue.length : 0,
          toolCallsFromStepsCount: toolCallsFromSteps.length,
          toolResultsFromStepsCount: toolResultsFromSteps.length,
        });
      } catch (resultError) {
        // Check if this is a BYOK authentication error
        if (isByokAuthenticationError(resultError, usesByok)) {
          const errorToLog = normalizeByokError(resultError);
          await persistWebhookConversationError({
            db,
            workspaceId,
            agentId,
            uiMessage,
            usesByok,
            finalModelName,
            error: errorToLog,
          });
          return handleByokAuthenticationErrorApiGateway("webhook");
        }
        await persistWebhookConversationError({
          db,
          workspaceId,
          agentId,
          uiMessage,
          usesByok,
          finalModelName,
          error: resultError,
          awsRequestId,
        });
        throw resultError;
      }

      // FIX: If tool calls are missing but tool results exist, reconstruct tool calls from results
      if (
        toolCallsFromResult.length === 0 &&
        toolResultsFromResult.length > 0
      ) {
        toolCallsFromResult = reconstructToolCallsFromResults(
          toolResultsFromResult,
          "Webhook Handler"
        ) as unknown as typeof toolCallsFromResult;
      }

      // Format tool calls and results as UI messages
      const toolCallMessages = toolCallsFromResult.map(formatToolCallMessage);
      const toolResultMessages = toolResultsFromResult.map(
        formatToolResultMessage
      );

      // Build assistant response message with reasoning, tool calls, results, and text
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
      assistantContent.push(...reasoningFromSteps);

      // Add tool calls
      for (const toolCallMsg of toolCallMessages) {
        if (Array.isArray(toolCallMsg.content)) {
          assistantContent.push(...toolCallMsg.content);
        }
      }

      // Add tool results
      for (const toolResultMsg of toolResultMessages) {
        if (Array.isArray(toolResultMsg.content)) {
          assistantContent.push(...toolResultMsg.content);
        }
      }

      // Add text response if present
      if (responseContent && responseContent.trim().length > 0) {
        assistantContent.push({ type: "text", text: responseContent });
      }

      // DIAGNOSTIC: Log assistantContent before creating message
      console.log(
        "[Webhook Handler] Assistant content before message creation:",
        {
          assistantContentLength: assistantContent.length,
          assistantContent: assistantContent,
          hasToolCalls: assistantContent.some(
            (item) =>
              typeof item === "object" &&
              item !== null &&
              "type" in item &&
              item.type === "tool-call"
          ),
          hasToolResults: assistantContent.some(
            (item) =>
              typeof item === "object" &&
              item !== null &&
              "type" in item &&
              item.type === "tool-result"
          ),
        }
      );

      // Create assistant message with modelName, provider, costs, and generation time
      // Ensure content is always an array if we have tool calls/results, even if text is empty
      const assistantMessage: UIMessage = {
        role: "assistant",
        content:
          assistantContent.length > 0
            ? assistantContent
            : responseContent || "",
        ...(agentResult.tokenUsage && { tokenUsage: agentResult.tokenUsage }),
        modelName: finalModelName,
        provider: "openrouter",
        ...(agentResult.openrouterGenerationId && {
          openrouterGenerationId: agentResult.openrouterGenerationId,
        }),
        ...(agentResult.provisionalCostUsd !== undefined && {
          provisionalCostUsd: agentResult.provisionalCostUsd,
        }),
        ...(generationTimeMs !== undefined && { generationTimeMs }),
        ...(generationStartedAt && { generationStartedAt }),
        ...(generationEndedAt && { generationEndedAt }),
      };

      // DIAGNOSTIC: Log final assistant message structure
      console.log("[Webhook Handler] Final assistant message:", {
        role: assistantMessage.role,
        contentType: typeof assistantMessage.content,
        isArray: Array.isArray(assistantMessage.content),
        contentLength: Array.isArray(assistantMessage.content)
          ? assistantMessage.content.length
          : "N/A",
        content: assistantMessage.content,
        hasToolCallsInContent: Array.isArray(assistantMessage.content)
          ? assistantMessage.content.some(
              (item) =>
                typeof item === "object" &&
                item !== null &&
                "type" in item &&
                item.type === "tool-call"
            )
          : false,
        hasToolResultsInContent: Array.isArray(assistantMessage.content)
          ? assistantMessage.content.some(
              (item) =>
                typeof item === "object" &&
                item !== null &&
                "type" in item &&
                item.type === "tool-result"
            )
          : false,
      });

      // Log conversation (non-blocking)
      // Each webhook call creates a new conversation
      // tokenUsage already extracted above for credit deduction
      try {
        // Combine user message and assistant message for logging
        // Deduplication will happen in startConversation (via expandMessagesWithToolCalls)
        const messagesForLogging: UIMessage[] = agentResult.observerEvents
          ? buildConversationMessagesFromObserver({
              observerEvents: agentResult.observerEvents,
              fallbackInputMessages: [uiMessage],
              assistantMeta: {
                tokenUsage: agentResult.tokenUsage,
                modelName: finalModelName,
                provider: "openrouter",
                openrouterGenerationId: agentResult.openrouterGenerationId,
                provisionalCostUsd: agentResult.provisionalCostUsd,
                generationTimeMs,
              },
            })
          : [uiMessage, assistantMessage];

        // Get valid messages for logging (filter out any invalid ones, but keep empty messages)
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

        // DIAGNOSTIC: Log messages being passed to startConversation
        console.log(
          "[Webhook Handler] Messages being passed to startConversation:",
          {
            messagesForLoggingCount: messagesForLogging.length,
            validMessagesCount: validMessages.length,
            assistantMessageInValid: validMessages.some(
              (msg) => msg.role === "assistant"
            ),
            messages: validMessages.map((msg) => ({
              role: msg.role,
              contentType: typeof msg.content,
              isArray: Array.isArray(msg.content),
              contentLength: Array.isArray(msg.content)
                ? msg.content.length
                : "N/A",
              hasToolCalls: Array.isArray(msg.content)
                ? msg.content.some(
                    (item) =>
                      typeof item === "object" &&
                      item !== null &&
                      "type" in item &&
                      item.type === "tool-call"
                  )
                : false,
              hasToolResults: Array.isArray(msg.content)
                ? msg.content.some(
                    (item) =>
                      typeof item === "object" &&
                      item !== null &&
                      "type" in item &&
                      item.type === "tool-result"
                  )
                : false,
            })),
          }
        );

        // Use the pre-generated conversationId instead of creating a new one
        // This ensures delegation tracking works correctly (delegation tasks created during
        // the agent call will have the same conversationId)
        const createdConversationId = await startConversation(db, {
          workspaceId,
          agentId,
          conversationId, // Use the pre-generated conversationId
          conversationType: "webhook",
          messages: validMessages,
          tokenUsage: agentResult.tokenUsage,
          usesByok,
          awsRequestId,
        });
        
        // Verify the conversationId matches (should always be the same)
        if (createdConversationId !== conversationId) {
          console.warn(
            "[Webhook Handler] ConversationId mismatch - this should not happen:",
            {
              expected: conversationId,
              actual: createdConversationId,
            }
          );
        }

        // Update transaction buffer with conversationId for any transactions that don't have it
        // This ensures workspace transactions include the conversationId even though they were
        // created before the conversation was logged
        if (context) {
          const buffer = getTransactionBuffer(context);
          if (buffer) {
            updateTransactionBufferConversationId(
              buffer,
              conversationId,
              workspaceId
            );
          }
        }

        // Note: reservationId is handled internally by agentCallNonStreaming
        // The reservation is updated with conversationId during credit adjustment

        // Enqueue cost verification (Step 3) if we have generation IDs
          // Note: reservationId is handled internally by agentCallNonStreaming
          // We need to get it from the context if available, but this is optional
        await enqueueCostVerificationIfNeeded(
            agentResult.openrouterGenerationId, // Keep for backward compat
            agentResult.openrouterGenerationIds, // New parameter
          workspaceId,
            undefined, // reservationId - handled internally by agentCallNonStreaming
          conversationId,
          agentId,
          "webhook"
        );
      } catch (error) {
        // Log error but don't fail the request
        console.error("[Webhook Handler] Error logging conversation:", {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        // Report to Sentry
        Sentry.captureException(ensureError(error), {
          tags: {
            endpoint: "webhook",
            operation: "conversation_logging",
          },
          extra: {
            workspaceId,
            agentId,
          },
        });
      }

      // Track webhook call
      trackBusinessEvent(
        "webhook",
        "called",
        {
          workspace_id: workspaceId,
          agent_id: agentId,
        },
        undefined // Webhooks use API keys, no user context
      );

      // Clean up timeout on success
      cleanupRequestTimeout(requestTimeout);

      // Return plain text response for webhook
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
        },
        body: responseContent,
      };
      } catch (error) {
        // Clean up timeout
        cleanupRequestTimeout(requestTimeout);

        // Check if this is a timeout error
        if (isTimeoutError(error)) {
          const timeoutError = createTimeoutError();
          await persistWebhookConversationError({
            db,
            workspaceId,
            agentId,
            uiMessage,
            usesByok,
            finalModelName,
            error: timeoutError,
            awsRequestId,
          });
          return {
            statusCode: 504,
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              error: timeoutError.message,
            }),
          };
        }

        // Comprehensive error logging for debugging
        logErrorDetails(error, {
          workspaceId,
          agentId,
          usesByok,
          endpoint: "webhook",
        });

        // Normalize BYOK error if needed
        const errorToLog = normalizeByokError(error);

        // Get agent info for error logging
        try {
          const { setupAgentAndTools } = await import("../utils/agentSetup");
          const { agent, usesByok: agentUsesByok } = await setupAgentAndTools(
            workspaceId,
            agentId,
            [],
            {
              modelReferer: "http://localhost:3000/api/webhook",
              callDepth: 0,
              maxDelegationDepth: 3,
              context,
            }
          );
          usesByok = agentUsesByok;
          finalModelName =
            typeof agent.modelName === "string" ? agent.modelName : "openrouter/gemini-2.0-flash-exp";
        } catch {
          // If we can't get agent info, use defaults
          usesByok = undefined;
          finalModelName = undefined;
        }

        await persistWebhookConversationError({
          db,
          workspaceId,
          agentId,
          uiMessage,
          usesByok,
          finalModelName,
          error: errorToLog,
          awsRequestId,
        });

        // Check if this is a BYOK authentication error FIRST
        if (usesByok !== undefined && isByokAuthenticationError(error, usesByok)) {
          return handleByokAuthenticationErrorApiGateway("webhook");
        }

        // Handle credit errors
        const creditErrorResult = await handleCreditErrors(
          error,
          workspaceId,
          "webhook"
        );
        if (creditErrorResult.handled && creditErrorResult.response) {
          return creditErrorResult.response as APIGatewayProxyResultV2;
        }

        // Re-throw error to be handled by error wrapper
        throw error;
      }
    }
  )
);
