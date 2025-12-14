import { badRequest } from "@hapi/boom";
import type { ModelMessage } from "ai";
import { convertToModelMessages, streamText } from "ai";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import {
  extractTokenUsage,
  createOrUpdateConversation,
  type TokenUsage,
} from "../../../utils/conversationLogger";
import {
  InsufficientCreditsError,
  SpendingLimitExceededError,
} from "../../../utils/creditErrors";
import {
  adjustCreditReservation,
  refundReservation,
} from "../../../utils/creditManagement";
import { validateCreditsAndLimitsAndReserve } from "../../../utils/creditValidation";
import { isCreditDeductionEnabled } from "../../../utils/featureFlags";
import {
  checkDailyRequestLimit,
  incrementRequestBucket,
} from "../../../utils/requestTracking";
import {
  checkFreePlanExpiration,
  getWorkspaceSubscription,
} from "../../../utils/subscriptionUtils";
import {
  logToolDefinitions,
  setupAgentAndTools,
} from "../../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/agentSetup";
import type { UIMessage } from "../../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/types";
import { MODEL_NAME, buildGenerateTextOptions } from "../../utils/agentUtils";
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
      const { messages, conversationId: bodyConversationId } = req.body;

      // Extract conversationId from multiple sources (body, headers)
      // Priority: body > headers
      let conversationId = bodyConversationId;

      // Check headers if not found in body
      if (!conversationId) {
        const headerConversationId =
          req.headers["x-conversation-id"] || req.headers["X-Conversation-Id"];
        if (headerConversationId && typeof headerConversationId === "string") {
          conversationId = headerConversationId;
        }
      }

      console.log("[Agent Test Handler] Extracted conversationId:", {
        conversationId: conversationId || "undefined",
        source: bodyConversationId
          ? "body"
          : conversationId
          ? "header"
          : "not found",
        hasBodyConversationId: !!bodyConversationId,
      });

      if (!workspaceId || !agentId) {
        throw badRequest("workspaceId and agentId are required");
      }

      if (!Array.isArray(messages) || messages.length === 0) {
        throw badRequest("messages array is required");
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

      // Setup agent, model, and tools
      const { agent, model, tools, usesByok } = await setupAgentAndTools(
        workspaceId,
        agentId,
        messages,
        {
          callDepth: 0,
          maxDelegationDepth: 3,
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
          "google", // provider
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
          return res.status(error.statusCode).json({
            error: error.message,
            workspaceId: error.workspaceId,
            required: error.required,
            available: error.available,
            currency: error.currency,
          });
        }
        if (error instanceof SpendingLimitExceededError) {
          return res.status(error.statusCode).json({
            error: error.message,
            failedLimits: error.failedLimits,
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
            let errorTokenUsage: TokenUsage | undefined;
            try {
              // Try to extract token usage from error if it has a result property
              if (
                error &&
                typeof error === "object" &&
                "result" in error &&
                error.result
              ) {
                errorTokenUsage = await extractTokenUsage(error.result);
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

      // Extract token usage from streamText result (after stream is consumed)
      // For streamText, usage is a Promise that needs to be awaited
      const tokenUsage = await extractTokenUsage(result);

      // Extract assistant's response
      // First try to get it directly from the result object (most reliable)
      let assistantText: string = "";
      if (result.text && typeof result.text === "string") {
        assistantText = result.text;
      } else {
        // Fallback: parse the SSE stream if result.text is not available
        // The stream is in SSE format: "data: {json}\n\n" or "data: \n{json}\n\n"
        // Find all "data: " markers and extract JSON blocks
        const dataMarker = "data: ";
        let startIndex = 0;

        while (true) {
          const dataIndex = body.indexOf(dataMarker, startIndex);
          if (dataIndex === -1) {
            break;
          }

          // Find the start of the JSON (skip "data: " and any whitespace/newlines)
          let jsonStart = dataIndex + dataMarker.length;
          while (jsonStart < body.length && /\s/.test(body[jsonStart])) {
            jsonStart++;
          }

          // Find the end of this data block (next "data: " or end of string)
          const nextDataIndex = body.indexOf(dataMarker, jsonStart);
          const blockEnd = nextDataIndex === -1 ? body.length : nextDataIndex;

          // Extract and trim the JSON block
          let jsonBlock = body.substring(jsonStart, blockEnd).trim();

          // Remove trailing newlines that might be before the next "data: "
          jsonBlock = jsonBlock.replace(/\n+$/, "");

          if (!jsonBlock || jsonBlock === "[DONE]") {
            startIndex = blockEnd;
            continue;
          }

          try {
            // Parse the JSON block (may span multiple lines)
            const chunk = JSON.parse(jsonBlock);
            // Accumulate text from text-delta or text chunks
            // AI SDK uses "delta" field, not "textDelta"
            if (chunk.type === "text-delta") {
              if (chunk.delta) {
                assistantText += chunk.delta;
              } else if (chunk.textDelta) {
                // Fallback for older format
                assistantText += chunk.textDelta;
              }
            } else if (chunk.type === "text") {
              if (chunk.text) {
                assistantText += chunk.text;
              }
            }
          } catch {
            // Not valid JSON, skip this block
          }

          startIndex = blockEnd;
        }
      }

      // Adjust credit reservation based on actual cost
      // TEMPORARY: This can be disabled via ENABLE_CREDIT_DEDUCTION env var
      if (
        isCreditDeductionEnabled() &&
        reservationId &&
        reservationId !== "byok" &&
        tokenUsage &&
        (tokenUsage.promptTokens > 0 || tokenUsage.completionTokens > 0)
      ) {
        try {
          console.log("[Agent Test Handler] Adjusting credit reservation:", {
            workspaceId,
            reservationId,
            provider: "google",
            modelName: finalModelName,
            tokenUsage,
          });
          await adjustCreditReservation(
            db,
            reservationId,
            workspaceId,
            "google", // provider
            finalModelName,
            tokenUsage,
            3, // maxRetries
            usesByok
          );
          console.log(
            "[Agent Test Handler] Credit reservation adjusted successfully"
          );
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

      // Get valid messages for logging - include both input messages and assistant response
      // Handle both ai-sdk format (with 'parts') and our format (with 'content')
      console.log("[Agent Test Handler] Processing messages for logging:", {
        originalMessageCount: messages.length,
        messages: messages.map((m, i) => ({
          index: i,
          role: m && typeof m === "object" && "role" in m ? m.role : "unknown",
          hasContent: m && typeof m === "object" && "content" in m,
          hasParts: m && typeof m === "object" && "parts" in m,
          contentType:
            m && typeof m === "object" && "content" in m
              ? typeof m.content
              : "none",
        })),
      });

      const validMessages: UIMessage[] = messages
        .filter((msg) => {
          if (!msg || typeof msg !== "object") {
            return false;
          }
          // Check if it has a valid role
          if (!("role" in msg) || typeof msg.role !== "string") {
            return false;
          }
          const role = msg.role;
          if (
            role !== "user" &&
            role !== "assistant" &&
            role !== "system" &&
            role !== "tool"
          ) {
            return false;
          }
          // Accept messages with either 'content' or 'parts' (ai-sdk format)
          return "content" in msg || "parts" in msg;
        })
        .map((msg) => {
          // Convert ai-sdk format (with 'parts') to our format (with 'content')
          if ("parts" in msg && !("content" in msg)) {
            // This is ai-sdk format, convert it
            const parts = (msg as { parts?: unknown[] }).parts;
            if (Array.isArray(parts) && parts.length > 0) {
              // Extract text from parts
              const textParts = parts
                .filter(
                  (part) =>
                    part &&
                    typeof part === "object" &&
                    "type" in part &&
                    part.type === "text" &&
                    "text" in part
                )
                .map((part) => (part as { text: string }).text)
                .join("");
              return {
                ...msg,
                content: textParts || "",
              } as UIMessage;
            }
            // If parts array is empty or doesn't have text, create empty content
            return {
              ...msg,
              content: "",
            } as UIMessage;
          }
          return msg as UIMessage;
        })
        .filter((msg) => {
          // Final validation: ensure message has content (string or array)
          if (!msg || typeof msg !== "object") {
            return false;
          }
          // Accept messages with content (string or array)
          if ("content" in msg) {
            const content = msg.content;
            return (
              typeof content === "string" ||
              Array.isArray(content) ||
              content !== null
            );
          }
          return false;
        });

      // Add assistant's response if we extracted any text
      console.log("[Agent Test Handler] Assistant text extraction:", {
        assistantTextLength: assistantText.length,
        assistantTextPreview: assistantText.substring(0, 100),
        hasAssistantText: assistantText.trim().length > 0,
      });

      if (assistantText && assistantText.trim().length > 0) {
        validMessages.push({
          role: "assistant",
          content: assistantText,
          ...(tokenUsage && { tokenUsage }),
        });
      }

      // Log conversation (non-blocking)
      // Always log messages even if assistant text is empty - user messages should be recorded
      if (validMessages.length === 0) {
        console.warn("[Agent Test Handler] No valid messages to log:", {
          workspaceId,
          agentId,
          originalMessageCount: messages.length,
          messages: messages.map((m) => ({
            role:
              m && typeof m === "object" && "role" in m ? m.role : "unknown",
            hasContent: m && typeof m === "object" && "content" in m,
            hasParts: m && typeof m === "object" && "parts" in m,
          })),
        });
      }

      console.log("[Agent Test Handler] Logging conversation:", {
        workspaceId,
        agentId,
        conversationId: conversationId || "new",
        messageCount: validMessages.length,
        hasAssistantMessage: assistantText.trim().length > 0,
        assistantTextLength: assistantText.length,
        tokenUsage: tokenUsage
          ? {
              promptTokens: tokenUsage.promptTokens,
              completionTokens: tokenUsage.completionTokens,
              totalTokens: tokenUsage.totalTokens,
            }
          : null,
      });

      try {
        await createOrUpdateConversation(
          db,
          workspaceId,
          agentId,
          conversationId &&
            typeof conversationId === "string" &&
            conversationId.trim().length > 0
            ? conversationId
            : undefined,
          validMessages,
          tokenUsage,
          "test",
          MODEL_NAME,
          "google",
          usesByok
        );
      } catch (error) {
        // Log error but don't fail the request
        console.error("[Agent Test Handler] Error logging conversation:", {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          workspaceId,
          agentId,
          conversationId,
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
