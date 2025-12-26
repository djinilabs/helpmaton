import type { ModelMessage } from "ai";
import { generateText } from "ai";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";

import { MODEL_NAME } from "../../http/utils/agentUtils";
import {
  adjustCreditsAfterLLMCall,
  cleanupReservationOnError,
  cleanupReservationWithoutTokenUsage,
  enqueueCostVerificationIfNeeded,
  validateAndReserveCredits,
} from "../../http/utils/generationCreditManagement";
import {
  isByokAuthenticationError,
  normalizeByokError,
  handleByokAuthenticationErrorApiGateway,
  handleCreditErrors,
  logErrorDetails,
} from "../../http/utils/generationErrorHandling";
import { prepareLLMCall } from "../../http/utils/generationLLMSetup";
import {
  validateSubscriptionAndLimits,
  trackSuccessfulRequest,
} from "../../http/utils/generationRequestTracking";
import { extractTokenUsageAndCosts } from "../../http/utils/generationTokenExtraction";
import { reconstructToolCallsFromResults } from "../../http/utils/generationToolReconstruction";
import { database } from "../../tables";
import {
  isMessageContentEmpty,
  startConversation,
  buildConversationErrorInfo,
} from "../../utils/conversationLogger";
import type { TokenUsage } from "../../utils/conversationLogger";
import {
  handlingErrors,
  isAuthenticationError,
} from "../../utils/handlingErrors";
import { adaptHttpHandler } from "../../utils/httpEventAdapter";
import { Sentry, ensureError } from "../../utils/sentry";
import { setupAgentAndTools } from "../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/agentSetup";
import {
  convertTextToUIMessage,
  convertUIMessagesToModelMessages,
} from "../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/messageConversion";
import {
  validateWebhookRequest,
  validateWebhookKey,
} from "../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/requestValidation";
import { processSimpleNonStreamingResponse } from "../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/streaming";
import {
  formatToolCallMessage,
  formatToolResultMessage,
} from "../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/toolFormatting";
import type { UIMessage } from "../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/types";

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
      const errorAny =
        options.error instanceof Error ? (options.error as any) : undefined;

      const causeAny =
        options.error instanceof Error && options.error.cause instanceof Error
          ? (options.error.cause as any)
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
  }
}

export const handler = adaptHttpHandler(
  handlingErrors(
    async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
      // Extract request ID for logging
      const awsRequestId = event.requestContext?.requestId;

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

      // Setup agent, model, and tools with webhook-specific options
      const { agent, model, tools, usesByok } = await setupAgentAndTools(
        workspaceId,
        agentId,
        [], // Webhook doesn't have conversation history
        {
          modelReferer: "http://localhost:3000/api/webhook",
          callDepth: 0,
          maxDelegationDepth: 3,
          searchDocumentsOptions: {
            description:
              "Search workspace documents using semantic vector search. Returns the most relevant document snippets based on the query.",
            queryDescription:
              "The search query or prompt to find relevant document snippets",
            formatResults: (results) => {
              return results
                .map(
                  (result, index) =>
                    `[${index + 1}] Document: ${result.documentName}${
                      result.folderPath ? ` (${result.folderPath})` : ""
                    }\nSimilarity: ${(result.similarity * 100).toFixed(
                      1
                    )}%\nContent:\n${result.snippet}\n`
                )
                .join("\n---\n\n");
            },
          },
        }
      );

      // Log available tools for debugging
      const availableTools = Object.keys(tools);
      console.log(
        `[Webhook Handler] Agent "${agent.name}" (${agentId}) in workspace ${workspaceId} has ${availableTools.length} tool(s) available:`,
        availableTools.join(", ")
      );
      if (agent.notificationChannelId) {
        console.log(
          `[Webhook Handler] Notification channel configured: ${agent.notificationChannelId}`
        );
      }

      // Convert plain text body to UIMessage format, then to ModelMessage format
      const uiMessage = convertTextToUIMessage(bodyText);
      const modelMessages: ModelMessage[] = convertUIMessagesToModelMessages([
        uiMessage,
      ]);

      // Derive the model name from the agent's modelName if set, otherwise use default
      const finalModelName =
        typeof agent.modelName === "string" ? agent.modelName : MODEL_NAME;

      // Validate credits, spending limits, and reserve credits before LLM call
      // TEMPORARY: This check can be disabled via ENABLE_CREDIT_VALIDATION and ENABLE_SPENDING_LIMIT_CHECKS env vars
      const db = await database();
      let reservationId: string | undefined;
      let llmCallAttempted = false;
      let result: Awaited<ReturnType<typeof generateText>> | undefined;
      let tokenUsage: TokenUsage | undefined;
      let openrouterGenerationId: string | undefined;
      let openrouterGenerationIds: string[] | undefined;
      let provisionalCostUsd: number | undefined;
      let generationTimeMs: number | undefined;

      try {
        // Validate credits, spending limits, and reserve credits before LLM call
        reservationId = await validateAndReserveCredits(
          db,
          workspaceId,
          agentId,
          "openrouter", // provider
          finalModelName,
          modelMessages,
          agent.systemPrompt,
          tools,
          usesByok,
          "webhook"
        );

        // Prepare LLM call (logging and generate options)
        const generateOptions = prepareLLMCall(
          agent,
          tools,
          modelMessages,
          "webhook",
          workspaceId,
          agentId
        );
        // Track generation time
        const generationStartTime = Date.now();
        // LLM call succeeded - mark as attempted
        llmCallAttempted = true;
        result = await generateText({
          model: model as unknown as Parameters<
            typeof generateText
          >[0]["model"],
          system: agent.systemPrompt,
          messages: modelMessages,
          tools,
          ...generateOptions,
        });
        generationTimeMs = Date.now() - generationStartTime;

        // Extract token usage, generation IDs, and costs
        const extractionResult = extractTokenUsageAndCosts(
          result,
          undefined,
          finalModelName,
          "webhook"
        );
        tokenUsage = extractionResult.tokenUsage;
        openrouterGenerationId = extractionResult.openrouterGenerationId;
        openrouterGenerationIds = extractionResult.openrouterGenerationIds;
        provisionalCostUsd = extractionResult.provisionalCostUsd;

        // Adjust credit reservation based on actual cost (Step 2)
        await adjustCreditsAfterLLMCall(
          db,
          workspaceId,
          agentId,
          reservationId,
          "openrouter",
          finalModelName,
          tokenUsage,
          usesByok,
          openrouterGenerationId,
          openrouterGenerationIds, // New parameter
          "webhook"
        );

        // Handle case where no token usage is available
        if (
          reservationId &&
          reservationId !== "byok" &&
          (!tokenUsage ||
            (tokenUsage.promptTokens === 0 &&
              tokenUsage.completionTokens === 0))
        ) {
          await cleanupReservationWithoutTokenUsage(
            db,
            reservationId,
            workspaceId,
            agentId,
            "webhook"
          );
        }
      } catch (error) {
        // Comprehensive error logging for debugging
        logErrorDetails(error, {
          workspaceId,
          agentId,
          usesByok,
          endpoint: "webhook",
        });

        // Normalize BYOK error if needed
        const errorToLog = normalizeByokError(error);

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
        if (isByokAuthenticationError(error, usesByok)) {
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

        // Error after reservation but before or during LLM call
        if (reservationId && reservationId !== "byok") {
          await cleanupReservationOnError(
            db,
            reservationId,
            workspaceId,
            agentId,
            "openrouter",
            finalModelName,
            error,
            llmCallAttempted,
            usesByok,
            "webhook"
          );
        }

        // Re-throw error to be handled by error wrapper
        throw error;
      }

      // If we get here, the LLM call succeeded
      if (!result) {
        throw new Error("LLM call succeeded but result is undefined");
      }

      // Track successful LLM request
      await trackSuccessfulRequest(
        subscriptionId,
        workspaceId,
        agentId,
        "webhook"
      );

      // Process simple non-streaming response (no tool continuation)
      // This might throw NoOutputGeneratedError if there was an error during generation
      let responseContent: string;
      try {
        responseContent = await processSimpleNonStreamingResponse(result);
      } catch (resultError) {
        // Check if this is a BYOK authentication error
        if (usesByok && isAuthenticationError(resultError)) {
          console.log(
            "[Webhook Handler] BYOK authentication error detected when processing response:",
            {
              workspaceId,
              agentId,
              error:
                resultError instanceof Error
                  ? resultError.message
                  : String(resultError),
              errorType:
                resultError instanceof Error
                  ? resultError.constructor.name
                  : typeof resultError,
              errorStringified: JSON.stringify(
                resultError,
                Object.getOwnPropertyNames(resultError)
              ),
            }
          );

          // For BYOK, when we get a NoOutputGeneratedError, it's almost always because
          // the original AI_APICallError was thrown but not preserved.
          // We need to manually construct the original error with the proper structure.
          let errorToLog = resultError;

          // If it's a NoOutputGeneratedError, construct the original AI_APICallError
          if (
            resultError instanceof Error &&
            (resultError.constructor.name === "NoOutputGeneratedError" ||
              resultError.name === "AI_NoOutputGeneratedError" ||
              resultError.message.includes("No output generated"))
          ) {
            console.log(
              "[Webhook Handler] Constructing original AI_APICallError from NoOutputGeneratedError"
            );
            // Create a synthetic AI_APICallError with the proper structure
            const originalError = new Error("No cookie auth credentials found");
            originalError.name = "AI_APICallError";
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const errorAny = originalError as any;
            errorAny.statusCode = 401;
            errorAny.data = {
              error: {
                code: 401,
                message: "No cookie auth credentials found",
                type: null,
                param: null,
              },
            };
            errorAny.responseBody =
              '{"error":{"message":"No cookie auth credentials found","code":401}}';
            errorToLog = originalError;
          }

          // Log conversation with error before returning
          await persistWebhookConversationError({
            db,
            workspaceId,
            agentId,
            uiMessage,
            usesByok,
            finalModelName,
            error: errorToLog,
          });

          return {
            statusCode: 400,
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
            },
            body: "There is a configuration issue with your OpenRouter API key. Please verify that the key is correct and has the necessary permissions.",
          };
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

      // Extract tool calls and results from generateText result
      // These might throw NoOutputGeneratedError if there was an error during generation
      let toolCallsFromResult: unknown[];
      let toolResultsFromResult: unknown[];
      try {
        // Also extract steps/_steps as the source of truth for tool calls/results
        // generateText returns result.steps (array), streamText returns result._steps.status.value
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK generateText result types are complex
        const resultAny = result as any;
        // Check both result.steps (generateText) and result._steps.status.value (streamText)
        const stepsValue = Array.isArray(resultAny.steps)
          ? resultAny.steps
          : resultAny._steps?.status?.value;

        // Extract tool calls and results from steps (source of truth for server-side tool execution)
        const toolCallsFromSteps: unknown[] = [];
        const toolResultsFromSteps: unknown[] = [];

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
                      // Convert AI SDK tool-call format to our format
                      toolCallsFromSteps.push({
                        toolCallId: contentItem.toolCallId,
                        toolName: contentItem.toolName,
                        args: contentItem.input || contentItem.args || {},
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
                      toolResultsFromSteps.push({
                        toolCallId: contentItem.toolCallId,
                        toolName: contentItem.toolName,
                        output:
                          resultValue ||
                          contentItem.output ||
                          contentItem.result,
                        result: resultValue || contentItem.result,
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
          toolCallsFromResult = result.toolCalls || [];
        }

        if (toolResultsFromSteps.length > 0) {
          toolResultsFromResult = toolResultsFromSteps;
        } else {
          toolResultsFromResult = result.toolResults || [];
        }

        // DIAGNOSTIC: Log tool calls and results extracted from result
        console.log("[Webhook Handler] Tool calls extracted from result:", {
          toolCallsCount: toolCallsFromResult.length,
          toolCalls: toolCallsFromResult,
          toolResultsCount: toolResultsFromResult.length,
          toolResults: toolResultsFromResult,
          resultKeys: Object.keys(result),
          hasToolCalls: "toolCalls" in result,
          hasToolResults: "toolResults" in result,
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

      // Build assistant response message with tool calls, results, and text
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
        ...(tokenUsage && { tokenUsage }),
        modelName: finalModelName,
        provider: "openrouter",
        ...(openrouterGenerationId && { openrouterGenerationId }),
        ...(provisionalCostUsd !== undefined && { provisionalCostUsd }),
        ...(generationTimeMs !== undefined && { generationTimeMs }),
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
        const messagesForLogging: UIMessage[] = [uiMessage, assistantMessage];

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

        const conversationId = await startConversation(db, {
          workspaceId,
          agentId,
          conversationType: "webhook",
          messages: validMessages,
          tokenUsage,
          usesByok,
          awsRequestId,
        });

        // Enqueue cost verification (Step 3) if we have generation IDs
        await enqueueCostVerificationIfNeeded(
          openrouterGenerationId, // Keep for backward compat
          openrouterGenerationIds, // New parameter
          workspaceId,
          reservationId,
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

      // Return plain text response for webhook
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
        },
        body: responseContent,
      };
    }
  )
);
