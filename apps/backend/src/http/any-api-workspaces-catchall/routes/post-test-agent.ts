import { badRequest } from "@hapi/boom";
import type { ModelMessage } from "ai";
import { convertToModelMessages, streamText } from "ai";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { sendAgentErrorNotification } from "../../../utils/agentErrorNotifications";
import {
  extractTokenUsage,
  isMessageContentEmpty,
  updateConversation,
} from "../../../utils/conversationLogger";
import {
  InsufficientCreditsError,
  SpendingLimitExceededError,
} from "../../../utils/creditErrors";
import {
  adjustCreditReservation,
  enqueueCostVerification,
  refundReservation,
} from "../../../utils/creditManagement";
import { validateCreditsAndLimitsAndReserve } from "../../../utils/creditValidation";
import { extractOpenRouterGenerationId } from "../../../utils/openrouterUtils";
import { isCreditDeductionEnabled } from "../../../utils/featureFlags";
import {
  checkDailyRequestLimit,
  incrementRequestBucket,
} from "../../../utils/requestTracking";
import { Sentry, ensureError } from "../../../utils/sentry";
import {
  checkFreePlanExpiration,
  getWorkspaceSubscription,
} from "../../../utils/subscriptionUtils";
import {
  logToolDefinitions,
  setupAgentAndTools,
} from "../../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/agentSetup";
import { convertAiSdkUIMessagesToUIMessages } from "../../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/messageConversion";
import {
  formatToolCallMessage,
  formatToolResultMessage,
} from "../../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/toolFormatting";
import type { UIMessage } from "../../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/types";
import { MODEL_NAME, buildGenerateTextOptions } from "../../utils/agentUtils";
import { extractUserId } from "../../utils/session";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";

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
  app.post(
    "/api/workspaces/:workspaceId/agents/:agentId/test",
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

      // Check if free plan has expired (block agent execution if expired)
      await checkFreePlanExpiration(workspaceId);

      // Check daily request limit before LLM call
      // Note: This is a soft limit - there's a small race condition window where
      // concurrent requests near the limit could all pass the check before incrementing.
      // This is acceptable as a user experience limit, not a security boundary.
      const subscription = await getWorkspaceSubscription(workspaceId);
      const subscriptionId = subscription
        ? subscription.pk.replace("subscriptions/", "")
        : undefined;
      if (subscriptionId) {
        console.log("[Agent Test Handler] Found subscription:", subscriptionId);
        await checkDailyRequestLimit(subscriptionId);
      } else {
        console.warn(
          "[Agent Test Handler] No subscription found for workspace:",
          workspaceId
        );
      }

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

      // Derive the model name from the agent's modelName if set, otherwise use default
      const finalModelName =
        typeof agent.modelName === "string" ? agent.modelName : MODEL_NAME;

      // Validate credits, spending limits, and reserve credits before LLM call
      const db = await database();
      let reservationId: string | undefined;
      let llmCallAttempted = false;
      let result: Awaited<ReturnType<typeof streamText>> | undefined;

      try {
        // Convert tools object to array format for estimation
        const toolDefinitions = tools
          ? Object.entries(tools).map(([name, tool]) => {
              const typedTool = tool as {
                description?: string;
                inputSchema?: unknown;
              };
              return {
                name,
                description: typedTool.description || "",
                parameters: typedTool.inputSchema || {},
              };
            })
          : undefined;

        const reservation = await validateCreditsAndLimitsAndReserve(
          db,
          workspaceId,
          agentId,
          "openrouter", // provider
          finalModelName,
          modelMessages,
          agent.systemPrompt,
          toolDefinitions,
          usesByok
        );

        if (reservation) {
          reservationId = reservation.reservationId;
          console.log("[Agent Test Handler] Credits reserved:", {
            workspaceId,
            reservationId,
            reservedAmount: reservation.reservedAmount,
          });
        }

        // Generate AI response (streaming)
        const generateOptions = buildGenerateTextOptions(agent);
        console.log(
          "[Agent Test Handler] Executing streamText with parameters:",
          {
            workspaceId,
            agentId,
            model: finalModelName,
            systemPromptLength: agent.systemPrompt.length,
            messagesCount: modelMessages.length,
            toolsCount: tools ? Object.keys(tools).length : 0,
            ...generateOptions,
          }
        );
        // Log tool definitions before LLM call
        if (tools) {
          logToolDefinitions(tools, "Agent Test Handler", agent);
        }
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
        // Handle errors based on when they occurred
        if (error instanceof InsufficientCreditsError) {
          // Send email notification (non-blocking)
          try {
            await sendAgentErrorNotification(workspaceId, "credit", error);
          } catch (emailError) {
            // Log but don't fail request
            console.error(
              "[Agent Test Handler] Failed to send error notification:",
              emailError
            );
          }

          // Return sanitized error to user
          return res.status(402).json({
            error:
              "Request could not be completed due to service limits. Please contact your workspace administrator.",
          });
        }
        if (error instanceof SpendingLimitExceededError) {
          // Send email notification (non-blocking)
          try {
            await sendAgentErrorNotification(
              workspaceId,
              "spendingLimit",
              error
            );
          } catch (emailError) {
            // Log but don't fail request
            console.error(
              "[Agent Test Handler] Failed to send error notification:",
              emailError
            );
          }

          // Return sanitized error to user
          return res.status(402).json({
            error:
              "Request could not be completed due to service limits. Please contact your workspace administrator.",
          });
        }

        // Error after reservation but before or during LLM call
        // If llmCallAttempted is false, the error occurred before streamText() was called
        // If llmCallAttempted is true, the error occurred when consuming the stream
        if (reservationId && reservationId !== "byok") {
          if (!llmCallAttempted) {
            // Error before LLM call - refund reservation
            try {
              console.log(
                "[Agent Test Handler] Error before LLM call, refunding reservation:",
                {
                  workspaceId,
                  reservationId,
                  error: error instanceof Error ? error.message : String(error),
                }
              );
              await refundReservation(db, reservationId);
            } catch (refundError) {
              // Log but don't fail - refund is best effort
              console.error(
                "[Agent Test Handler] Error refunding reservation:",
                {
                  reservationId,
                  error:
                    refundError instanceof Error
                      ? refundError.message
                      : String(refundError),
                }
              );
            }
          } else {
            // Error after LLM call - try to get token usage from error if available
            // If model error without token usage, assume reserved credits were consumed
            let errorTokenUsage:
              | ReturnType<typeof extractTokenUsage>
              | undefined;
            try {
              // Try to extract token usage from error if it has a result property
              if (
                error &&
                typeof error === "object" &&
                "result" in error &&
                error.result
              ) {
                errorTokenUsage = extractTokenUsage(error.result);
              }
            } catch {
              // Ignore extraction errors
            }

            if (
              isCreditDeductionEnabled() &&
              errorTokenUsage &&
              (errorTokenUsage.promptTokens > 0 ||
                errorTokenUsage.completionTokens > 0)
            ) {
              // We have token usage - adjust reservation
              try {
                await adjustCreditReservation(
                  db,
                  reservationId,
                  workspaceId,
                  "google",
                  finalModelName,
                  errorTokenUsage,
                  3,
                  usesByok
                );
              } catch (adjustError) {
                console.error(
                  "[Agent Test Handler] Error adjusting reservation after error:",
                  adjustError
                );
              }
            } else {
              // No token usage available - assume reserved credits were consumed
              console.warn(
                "[Agent Test Handler] Model error without token usage, assuming reserved credits consumed:",
                {
                  workspaceId,
                  reservationId,
                  error: error instanceof Error ? error.message : String(error),
                }
              );
              // Delete reservation without refund
              try {
                const reservationPk = `credit-reservations/${reservationId}`;
                await db["credit-reservations"].delete(reservationPk);
              } catch (deleteError) {
                console.warn(
                  "[Agent Test Handler] Error deleting reservation:",
                  deleteError
                );
              }
            }
          }
        }

        // Re-throw error to be handled by error handler
        throw error;
      }

      // If we get here, the LLM call succeeded
      if (!result) {
        throw new Error("LLM call succeeded but result is undefined");
      }

      // Track successful LLM request (increment bucket)
      if (subscriptionId) {
        try {
          console.log(
            "[Agent Test Handler] Incrementing request bucket for subscription:",
            subscriptionId
          );
          await incrementRequestBucket(subscriptionId);
          console.log(
            "[Agent Test Handler] Successfully incremented request bucket:",
            subscriptionId
          );
        } catch (error) {
          // Log error but don't fail the request
          console.error(
            "[Agent Test Handler] Error incrementing request bucket:",
            {
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
              workspaceId,
              agentId,
              subscriptionId,
            }
          );
          // Report to Sentry
          Sentry.captureException(ensureError(error), {
            tags: {
              endpoint: "test",
              operation: "request_tracking",
            },
            extra: {
              workspaceId,
              agentId,
              subscriptionId,
            },
          });
        }
      } else {
        console.warn(
          "[Agent Test Handler] Skipping request bucket increment - no subscription ID:",
          { workspaceId, agentId }
        );
      }

      // Get the UI message stream response from streamText result
      const streamResponse = result.toUIMessageStreamResponse();

      // Buffer the stream as it's generated
      const chunks: Uint8Array[] = [];
      const reader = streamResponse.body?.getReader();
      if (!reader) {
        throw new Error("Stream response body is null");
      }

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
          }
        }
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
      const [responseText, toolCallsFromResult, toolResultsFromResult, usage] =
        await Promise.all([
          Promise.resolve(result.text).then((t) => t || ""),
          Promise.resolve(result.toolCalls).then((tc) => tc || []),
          Promise.resolve(result.toolResults).then((tr) => tr || []),
          Promise.resolve(result.usage),
        ]);

      // Extract token usage from streamText result (after stream is consumed and usage is awaited)
      const tokenUsage = extractTokenUsage({ ...result, usage });

      // Extract OpenRouter generation ID for cost verification
      const openrouterGenerationId = extractOpenRouterGenerationId({
        ...result,
        usage,
      });

      // Log token usage for debugging
      console.log("[Agent Test Handler] Extracted token usage:", {
        tokenUsage,
        usage,
        hasUsage: !!usage,
        openrouterGenerationId,
      });

      // Adjust credit reservation based on actual cost (Step 2)
      // TEMPORARY: This can be disabled via ENABLE_CREDIT_DEDUCTION env var
      if (
        isCreditDeductionEnabled() &&
        reservationId &&
        reservationId !== "byok" &&
        tokenUsage &&
        (tokenUsage.promptTokens > 0 || tokenUsage.completionTokens > 0)
      ) {
        try {
          console.log("[Agent Test Handler] Step 2: Adjusting credit reservation:", {
            workspaceId,
            reservationId,
            provider: "openrouter",
            modelName: finalModelName,
            tokenUsage,
            openrouterGenerationId,
          });
          await adjustCreditReservation(
            db,
            reservationId,
            workspaceId,
            "openrouter", // provider
            finalModelName,
            tokenUsage,
            3, // maxRetries
            usesByok,
            openrouterGenerationId
          );
          console.log(
            "[Agent Test Handler] Step 2: Credit reservation adjusted successfully"
          );

          // Enqueue cost verification (Step 3) if we have a generation ID
          if (openrouterGenerationId) {
            await enqueueCostVerification(
              reservationId,
              openrouterGenerationId,
              workspaceId
            );
            console.log(
              "[Agent Test Handler] Step 3: Cost verification enqueued"
            );
          } else {
            console.warn(
              "[Agent Test Handler] No OpenRouter generation ID found, skipping cost verification"
            );
          }
        } catch (error) {
          // Log error but don't fail the request
          console.error(
            "[Agent Test Handler] Error adjusting credit reservation:",
            {
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
              workspaceId,
              agentId,
              reservationId,
              tokenUsage,
            }
          );
          // Report to Sentry
          Sentry.captureException(ensureError(error), {
            tags: {
              endpoint: "test",
              operation: "credit_adjustment",
            },
            extra: {
              workspaceId,
              agentId,
              reservationId,
              tokenUsage,
            },
          });
        }
      } else {
        if (!isCreditDeductionEnabled()) {
          console.log(
            "[Agent Test Handler] Credit deduction disabled via feature flag, skipping adjustment:",
            {
              workspaceId,
              agentId,
              reservationId,
              tokenUsage,
            }
          );
        } else if (!reservationId || reservationId === "byok") {
          console.log(
            "[Agent Test Handler] No reservation (BYOK), skipping adjustment:",
            {
              workspaceId,
              agentId,
              reservationId,
            }
          );
        } else {
          // No token usage after successful call - keep estimated cost (delete reservation)
          // This keeps the estimated cost deducted, which is correct since we can't determine actual cost
          console.warn(
            "[Agent Test Handler] No token usage available after successful call, keeping estimated cost:",
            {
              tokenUsage,
              workspaceId,
              agentId,
              reservationId,
            }
          );
          // Delete reservation without refund (estimated cost remains deducted)
          try {
            const reservationPk = `credit-reservations/${reservationId}`;
            await db["credit-reservations"].delete(reservationPk);
          } catch (deleteError) {
            console.warn(
              "[Agent Test Handler] Error deleting reservation:",
              deleteError
            );
          }
        }
      }

      // Convert messages from ai-sdk format (with 'parts') to our format (with 'content')
      const convertedMessages = convertAiSdkUIMessagesToUIMessages(messages);

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

      // Create assistant message with token usage, modelName, and provider
      const assistantMessage: UIMessage = {
        role: "assistant",
        content: assistantContent.length > 0 ? assistantContent : responseText,
        ...(tokenUsage && { tokenUsage }),
        modelName: finalModelName,
        provider: "google",
      };

      // Combine user messages and assistant message for logging
      // Deduplication will happen in updateConversation
      const messagesForLogging: UIMessage[] = [
        ...convertedMessages,
        assistantMessage,
      ];

      // Get valid messages for logging (filter out any invalid ones and empty messages)
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
          "content" in msg &&
          !isMessageContentEmpty(msg)
      );

      // Log conversation (non-blocking) - always update existing conversation
      try {
        await updateConversation(
          db,
          workspaceId,
          agentId,
          conversationId,
          validMessages,
          tokenUsage
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
