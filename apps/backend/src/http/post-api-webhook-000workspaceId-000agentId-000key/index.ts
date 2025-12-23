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
import { sendAgentErrorNotification } from "../../utils/agentErrorNotifications";
import {
  extractTokenUsage,
  isMessageContentEmpty,
  startConversation,
} from "../../utils/conversationLogger";
import {
  InsufficientCreditsError,
  SpendingLimitExceededError,
} from "../../utils/creditErrors";
import {
  adjustCreditReservation,
  enqueueCostVerification,
  refundReservation,
} from "../../utils/creditManagement";
import { validateCreditsAndLimitsAndReserve } from "../../utils/creditValidation";
import { isCreditDeductionEnabled } from "../../utils/featureFlags";
import { handlingErrors } from "../../utils/handlingErrors";
import { adaptHttpHandler } from "../../utils/httpEventAdapter";
import { extractOpenRouterGenerationId } from "../../utils/openrouterUtils";
import {
  checkDailyRequestLimit,
  incrementRequestBucket,
} from "../../utils/requestTracking";
import { Sentry, ensureError } from "../../utils/sentry";
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

      // Derive the model name from the agent's modelName if set, otherwise use default
      const finalModelName =
        typeof agent.modelName === "string" ? agent.modelName : MODEL_NAME;

      // Validate credits, spending limits, and reserve credits before LLM call
      // TEMPORARY: This check can be disabled via ENABLE_CREDIT_VALIDATION and ENABLE_SPENDING_LIMIT_CHECKS env vars
      const db = await database();
      let reservationId: string | undefined;
      let llmCallAttempted = false;
      let result: Awaited<ReturnType<typeof generateText>> | undefined;
      let tokenUsage: ReturnType<typeof extractTokenUsage> | undefined;

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
          "openrouter", // provider
          finalModelName,
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
            model: finalModelName,
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
        tokenUsage = extractTokenUsage(result);

        // Extract OpenRouter generation ID for cost verification
        const openrouterGenerationId = extractOpenRouterGenerationId(result);

        console.log("[Webhook Handler] Token usage extracted:", {
          tokenUsage,
          hasTokenUsage: !!tokenUsage,
          promptTokens: tokenUsage?.promptTokens,
          completionTokens: tokenUsage?.completionTokens,
          totalTokens: tokenUsage?.totalTokens,
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
            console.log("[Webhook Handler] Step 2: Adjusting credit reservation:", {
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
              "[Webhook Handler] Step 2: Credit reservation adjusted successfully"
            );

            // Enqueue cost verification (Step 3) if we have a generation ID
            if (openrouterGenerationId) {
              await enqueueCostVerification(
                reservationId,
                openrouterGenerationId,
                workspaceId
              );
              console.log(
                "[Webhook Handler] Step 3: Cost verification enqueued"
              );
            } else {
              console.warn(
                "[Webhook Handler] No OpenRouter generation ID found, skipping cost verification"
              );
            }
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
            // Report to Sentry
            Sentry.captureException(ensureError(error), {
              tags: {
                endpoint: "webhook",
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
        if (error instanceof InsufficientCreditsError) {
          // Send email notification (non-blocking)
          try {
            await sendAgentErrorNotification(workspaceId, "credit", error);
          } catch (emailError) {
            console.error(
              "[Webhook Handler] Failed to send error notification:",
              emailError
            );
          }

          // Return sanitized error
          return {
            statusCode: 402,
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
            },
            body: "Request could not be completed due to service limits. Please contact your workspace administrator.",
          };
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
            console.error(
              "[Webhook Handler] Failed to send error notification:",
              emailError
            );
          }

          // Return sanitized error
          return {
            statusCode: 402,
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
            },
            body: "Request could not be completed due to service limits. Please contact your workspace administrator.",
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
          // Report to Sentry
          Sentry.captureException(ensureError(error), {
            tags: {
              endpoint: "webhook",
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
          "[Webhook Handler] Skipping request bucket increment - no subscription ID:",
          { workspaceId, agentId }
        );
      }

      // Process simple non-streaming response (no tool continuation)
      const responseContent = await processSimpleNonStreamingResponse(result);

      // Extract tool calls and results from generateText result
      let toolCallsFromResult = result.toolCalls || [];
      const toolResultsFromResult = result.toolResults || [];

      // FIX: If tool calls are missing but tool results exist, reconstruct tool calls from results
      // This can happen when tools execute synchronously and the AI SDK doesn't populate toolCalls
      if (
        toolCallsFromResult.length === 0 &&
        toolResultsFromResult.length > 0
      ) {
        console.log(
          "[Webhook Handler] Tool calls missing but tool results exist, reconstructing tool calls from results"
        );
        // Reconstruct tool calls from tool results - cast to any since we're creating a compatible structure
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK tool result types vary
        toolCallsFromResult = toolResultsFromResult.map((toolResult: any) => ({
          toolCallId:
            toolResult.toolCallId ||
            `call-${Math.random().toString(36).substring(7)}`,
          toolName: toolResult.toolName || "unknown",
          args: toolResult.args || toolResult.input || {},
        })) as unknown as typeof toolCallsFromResult;
        console.log(
          "[Webhook Handler] Reconstructed tool calls:",
          toolCallsFromResult
        );
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
      });

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

      // Create assistant message with modelName and provider
      // Ensure content is always an array if we have tool calls/results, even if text is empty
      const assistantMessage: UIMessage = {
        role: "assistant",
        content:
          assistantContent.length > 0
            ? assistantContent
            : responseContent || "",
        modelName: finalModelName,
        provider: "openrouter",
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
        // Filter out empty messages before logging
        const messagesToLog = [uiMessage, assistantMessage].filter(
          (msg) => !isMessageContentEmpty(msg)
        );

        // Only log if we have at least one non-empty message
        if (messagesToLog.length > 0) {
          // DIAGNOSTIC: Log messages being passed to startConversation
          console.log(
            "[Webhook Handler] Messages being passed to startConversation:",
            {
              messagesCount: messagesToLog.length,
              messages: messagesToLog,
              assistantMessageRole: assistantMessage.role,
              assistantMessageContentType: typeof assistantMessage.content,
              assistantMessageIsArray: Array.isArray(assistantMessage.content),
            }
          );

          await startConversation(db, {
            workspaceId,
            agentId,
            conversationType: "webhook",
            messages: messagesToLog,
            tokenUsage,
            usesByok,
          });
        } else {
          console.log(
            "[Webhook Handler] Skipping conversation logging - all messages are empty"
          );
        }
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
