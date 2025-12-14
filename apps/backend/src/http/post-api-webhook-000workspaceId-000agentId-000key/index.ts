import type { ModelMessage } from "ai";
import { generateText } from "ai";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";

import {
  MODEL_NAME,
  buildGenerateTextOptions,
} from "../../http/utils/agentUtils";
import { database } from "../../tables";
import {
  extractTokenUsage,
  startConversation,
  type TokenUsage,
} from "../../utils/conversationLogger";
import {
  InsufficientCreditsError,
  SpendingLimitExceededError,
} from "../../utils/creditErrors";
import {
  adjustCreditReservation,
  refundReservation,
} from "../../utils/creditManagement";
import { validateCreditsAndLimitsAndReserve } from "../../utils/creditValidation";
import { isCreditDeductionEnabled } from "../../utils/featureFlags";
import { handlingErrors } from "../../utils/handlingErrors";
import { adaptHttpHandler } from "../../utils/httpEventAdapter";
import {
  checkDailyRequestLimit,
  incrementRequestBucket,
} from "../../utils/requestTracking";
import {
  checkFreePlanExpiration,
  getWorkspaceSubscription,
} from "../../utils/subscriptionUtils";
import {
  logToolDefinitions,
  setupAgentAndTools,
} from "../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/agentSetup";
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

export const handler = adaptHttpHandler(
  handlingErrors(
    async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
      // Validate request
      const { workspaceId, agentId, key, bodyText } =
        validateWebhookRequest(event);

      // Validate webhook key
      await validateWebhookKey(workspaceId, agentId, key);

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
        console.log("[Webhook Handler] Found subscription:", subscriptionId);
        await checkDailyRequestLimit(subscriptionId);
      } else {
        console.warn(
          "[Webhook Handler] No subscription found for workspace:",
          workspaceId
        );
      }

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

      // Validate credits, spending limits, and reserve credits before LLM call
      // TEMPORARY: This check can be disabled via ENABLE_CREDIT_VALIDATION and ENABLE_SPENDING_LIMIT_CHECKS env vars
      const db = await database();
      let reservationId: string | undefined;
      let llmCallAttempted = false;
      let result: Awaited<ReturnType<typeof generateText>> | undefined;
      let tokenUsage: TokenUsage | undefined;

      try {
        // Convert tools object to array format for estimation
        // Tools from AI SDK have inputSchema instead of parameters
        const toolDefinitions = tools
          ? Object.entries(tools).map(([name, tool]) => ({
              name,
              description: tool.description || "",
              parameters: (tool as { inputSchema?: unknown }).inputSchema || {},
            }))
          : undefined;

        const reservation = await validateCreditsAndLimitsAndReserve(
          db,
          workspaceId,
          agentId,
          "google", // provider
          MODEL_NAME,
          modelMessages,
          agent.systemPrompt,
          toolDefinitions,
          usesByok
        );

        if (reservation) {
          reservationId = reservation.reservationId;
          console.log("[Webhook Handler] Credits reserved:", {
            workspaceId,
            reservationId,
            reservedAmount: reservation.reservedAmount,
          });
        }

        // Generate AI response (non-streaming)
        const generateOptions = buildGenerateTextOptions(agent);
        console.log(
          "[Webhook Handler] Executing generateText with parameters:",
          {
            workspaceId,
            agentId,
            model: MODEL_NAME,
            systemPromptLength: agent.systemPrompt.length,
            messagesCount: modelMessages.length,
            toolsCount: tools ? Object.keys(tools).length : 0,
            ...generateOptions,
          }
        );
        // Log tool definitions before LLM call
        if (tools) {
          logToolDefinitions(tools, "Webhook Handler", agent);
        }
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

        // Extract token usage
        tokenUsage = await extractTokenUsage(result);
        console.log("[Webhook Handler] Token usage extracted:", {
          tokenUsage,
          hasTokenUsage: !!tokenUsage,
          promptTokens: tokenUsage?.promptTokens,
          completionTokens: tokenUsage?.completionTokens,
          totalTokens: tokenUsage?.totalTokens,
        });

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
            console.log("[Webhook Handler] Adjusting credit reservation:", {
              workspaceId,
              reservationId,
              provider: "google",
              modelName: MODEL_NAME,
              tokenUsage,
            });
            await adjustCreditReservation(
              db,
              reservationId,
              workspaceId,
              "google", // provider
              MODEL_NAME,
              tokenUsage,
              3, // maxRetries
              usesByok
            );
            console.log(
              "[Webhook Handler] Credit reservation adjusted successfully"
            );
          } catch (error) {
            // Log error but don't fail the request
            console.error(
              "[Webhook Handler] Error adjusting credit reservation:",
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
              "[Webhook Handler] Credit deduction disabled via feature flag, skipping adjustment:",
              {
                workspaceId,
                agentId,
                reservationId,
                tokenUsage,
              }
            );
          } else if (!reservationId || reservationId === "byok") {
            console.log(
              "[Webhook Handler] No reservation (BYOK), skipping adjustment:",
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
              "[Webhook Handler] No token usage available after successful call, keeping estimated cost:",
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
                "[Webhook Handler] Error deleting reservation:",
                deleteError
              );
            }
          }
        }
      } catch (error) {
        // Handle errors based on when they occurred
        if (
          error instanceof InsufficientCreditsError ||
          error instanceof SpendingLimitExceededError
        ) {
          // Error during validation/reservation - no refund needed
          return {
            statusCode: error.statusCode,
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
            },
            body: error.message,
          };
        }

        // Error after reservation but before or during LLM call
        if (reservationId && reservationId !== "byok") {
          if (!llmCallAttempted) {
            // Error before LLM call - refund reservation
            try {
              console.log(
                "[Webhook Handler] Error before LLM call, refunding reservation:",
                {
                  workspaceId,
                  reservationId,
                  error: error instanceof Error ? error.message : String(error),
                }
              );
              await refundReservation(db, reservationId);
            } catch (refundError) {
              // Log but don't fail - refund is best effort
              console.error("[Webhook Handler] Error refunding reservation:", {
                reservationId,
                error:
                  refundError instanceof Error
                    ? refundError.message
                    : String(refundError),
              });
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
                  MODEL_NAME,
                  errorTokenUsage,
                  3,
                  usesByok
                );
              } catch (adjustError) {
                console.error(
                  "[Webhook Handler] Error adjusting reservation after error:",
                  adjustError
                );
              }
            } else {
              // No token usage available - assume reserved credits were consumed
              console.warn(
                "[Webhook Handler] Model error without token usage, assuming reserved credits consumed:",
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
                  "[Webhook Handler] Error deleting reservation:",
                  deleteError
                );
              }
            }
          }
        }

        // Re-throw error to be handled by error wrapper
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
            "[Webhook Handler] Incrementing request bucket for subscription:",
            subscriptionId
          );
          await incrementRequestBucket(subscriptionId);
          console.log(
            "[Webhook Handler] Successfully incremented request bucket:",
            subscriptionId
          );
        } catch (error) {
          // Log error but don't fail the request
          console.error(
            "[Webhook Handler] Error incrementing request bucket:",
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
          "[Webhook Handler] Skipping request bucket increment - no subscription ID:",
          { workspaceId, agentId }
        );
      }

      // Process simple non-streaming response (no tool continuation)
      const responseContent = await processSimpleNonStreamingResponse(result);

      // Extract tool calls and results from generateText result
      const toolCallsFromResult = result.toolCalls || [];
      const toolResultsFromResult = result.toolResults || [];

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

      // Create assistant message
      const assistantMessage: UIMessage = {
        role: "assistant",
        content:
          assistantContent.length > 0 ? assistantContent : responseContent,
      };

      // Log conversation (non-blocking)
      // Each webhook call creates a new conversation
      // tokenUsage already extracted above for credit deduction
      try {
        await startConversation(db, {
          workspaceId,
          agentId,
          conversationType: "webhook",
          messages: [uiMessage, assistantMessage],
          tokenUsage,
          modelName: MODEL_NAME,
          provider: "google",
          usesByok,
        });
      } catch (error) {
        // Log error but don't fail the request
        console.error("[Webhook Handler] Error logging conversation:", {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
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
