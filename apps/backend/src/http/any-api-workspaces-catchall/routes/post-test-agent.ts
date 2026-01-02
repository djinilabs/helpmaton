import { badRequest } from "@hapi/boom";
import type { ModelMessage } from "ai";
import { convertToModelMessages, streamText } from "ai";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import {
  isMessageContentEmpty,
  updateConversation,
  buildConversationErrorInfo,
  type GenerateTextResultWithTotalUsage,
  type StreamTextResultWithResolvedUsage,
} from "../../../utils/conversationLogger";
import { isAuthenticationError } from "../../../utils/handlingErrors";
import { Sentry, ensureError } from "../../../utils/sentry";
import { getContextFromRequestId } from "../../../utils/workspaceCreditContext";
import { setupAgentAndTools } from "../../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/agentSetup";
import { convertAiSdkUIMessagesToUIMessages } from "../../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/messageConversion";
import {
  formatToolCallMessage,
  formatToolResultMessage,
} from "../../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/toolFormatting";
import type { UIMessage } from "../../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/types";
import { MODEL_NAME } from "../../utils/agentUtils";
import {
  adjustCreditsAfterLLMCall,
  cleanupReservationOnError,
  cleanupReservationWithoutTokenUsage,
  enqueueCostVerificationIfNeeded,
  validateAndReserveCredits,
} from "../../utils/generationCreditManagement";
import {
  isByokAuthenticationError,
  normalizeByokError,
  handleByokAuthenticationErrorExpress,
  handleCreditErrorsExpress,
  logErrorDetails,
} from "../../utils/generationErrorHandling";
import { prepareLLMCall } from "../../utils/generationLLMSetup";
import {
  validateSubscriptionAndLimits,
  trackSuccessfulRequest,
} from "../../utils/generationRequestTracking";
import { extractTokenUsageAndCosts } from "../../utils/generationTokenExtraction";
import { extractUserId } from "../../utils/session";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";

/**
 * Sets CORS headers for the test agent endpoint
 * Uses FRONTEND_URL as the allowed origin
 */
function setCorsHeaders(
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const frontendUrl = process.env.FRONTEND_URL;

  // Always set Access-Control-Allow-Origin to FRONTEND_URL
  if (frontendUrl) {
    res.setHeader("Access-Control-Allow-Origin", frontendUrl);
  }

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, PATCH, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, Origin, Accept, X-Conversation-Id"
  );
  next();
}

/**
 * Sets CORS headers on a response object
 * Used to ensure CORS headers are present before sending responses
 */
function applyCorsHeaders(res: express.Response): void {
  const frontendUrl = process.env.FRONTEND_URL;

  // Always set Access-Control-Allow-Origin to FRONTEND_URL
  if (frontendUrl) {
    res.setHeader("Access-Control-Allow-Origin", frontendUrl);
  }

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, PATCH, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, Origin, Accept, X-Conversation-Id"
  );
}

/**
 * Sets CORS headers and sends a JSON response
 * Used for error responses to ensure CORS headers are always present
 */
function sendJsonResponseWithCors(
  res: express.Response,
  statusCode: number,
  data: object
): void {
  applyCorsHeaders(res);
  res.status(statusCode).json(data);
}

async function persistConversationError(options: {
  db: Awaited<ReturnType<typeof database>>;
  workspaceId: string;
  agentId: string;
  conversationId: string;
  messages: UIMessage[];
  usesByok?: boolean;
  finalModelName?: string;
  error: unknown;
  awsRequestId?: string;
}): Promise<void> {
  try {
    const filteredMessages = options.messages.filter(
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
      console.log("[Agent Test Handler] BYOK error before extraction:", {
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
      endpoint: "test",
      metadata: {
        usesByok: options.usesByok,
      },
    });

    // Log extracted error info (especially for BYOK)
    if (options.usesByok) {
      console.log("[Agent Test Handler] BYOK error after extraction:", {
        message: errorInfo.message,
        name: errorInfo.name,
        code: errorInfo.code,
        statusCode: errorInfo.statusCode,
      });
    }

    await updateConversation(
      options.db,
      options.workspaceId,
      options.agentId,
      options.conversationId,
      filteredMessages,
      undefined,
      options.usesByok,
      errorInfo,
      options.awsRequestId,
      "test"
    );
  } catch (logError) {
    console.error(
      "[Agent Test Handler] Failed to persist conversation error:",
      {
        workspaceId: options.workspaceId,
        agentId: options.agentId,
        conversationId: options.conversationId,
        originalError:
          options.error instanceof Error
            ? options.error.message
            : String(options.error),
        logError:
          logError instanceof Error ? logError.message : String(logError),
      }
    );
    Sentry.captureException(ensureError(logError), {
      tags: {
        context: "conversation-logging",
        operation: "persist-error",
        handler: "test-agent",
      },
    });
  }
}

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/test:
 *   post:
 *     summary: Test agent with streaming response
 *     description: Tests an agent by sending messages and receiving a streaming AI response. Handles credit validation, spending limits, and conversation logging.
 *     tags:
 *       - Agents
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: workspaceId
 *         in: path
 *         required: true
 *         description: Workspace ID
 *         schema:
 *           type: string
 *       - name: agentId
 *         in: path
 *         required: true
 *         description: Agent ID
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - messages
 *             properties:
 *               messages:
 *                 type: array
 *                 description: Array of messages in ai-sdk UIMessage format
 *                 items:
 *                   type: object
 *                   properties:
 *                     role:
 *                       type: string
 *                       enum: [user, assistant, system, tool]
 *                     content:
 *                       type: string
 *     responses:
 *       200:
 *         description: Streaming response (Server-Sent Events format)
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 *               description: SSE stream with UI message chunks
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       402:
 *         description: Insufficient credits
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 workspaceId:
 *                   type: string
 *                 required:
 *                   type: number
 *                 available:
 *                   type: number
 *                 currency:
 *                   type: string
 *       429:
 *         description: Spending limit exceeded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 failedLimits:
 *                   type: array
 *                   items:
 *                     type: object
 *       410:
 *         description: Agent not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPostTestAgent = (app: express.Application) => {
  app.options(
    "/api/workspaces/:workspaceId/agents/:agentId/test",
    setCorsHeaders,
    asyncHandler(async (req, res) => {
      res.status(200).end();
    })
  );

  app.post(
    "/api/workspaces/:workspaceId/agents/:agentId/test",
    setCorsHeaders,
    requireAuth,
    requirePermission(PERMISSION_LEVELS.READ),
    asyncHandler(async (req, res) => {
      const { workspaceId, agentId } = req.params;
      const { messages } = req.body;

      if (!workspaceId || !agentId) {
        throw badRequest("workspaceId and agentId are required");
      }

      if (!Array.isArray(messages) || messages.length === 0) {
        throw badRequest("messages array is required");
      }

      // Read and validate X-Conversation-Id header
      const conversationId =
        req.headers["x-conversation-id"] || req.headers["X-Conversation-Id"];
      if (!conversationId || typeof conversationId !== "string") {
        throw badRequest("X-Conversation-Id header is required");
      }

      // Extract AWS request ID from headers or from req.apiGateway.event (serverlessExpress attaches it)
      // Priority: headers first, then req.apiGateway.event.requestContext.requestId
      const awsRequestIdRaw =
        req.headers["x-amzn-requestid"] ||
        req.headers["X-Amzn-Requestid"] ||
        req.headers["x-request-id"] ||
        req.headers["X-Request-Id"] ||
        req.apiGateway?.event?.requestContext?.requestId;
      const awsRequestId = Array.isArray(awsRequestIdRaw)
        ? awsRequestIdRaw[0]
        : awsRequestIdRaw;

      // Get context for workspace credit transactions
      const context = getContextFromRequestId(awsRequestId);
      if (!context) {
        // Log for debugging
        console.error("[post-test-agent] Context not available:", {
          awsRequestId,
          hasApiGateway: !!req.apiGateway,
          hasEvent: !!req.apiGateway?.event,
          requestIdFromEvent: req.apiGateway?.event?.requestContext?.requestId,
          headers: {
            "x-amzn-requestid": req.headers["x-amzn-requestid"],
            "X-Amzn-Requestid": req.headers["X-Amzn-Requestid"],
            "x-request-id": req.headers["x-request-id"],
            "X-Request-Id": req.headers["X-Request-Id"],
          },
        });
        throw new Error(
          "Context not available for workspace credit transactions"
        );
      }

      // Validate subscription and limits
      const subscriptionId = await validateSubscriptionAndLimits(
        workspaceId,
        "test"
      );

      // Extract userId for PostHog tracking
      const userId = extractUserId(req);

      // Setup agent, model, and tools
      const { agent, model, tools, usesByok } = await setupAgentAndTools(
        workspaceId,
        agentId,
        messages,
        {
          callDepth: 0,
          maxDelegationDepth: 3,
          userId,
          context,
          conversationId,
        }
      );

      // Get client-side tool names for filtering tool calls
      const clientToolNames = new Set<string>();
      if (agent.clientTools && Array.isArray(agent.clientTools)) {
        for (const clientTool of agent.clientTools) {
          if (clientTool.name && typeof clientTool.name === "string") {
            clientToolNames.add(clientTool.name);
          }
        }
      }

      // Convert messages to ModelMessage format using ai-sdk utility
      // useChat sends messages in ai-sdk UIMessage format (with 'parts' property)
      // We need to convert them to the format expected by convertToModelMessages
      let modelMessages: ModelMessage[];
      try {
        // Messages from useChat are already in ai-sdk UIMessage format
        // Convert them to ModelMessage format using ai-sdk utility
        modelMessages = convertToModelMessages(
          messages as Array<Omit<import("ai").UIMessage, "id">>
        );
      } catch (error) {
        console.error("[Agent Test Handler] Error converting messages:", {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        throw error;
      }

      // Convert messages to UIMessage format for logging and error persistence
      let convertedMessages: UIMessage[] = [];
      try {
        convertedMessages = convertAiSdkUIMessagesToUIMessages(
          messages as Array<Omit<import("ai").UIMessage, "id">>
        );
      } catch (error) {
        console.error(
          "[Agent Test Handler] Error converting messages to UIMessage:",
          {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          }
        );
        throw error;
      }

      // Derive the model name from the agent's modelName if set, otherwise use default
      const finalModelName =
        typeof agent.modelName === "string" ? agent.modelName : MODEL_NAME;

      // Validate credits, spending limits, and reserve credits before LLM call
      const db = await database();
      let reservationId: string | undefined;
      let llmCallAttempted = false;
      let result: Awaited<ReturnType<typeof streamText>> | undefined;
      let generationStartTime: number | undefined;

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
          "test",
          context,
          conversationId
        );

        // Prepare LLM call (logging and generate options)
        const generateOptions = prepareLLMCall(
          agent,
          tools,
          modelMessages,
          "test",
          workspaceId,
          agentId
        );
        // Track generation time
        generationStartTime = Date.now();
        result = streamText({
          model: model as unknown as Parameters<typeof streamText>[0]["model"],
          system: agent.systemPrompt,
          messages: modelMessages,
          tools,
          ...generateOptions,
        });
        // streamText() returns immediately - mark as attempted
        // Note: streamText() itself doesn't throw, but errors can occur when consuming the stream
        llmCallAttempted = true;
      } catch (error) {
        // Comprehensive error logging for debugging
        logErrorDetails(error, {
          workspaceId,
          agentId,
          usesByok,
          endpoint: "test",
        });

        // Normalize BYOK error if needed
        const errorToLog = normalizeByokError(error);

        await persistConversationError({
          db,
          workspaceId,
          agentId,
          conversationId,
          messages: convertedMessages,
          usesByok,
          finalModelName,
          error: errorToLog,
          awsRequestId:
            typeof awsRequestId === "string" ? awsRequestId : undefined,
        });

        // Check if this is a BYOK authentication error FIRST
        if (isByokAuthenticationError(error, usesByok)) {
          applyCorsHeaders(res);
          handleByokAuthenticationErrorExpress(res, "test");
          return;
        }

        // Handle credit errors
        applyCorsHeaders(res);
        const creditErrorHandled = await handleCreditErrorsExpress(
          error,
          workspaceId,
          res,
          "test"
        );
        if (creditErrorHandled) {
          return;
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
            "test",
            context
          );
        }

        // Re-throw error to be handled by error handler
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
        "test"
      );

      // Get the UI message stream response from streamText result
      // This might throw NoOutputGeneratedError if there was an error during streaming
      let streamResponse: Response;
      try {
        streamResponse = result.toUIMessageStreamResponse();
      } catch (streamError) {
        // Check if this is a BYOK authentication error
        if (usesByok && isAuthenticationError(streamError)) {
          console.log(
            "[Agent Test Handler] BYOK authentication error detected when getting stream response:",
            {
              workspaceId,
              agentId,
              error:
                streamError instanceof Error
                  ? streamError.message
                  : String(streamError),
              errorType:
                streamError instanceof Error
                  ? streamError.constructor.name
                  : typeof streamError,
              errorStringified: JSON.stringify(
                streamError,
                Object.getOwnPropertyNames(streamError)
              ),
            }
          );

          return sendJsonResponseWithCors(res, 400, {
            error:
              "There is a configuration issue with your OpenRouter API key. Please verify that the key is correct and has the necessary permissions.",
          });
        }
        throw streamError;
      }

      // Buffer the stream as it's generated
      const chunks: Uint8Array[] = [];
      const reader = streamResponse.body?.getReader();
      if (!reader) {
        throw new Error("Stream response body is null");
      }

      const decoder = new TextDecoder();
      let streamBuffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);

            // Decode and check for error messages in the stream (for BYOK errors)
            if (usesByok) {
              const chunk = decoder.decode(value, { stream: true });
              streamBuffer += chunk;

              // Check if we have a complete line with an error
              if (streamBuffer.includes("\n")) {
                const lines = streamBuffer.split("\n");
                streamBuffer = lines.pop() || ""; // Keep incomplete line

                for (const line of lines) {
                  if (line.startsWith("data: ")) {
                    try {
                      const jsonStr = line.substring(6);
                      const parsed = JSON.parse(jsonStr);
                      // Check for error messages in the stream
                      if (parsed.type === "error" || parsed.error) {
                        const errorMessage = parsed.error || parsed.message;
                        if (errorMessage && typeof errorMessage === "string") {
                          // Check if it's an authentication error
                          if (
                            errorMessage.toLowerCase().includes("api key") ||
                            errorMessage
                              .toLowerCase()
                              .includes("authentication") ||
                            errorMessage
                              .toLowerCase()
                              .includes("unauthorized") ||
                            errorMessage.toLowerCase().includes("cookie auth")
                          ) {
                            console.log(
                              "[Agent Test Handler] Found authentication error in stream body:",
                              errorMessage
                            );
                            // Create an error object with the message from the stream
                            const streamError = new Error(errorMessage);
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            (streamError as any).data = {
                              error: {
                                message: errorMessage,
                                code: parsed.code || 401,
                              },
                            };
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            (streamError as any).statusCode =
                              parsed.code || 401;

                            await persistConversationError({
                              db,
                              workspaceId,
                              agentId,
                              conversationId,
                              messages: convertedMessages,
                              usesByok,
                              finalModelName,
                              error: streamError,
                              awsRequestId:
                                typeof awsRequestId === "string"
                                  ? awsRequestId
                                  : undefined,
                            });

                            return sendJsonResponseWithCors(res, 400, {
                              error:
                                "There is a configuration issue with your OpenRouter API key. Please verify that the key is correct and has the necessary permissions.",
                            });
                          }
                        }
                      }
                    } catch {
                      // Not JSON or parsing failed, continue
                    }
                  }
                }
              }
            }
          }
        }
      } catch (streamError) {
        // Release the reader lock before handling the error
        reader.releaseLock();

        // Check if this is a BYOK authentication error
        if (usesByok && isAuthenticationError(streamError)) {
          console.log(
            "[Agent Test Handler] BYOK authentication error detected during stream consumption:",
            {
              workspaceId,
              agentId,
              error:
                streamError instanceof Error
                  ? streamError.message
                  : String(streamError),
              errorType:
                streamError instanceof Error
                  ? streamError.constructor.name
                  : typeof streamError,
              errorStringified: JSON.stringify(
                streamError,
                Object.getOwnPropertyNames(streamError)
              ),
            }
          );

          // Log conversation with error before returning
          // This is the ORIGINAL error (AI_APICallError) before it gets wrapped
          await persistConversationError({
            db,
            workspaceId,
            agentId,
            conversationId,
            messages: convertedMessages,
            usesByok,
            finalModelName,
            error: streamError, // This is the original AI_APICallError with data.error.message
          });

          // Return specific error message for BYOK authentication issues
          return sendJsonResponseWithCors(res, 400, {
            error:
              "There is a configuration issue with your OpenRouter API key. Please verify that the key is correct and has the necessary permissions.",
          });
        }

        // Re-throw other stream errors
        throw streamError;
      } finally {
        reader.releaseLock();
      }

      // Combine all chunks into a single buffer
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      const body = new TextDecoder().decode(combined);

      // Check the decoded stream body for error messages (for BYOK errors)
      if (usesByok && body) {
        const lines = body.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const jsonStr = line.substring(6);
              const parsed = JSON.parse(jsonStr);
              // Check for error messages in the stream
              if (parsed.type === "error" || parsed.error) {
                const errorMessage = parsed.error || parsed.message;
                if (errorMessage && typeof errorMessage === "string") {
                  // Check if it's an authentication error
                  if (
                    errorMessage.toLowerCase().includes("api key") ||
                    errorMessage.toLowerCase().includes("authentication") ||
                    errorMessage.toLowerCase().includes("unauthorized") ||
                    errorMessage.toLowerCase().includes("cookie auth")
                  ) {
                    console.log(
                      "[Agent Test Handler] Found authentication error in decoded stream body:",
                      errorMessage
                    );
                    // Create an error object with the message from the stream
                    const streamError = new Error(errorMessage);
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (streamError as any).data = {
                      error: {
                        message: errorMessage,
                        code: parsed.code || 401,
                      },
                    };
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (streamError as any).statusCode = parsed.code || 401;

                    await persistConversationError({
                      db,
                      workspaceId,
                      agentId,
                      conversationId,
                      messages: convertedMessages,
                      usesByok,
                      finalModelName,
                      error: streamError,
                      awsRequestId:
                        typeof awsRequestId === "string"
                          ? awsRequestId
                          : undefined,
                    });

                    return sendJsonResponseWithCors(res, 400, {
                      error:
                        "There is a configuration issue with your OpenRouter API key. Please verify that the key is correct and has the necessary permissions.",
                    });
                  }
                }
              }
            } catch {
              // Not JSON or parsing failed, continue
            }
          }
        }
      }

      // // Convert UI message stream format to data stream format expected by useChat
      // // toUIMessageStreamResponse() returns SSE format with UI message chunks
      // // useChat expects data stream format: 0:${JSON.stringify(text)}\n or 1:${JSON.stringify(toolCall)}\n
      // const lines = body.split("\n");
      // const dataStreamLines: string[] = [];

      // for (let line of lines) {
      //   line = line.trim();
      //   // Skip empty lines (SSE event separators)
      //   if (line === "" || line === "data: [DONE]") {
      //     continue;
      //   }

      //   // Strip "data: " prefix if present (SSE format)
      //   const jsonStr = line.startsWith("data: ")
      //     ? line.substring(6) // Remove "data: " prefix (6 characters)
      //     : line;

      //   try {
      //     // Parse the UI message chunk
      //     const chunk = JSON.parse(jsonStr);

      //     // Convert UI message chunk to data stream format
      //     if (chunk.type === "text-delta" || chunk.type === "text") {
      //       // Text chunk: format as 0:${JSON.stringify(text)}\n
      //       const text = chunk.textDelta || chunk.text || "";
      //       if (text) {
      //         dataStreamLines.push(`0:${JSON.stringify(text)}\n`);
      //       }
      //     } else if (chunk.type === "tool-call") {
      //       // Tool call chunk: format as 1:${JSON.stringify({type: "tool-call", ...})}\n
      //       // Only send client-side tool calls to the client
      //       const toolName = chunk.toolName || "";
      //       if (clientToolNames.has(toolName)) {
      //         const toolCall = {
      //           type: "tool-call",
      //           toolCallId: chunk.toolCallId || "",
      //           toolName: toolName,
      //           args: chunk.args || chunk.input || {},
      //         };
      //         dataStreamLines.push(`1:${JSON.stringify(toolCall)}\n`);
      //       }
      //       // Server-side tool calls are handled automatically by AI SDK, skip them
      //     } else if (chunk.type === "tool-result") {
      //       // Tool results are handled server-side, skip them
      //       continue;
      //     } else if (chunk.type === "data" && chunk.data) {
      //       // Data chunks might contain tool calls
      //       if (chunk.data.type === "tool-call") {
      //         const toolName = chunk.data.toolName || "";
      //         if (clientToolNames.has(toolName)) {
      //           const toolCall = {
      //             type: "tool-call",
      //             toolCallId: chunk.data.toolCallId || "",
      //             toolName: toolName,
      //             args: chunk.data.args || chunk.data.input || {},
      //           };
      //           dataStreamLines.push(`1:${JSON.stringify(toolCall)}\n`);
      //         }
      //       }
      //     }
      //   } catch (parseError) {
      //     // If it's not valid JSON, skip it
      //     console.warn("[Agent Test Handler] Failed to parse chunk:", {
      //       line,
      //       error:
      //         parseError instanceof Error
      //           ? parseError.message
      //           : String(parseError),
      //     });
      //   }
      // }

      // body = dataStreamLines.join("");

      // Extract text, tool calls, tool results, and usage from streamText result
      // streamText result properties are promises that need to be awaited
      // These might throw NoOutputGeneratedError if there was an error during streaming

      // Check if result object has error information before accessing properties
      // The AI SDK might store the original error in the result object's internal state
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultAny = result as any;
      if (usesByok && resultAny) {
        // Check _steps array for errors (AI SDK stores errors in steps)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- error type is unknown
        let foundError: any = undefined;
        if (Array.isArray(resultAny._steps)) {
          for (const step of resultAny._steps) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const stepAny = step as any;
            if (stepAny?.error && isAuthenticationError(stepAny.error)) {
              foundError = stepAny.error;
              break;
            }
          }
        }

        // Also check direct error property
        if (
          !foundError &&
          resultAny.error &&
          isAuthenticationError(resultAny.error)
        ) {
          foundError = resultAny.error;
        }

        // Check baseStream for errors (AI SDK might store errors in the stream)
        if (!foundError && resultAny.baseStream) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const baseStreamAny = resultAny.baseStream as any;
          if (
            baseStreamAny?.error &&
            isAuthenticationError(baseStreamAny.error)
          ) {
            foundError = baseStreamAny.error;
          }
        }

        // Check output for errors
        if (!foundError && resultAny.output) {
          type OutputWithError = {
            error?: Error;
            [key: string]: unknown;
          };
          const outputAny = resultAny.output as OutputWithError;
          if (outputAny?.error && isAuthenticationError(outputAny.error)) {
            foundError = outputAny.error;
          }
        }

        // Deep inspection of result object for debugging
        const deepInspect: Record<string, unknown> = {
          hasError: !!resultAny.error,
          errorType: resultAny.error?.constructor?.name,
          errorMessage: resultAny.error?.message,
          hasData: !!resultAny.error?.data,
          dataErrorMessage: resultAny.error?.data?.error?.message,
          hasSteps: Array.isArray(resultAny._steps),
          stepsLength: Array.isArray(resultAny._steps)
            ? resultAny._steps.length
            : 0,
          hasBaseStream: !!resultAny.baseStream,
          hasOutput: !!resultAny.output,
          foundErrorInSteps: !!foundError,
          foundErrorType: foundError?.constructor?.name,
          foundErrorMessage: foundError?.message,
          foundErrorDataMessage: foundError?.data?.error?.message,
          resultKeys: Object.keys(resultAny || {}),
        };

        // Check all properties of result object for error information
        if (resultAny._steps && Array.isArray(resultAny._steps)) {
          type StepWithError = {
            error?: Error & { data?: unknown };
            [key: string]: unknown;
          };
          deepInspect.stepsDetails = resultAny._steps.map(
            (step: StepWithError, idx: number) => ({
              index: idx,
              hasError: !!step?.error,
              errorType: step?.error?.constructor?.name,
              errorMessage: step?.error?.message,
              errorData: step?.error?.data,
              keys: Object.keys(step || {}),
            })
          );
        }

        // Check baseStream properties
        if (resultAny.baseStream) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const baseStreamAny = resultAny.baseStream as any;
          deepInspect.baseStreamKeys = Object.keys(baseStreamAny || {});
          deepInspect.baseStreamError = baseStreamAny?.error;
        }

        // Check output properties
        if (resultAny.output) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const outputAny = resultAny.output as any;
          deepInspect.outputKeys = Object.keys(outputAny || {});
          deepInspect.outputError = outputAny?.error;
        }

        console.log(
          "[Agent Test Handler] Checking result object for error info before accessing properties:",
          deepInspect
        );

        // If we find an error in the result object or its steps, use it
        if (foundError) {
          console.log(
            "[Agent Test Handler] Found authentication error in result object/steps, logging it"
          );
          await persistConversationError({
            db,
            workspaceId,
            agentId,
            conversationId,
            messages: convertedMessages,
            usesByok,
            finalModelName,
            error: foundError, // This is the original AI_APICallError
            awsRequestId:
              typeof awsRequestId === "string" ? awsRequestId : undefined,
          });

          return sendJsonResponseWithCors(res, 400, {
            error:
              "There is a configuration issue with your OpenRouter API key. Please verify that the key is correct and has the necessary permissions.",
          });
        }
      }

      let responseText: string;
      let toolCallsFromResult: unknown[];
      let toolResultsFromResult: unknown[];
      let usage: unknown;
      let generationTimeMs: number | undefined;

      try {
        // Try to access result.text first to catch any errors early
        // Wrap in Promise.allSettled to see all errors, not just the first one
        // Also extract _steps as the source of truth for tool calls/results
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK generateText result types are complex
        const resultAny = result as any;
        const results = await Promise.allSettled([
          Promise.resolve(result.text).then((t) => t || ""),
          Promise.resolve(result.toolCalls).then((tc) => tc || []),
          Promise.resolve(result.toolResults).then((tr) => tr || []),
          Promise.resolve(result.usage),
          Promise.resolve(resultAny._steps?.status?.value).then((s) => s || []),
        ]);

        // Check if any promises were rejected
        const rejected = results.find((r) => r.status === "rejected");
        if (rejected && rejected.status === "rejected") {
          throw rejected.reason;
        }

        // All promises resolved successfully - calculate generation time
        generationTimeMs =
          generationStartTime !== undefined
            ? Date.now() - generationStartTime
            : undefined;

        // All promises resolved successfully
        responseText =
          results[0].status === "fulfilled" ? results[0].value : "";
        const toolCallsFromResultRaw =
          results[1].status === "fulfilled" ? results[1].value : [];
        const toolResultsFromResultRaw =
          results[2].status === "fulfilled" ? results[2].value : [];
        usage =
          results[3].status === "fulfilled" ? results[3].value : undefined;
        const stepsValue =
          results[4].status === "fulfilled" ? results[4].value : [];

        // Extract tool calls and results from _steps (source of truth for server-side tool execution)
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
                    // Convert AI SDK tool-call format to our format
                    toolCallsFromSteps.push({
                      toolCallId: contentItem.toolCallId,
                      toolName: contentItem.toolName,
                      args: contentItem.input || contentItem.args || {},
                    });
                  } else if (contentItem.type === "tool-result") {
                    // Convert AI SDK tool-result format to our format
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

        // Use _steps as source of truth - prefer tool calls/results from _steps if available
        // Only fall back to direct properties if _steps doesn't have them
        if (toolCallsFromSteps.length > 0) {
          toolCallsFromResult = toolCallsFromSteps;
        } else {
          toolCallsFromResult = Array.isArray(toolCallsFromResultRaw)
            ? toolCallsFromResultRaw
            : [];
        }

        if (toolResultsFromSteps.length > 0) {
          toolResultsFromResult = toolResultsFromSteps;
        } else {
          toolResultsFromResult = Array.isArray(toolResultsFromResultRaw)
            ? toolResultsFromResultRaw
            : [];
        }

        // DIAGNOSTIC: Log tool calls and results extracted from result
        console.log("[Test Agent Handler] Tool calls extracted from result:", {
          toolCallsCount: toolCallsFromResult.length,
          toolCalls: toolCallsFromResult,
          toolResultsCount: toolResultsFromResult.length,
          toolResults: toolResultsFromResult,
          toolCallsFromStepsCount: toolCallsFromSteps.length,
          toolResultsFromStepsCount: toolResultsFromSteps.length,
          toolCallsFromResultRawCount: Array.isArray(toolCallsFromResultRaw)
            ? toolCallsFromResultRaw.length
            : 0,
          toolResultsFromResultRawCount: Array.isArray(toolResultsFromResultRaw)
            ? toolResultsFromResultRaw.length
            : 0,
          resultKeys: Object.keys(result),
          hasToolCalls: "toolCalls" in result,
          hasToolResults: "toolResults" in result,
          hasSteps: "_steps" in result,
          stepsCount: Array.isArray(stepsValue) ? stepsValue.length : 0,
        });

        // FIX: If tool calls are missing but tool results exist, reconstruct tool calls from results
        // This can happen when tools execute synchronously and the AI SDK doesn't populate toolCalls
        if (
          toolCallsFromResult.length === 0 &&
          toolResultsFromResult.length > 0
        ) {
          console.log(
            "[Test Agent Handler] Tool calls missing but tool results exist, reconstructing tool calls from results"
          );
          const { reconstructToolCallsFromResults } = await import(
            "../../utils/generationToolReconstruction"
          );
          toolCallsFromResult = reconstructToolCallsFromResults(
            toolResultsFromResult,
            "Test Agent Handler"
          ) as unknown as typeof toolCallsFromResult;
          console.log(
            "[Test Agent Handler] Reconstructed tool calls:",
            toolCallsFromResult
          );
        }
      } catch (resultError) {
        // Check if this is a BYOK authentication error
        if (usesByok && isAuthenticationError(resultError)) {
          console.log(
            "[Agent Test Handler] BYOK authentication error detected when accessing result properties:",
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
              "[Agent Test Handler] Constructing original AI_APICallError from NoOutputGeneratedError"
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
          await persistConversationError({
            db,
            workspaceId,
            agentId,
            conversationId,
            messages: convertedMessages,
            usesByok,
            finalModelName,
            error: errorToLog,
          });

          return sendJsonResponseWithCors(res, 400, {
            error:
              "There is a configuration issue with your OpenRouter API key. Please verify that the key is correct and has the necessary permissions.",
          });
        }
        await persistConversationError({
          db,
          workspaceId,
          agentId,
          conversationId,
          messages: convertedMessages,
          usesByok,
          finalModelName,
          error: resultError,
          awsRequestId:
            typeof awsRequestId === "string" ? awsRequestId : undefined,
        });
        throw resultError;
      }

      // Extract token usage, generation IDs, and costs
      // result from streamText has totalUsage as a Promise, but we're using usage which is already extracted
      // For streamText, we pass the result with usage already extracted
      const {
        tokenUsage,
        openrouterGenerationId,
        openrouterGenerationIds,
        provisionalCostUsd,
      } = extractTokenUsageAndCosts(
        result as unknown as
          | GenerateTextResultWithTotalUsage
          | StreamTextResultWithResolvedUsage,
        usage,
        finalModelName,
        "test"
      );

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
        "test",
        context,
        conversationId
      );

      // Handle case where no token usage is available
      if (
        reservationId &&
        reservationId !== "byok" &&
        (!tokenUsage ||
          (tokenUsage.promptTokens === 0 && tokenUsage.completionTokens === 0))
      ) {
        await cleanupReservationWithoutTokenUsage(
          db,
          reservationId,
          workspaceId,
          agentId,
          "test"
        );
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
      if (responseText && responseText.trim().length > 0) {
        assistantContent.push({ type: "text", text: responseText });
      }

      // Create assistant message with token usage, modelName, provider, costs, and generation time
      const assistantMessage: UIMessage = {
        role: "assistant",
        content: assistantContent.length > 0 ? assistantContent : responseText,
        ...(tokenUsage && { tokenUsage }),
        modelName: finalModelName,
        provider: "openrouter",
        ...(openrouterGenerationId && { openrouterGenerationId }),
        ...(provisionalCostUsd !== undefined && { provisionalCostUsd }),
        ...(generationTimeMs !== undefined && { generationTimeMs }),
      };

      // Combine user messages and assistant message for logging
      // Deduplication will happen in updateConversation
      const messagesForLogging: UIMessage[] = [
        ...convertedMessages,
        assistantMessage,
      ];

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

      // DIAGNOSTIC: Log messages being passed to updateConversation
      console.log(
        "[Test Agent Handler] Messages being passed to updateConversation:",
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

      // Log conversation (non-blocking) - always update existing conversation
      try {
        await updateConversation(
          db,
          workspaceId,
          agentId,
          conversationId,
          validMessages,
          tokenUsage,
          usesByok,
          undefined,
          typeof awsRequestId === "string" ? awsRequestId : undefined,
          "test"
        );

        // Enqueue cost verification (Step 3) if we have generation IDs
        await enqueueCostVerificationIfNeeded(
          openrouterGenerationId, // Keep for backward compat
          openrouterGenerationIds, // New parameter
          workspaceId,
          reservationId,
          conversationId,
          agentId,
          "test"
        );
      } catch (error) {
        // Log error but don't fail the request
        console.error("[Agent Test Handler] Error logging conversation:", {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          workspaceId,
          agentId,
        });
        // Report to Sentry
        Sentry.captureException(ensureError(error), {
          tags: {
            endpoint: "test",
            operation: "conversation_logging",
          },
          extra: {
            workspaceId,
            agentId,
          },
        });
      }

      // Use headers from the Response object (includes proper SSE Content-Type)
      // toUIMessageStreamResponse() automatically formats the response as SSE
      // where each event is separated by two newlines
      const responseHeaders = streamResponse.headers;
      for (const [key, value] of responseHeaders.entries()) {
        res.setHeader(key, value);
      }

      console.log("[Agent Test Handler] Response body:", body);

      res.status(streamResponse.status).send(body);
    })
  );
};
