import { randomUUID } from "crypto";

import { WebClient } from "@slack/web-api";
import type { SQSEvent } from "aws-lambda";

import { updateDiscordMessage } from "../../http/any-api-webhooks-000type-000workspaceId-000integrationId/services/discordResponse";
import { updateSlackMessage } from "../../http/any-api-webhooks-000type-000workspaceId-000integrationId/services/slackResponse";
import { callAgentNonStreaming } from "../../http/utils/agentCallNonStreaming";
// eslint-disable-next-line import/order
import { executeWithRequestLimits } from "../../http/utils/nonStreamingRequestLimits";
import { reconstructToolCallsFromResults } from "../../http/utils/generationToolReconstruction";
import { buildConversationMessagesFromObserver } from "../../http/utils/llmObserver";
import { convertTextToUIMessage } from "../../http/utils/messageConversion";
import {
  formatToolCallMessage,
  formatToolResultMessage,
} from "../../http/utils/toolFormatting";
import { database } from "../../tables";
// eslint-disable-next-line import/order
import {
  BotWebhookTaskMessageSchema,
  type BotWebhookTaskMessage,
} from "../../utils/botWebhookQueue";
import { runPeriodicTask } from "../../utils/asyncTasks";
import {
  startConversation,
  updateConversation,
} from "../../utils/conversationLogger";
import { handlingSQSErrors } from "../../utils/handlingSQSErrors";
import type { UIMessage } from "../../utils/messageTypes";
import { Sentry, ensureError } from "../../utils/sentry";
import { trackEvent } from "../../utils/tracking";
import { getCurrentSQSContext } from "../../utils/workspaceCreditContext";

/**
 * Process a Discord webhook task
 */
async function processDiscordTask(
  message: BotWebhookTaskMessage,
  context: NonNullable<Awaited<ReturnType<typeof getCurrentSQSContext>>>
): Promise<void> {
  const {
    workspaceId,
    agentId,
    messageText,
    interactionToken,
    applicationId,
    channelId,
    botToken,
    conversationId,
  } = message;

  if (!interactionToken || !applicationId || !botToken) {
    throw new Error(
      "Missing required Discord fields: interactionToken, applicationId, or botToken"
    );
  }

  // TypeScript: these are guaranteed to be strings after the check above
  const safeBotToken: string = botToken;
  const safeApplicationId: string = applicationId;
  const safeInteractionToken: string = interactionToken;

  const db = await database();

  // Get integration to access config
  const integrationPk = `bot-integrations/${workspaceId}/${message.integrationId}`;
  const integration = await db["bot-integration"].get(
    integrationPk,
    "integration"
  );

  if (!integration || integration.platform !== "discord") {
    throw new Error(`Integration not found: ${message.integrationId}`);
  }

  // Capture start time for elapsed time calculation
  const startTime = Date.now();
  const processingStartTime = Date.now();
  let generationStartTime: number | undefined;
  let generationStartedAt: string | undefined;

  // Flag to prevent updates after completion/error
  let isComplete = false;

  // Post initial "thinking" message
  try {
    await updateDiscordMessage(
      safeBotToken,
      safeApplicationId,
      safeInteractionToken,
      "Agent is thinking..."
    );
  } catch (error) {
    console.error(
      "[Bot Webhook Queue] Error posting initial Discord message:",
      error
    );
    Sentry.captureException(ensureError(error), {
      tags: {
        context: "bot-webhook-queue",
        platform: "discord",
        operation: "post-initial-message",
      },
      extra: {
        workspaceId,
        agentId,
        integrationId: message.integrationId,
      },
      level: "warning",
    });
  }

  // Helper to update the Discord message with elapsed time
  async function updateDiscordThinkingMessage(): Promise<void> {
    if (isComplete) {
      return; // Don't update if already complete
    }
    try {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      await updateDiscordMessage(
        safeBotToken,
        safeApplicationId,
        safeInteractionToken,
        `Agent is thinking... (${elapsed}s)`
      );
    } catch (error) {
      // If update fails, log but don't throw
      // This prevents the interval from breaking
      console.error(
        "[Bot Webhook Queue] Error updating Discord thinking message:",
        error
      );
      Sentry.captureException(ensureError(error), {
        tags: {
          context: "bot-webhook-queue",
          platform: "discord",
          operation: "update-thinking-message",
        },
        extra: {
          workspaceId,
          agentId,
          integrationId: message.integrationId,
        },
        level: "warning",
      });
    }
  }

  const updateLoopAbortController = new AbortController();
  const updateLoopPromise = runPeriodicTask({
    intervalMs: 1500,
    task: updateDiscordThinkingMessage,
    shouldContinue: () => !isComplete,
    signal: updateLoopAbortController.signal,
    onError: (error) => {
      console.error(
        "[Bot Webhook Queue] Error in Discord update interval:",
        error
      );
      Sentry.captureException(ensureError(error), {
        tags: {
          context: "bot-webhook-queue",
          platform: "discord",
          operation: "update-interval",
        },
        extra: {
          workspaceId,
          agentId,
          integrationId: message.integrationId,
        },
        level: "warning",
      });
    },
  });

  const stopThinkingUpdates = async (): Promise<void> => {
    if (isComplete) {
      return;
    }
    isComplete = true;
    updateLoopAbortController.abort();
    await updateLoopPromise;
  };

  try {
    // Get base URL for model referer (used for logging/tracking)
    // Falls back to BASE_URL if WEBHOOK_BASE_URL is not set
    const webhookBaseFromEnv = process.env.WEBHOOK_BASE_URL?.trim();
    const baseUrlFromEnv = process.env.BASE_URL?.trim();
    const baseUrl: string =
      webhookBaseFromEnv && webhookBaseFromEnv.length > 0
        ? webhookBaseFromEnv
        : baseUrlFromEnv && baseUrlFromEnv.length > 0
        ? baseUrlFromEnv
        : process.env.ARC_ENV === "production"
        ? "https://api.helpmaton.com"
        : process.env.ARC_ENV === "staging"
        ? "https://staging-api.helpmaton.com"
        : "http://localhost:3333"; // Fallback for local development

    // Create request timeout (10 minutes) to ensure request completes before Lambda timeout (11 minutes)
    const { createRequestTimeout, cleanupRequestTimeout } = await import(
      "../../http/utils/requestTimeout"
    );
    const requestTimeout = createRequestTimeout();

    let agentResult;
    try {
      generationStartTime = Date.now();
      generationStartedAt = new Date().toISOString();
      // Call agent
      agentResult = await executeWithRequestLimits({
        workspaceId,
        agentId,
        endpoint: "webhook",
        execute: () =>
          callAgentNonStreaming(workspaceId, agentId, messageText, {
            modelReferer: `${baseUrl}/api/webhooks/discord`,
            conversationId: conversationId || channelId,
            context,
            endpointType: "webhook",
            abortSignal: requestTimeout.signal,
          }),
      });
    } finally {
      cleanupRequestTimeout(requestTimeout);
    }

    await stopThinkingUpdates();

    // Update with complete response
    const responseText = agentResult.text || "No response generated.";
    await updateDiscordMessage(
      safeBotToken,
      safeApplicationId,
      safeInteractionToken,
      responseText
    );

    // Log conversation to trigger judge evaluations
    const finalConversationId = conversationId || channelId || randomUUID();
    const generationEndedAt = new Date().toISOString();
    const generationTimeMs =
      generationStartTime !== undefined
        ? Date.now() - generationStartTime
        : undefined;

    try {
      // Extract tool calls and results from agent result
      let toolCallsFromResult: unknown[] = [];
      let toolResultsFromResult: unknown[] = [];
      const reasoningFromSteps: Array<{ type: "reasoning"; text: string }> = [];

      if (agentResult.rawResult) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK generateText result types are complex
        const resultAny = agentResult.rawResult as any;
        const stepsValue = Array.isArray(resultAny.steps)
          ? resultAny.steps
          : resultAny._steps?.status?.value;

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
                    if (
                      contentItem.toolCallId &&
                      contentItem.toolName &&
                      typeof contentItem.toolCallId === "string" &&
                      typeof contentItem.toolName === "string"
                    ) {
                      toolCallsFromSteps.push({
                        toolCallId: contentItem.toolCallId,
                        toolName: contentItem.toolName,
                        args: contentItem.input || contentItem.args || {},
                        toolCallStartedAt: generationStartedAt,
                      });
                    }
                  } else if (contentItem.type === "tool-result") {
                    if (
                      contentItem.toolCallId &&
                      contentItem.toolName &&
                      typeof contentItem.toolCallId === "string" &&
                      typeof contentItem.toolName === "string"
                    ) {
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
                    }
                  } else if (
                    contentItem.type === "reasoning" &&
                    "text" in contentItem &&
                    typeof contentItem.text === "string"
                  ) {
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

        if (toolCallsFromSteps.length > 0) {
          toolCallsFromResult = toolCallsFromSteps;
        } else {
          toolCallsFromResult =
            (agentResult.rawResult as { toolCalls?: unknown[] }).toolCalls ||
            [];
        }

        if (toolResultsFromSteps.length > 0) {
          toolResultsFromResult = toolResultsFromSteps;
        } else {
          toolResultsFromResult =
            (agentResult.rawResult as { toolResults?: unknown[] })
              .toolResults || [];
        }
      }

      // Reconstruct tool calls from results if needed
      if (
        toolCallsFromResult.length === 0 &&
        toolResultsFromResult.length > 0
      ) {
        toolCallsFromResult = reconstructToolCallsFromResults(
          toolResultsFromResult,
          "Bot Webhook Queue (Discord)"
        ) as unknown as typeof toolCallsFromResult;
      }

      // Format tool calls and results as UI messages
      const toolCallMessages = toolCallsFromResult.map(formatToolCallMessage);
      const toolResultMessages = toolResultsFromResult.map(
        formatToolResultMessage
      );

      // Build assistant response message
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
        | {
            type: "delegation";
            toolCallId: string;
            callingAgentId: string;
            targetAgentId: string;
            targetConversationId?: string;
            status: "completed" | "failed" | "cancelled";
            timestamp: string;
            taskId?: string;
          }
      > = [];

      assistantContent.push(...reasoningFromSteps);

      for (const toolCallMsg of toolCallMessages) {
        if (Array.isArray(toolCallMsg.content)) {
          assistantContent.push(...toolCallMsg.content);
        }
      }

      for (const toolResultMsg of toolResultMessages) {
        if (Array.isArray(toolResultMsg.content)) {
          for (const contentItem of toolResultMsg.content) {
            assistantContent.push(
              contentItem as (typeof assistantContent)[number]
            );
          }
        }
      }

      if (responseText && responseText.trim().length > 0) {
        assistantContent.push({ type: "text", text: responseText });
      }

      // Get agent info for model name
      const { setupAgentAndTools } = await import(
        "../../http/utils/agentSetup"
      );
      const { agent, usesByok: agentUsesByok } = await setupAgentAndTools(
        workspaceId,
        agentId,
        [],
        {
          modelReferer: `${baseUrl}/api/webhooks/discord`,
          callDepth: 0,
          maxDelegationDepth: 3,
          context,
        }
      );
      const finalModelName =
        typeof agent.modelName === "string"
          ? agent.modelName
          : "openrouter/gemini-2.0-flash-exp";

      const userMessage = convertTextToUIMessage(messageText);
      const messagesForLogging: UIMessage[] = agentResult.observerEvents
        ? buildConversationMessagesFromObserver({
            observerEvents: agentResult.observerEvents,
            fallbackInputMessages: [userMessage],
            assistantMeta: {
              tokenUsage: agentResult.tokenUsage,
              modelName: finalModelName,
              provider: "openrouter",
              openrouterGenerationId: agentResult.openrouterGenerationId,
              provisionalCostUsd: agentResult.provisionalCostUsd,
              generationTimeMs,
            },
          })
        : [
            userMessage,
            {
              role: "assistant",
              content:
                assistantContent.length > 0
                  ? assistantContent
                  : responseText || "",
              ...(agentResult.tokenUsage && {
                tokenUsage: agentResult.tokenUsage,
              }),
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
            },
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

      // Check if conversation exists
      const conversationPk = `conversations/${workspaceId}/${agentId}/${finalConversationId}`;
      const existingConversation = await db["agent-conversations"].get(
        conversationPk
      );

      if (existingConversation) {
        // Update existing conversation
        await updateConversation(
          db,
          workspaceId,
          agentId,
          finalConversationId,
          validMessages,
          agentResult.tokenUsage,
          agentUsesByok,
          undefined, // error
          undefined, // awsRequestId
          "webhook" // conversationType
        );
      } else {
        // Create new conversation
        await startConversation(db, {
          workspaceId,
          agentId,
          conversationId: finalConversationId,
          conversationType: "webhook",
          messages: validMessages,
          tokenUsage: agentResult.tokenUsage,
          usesByok: agentUsesByok,
        });
      }
    } catch (conversationError) {
      // Log error but don't throw - conversation logging should not block webhook processing
      console.error(
        "[Bot Webhook Queue] Error logging conversation (Discord):",
        {
          error:
            conversationError instanceof Error
              ? conversationError.message
              : String(conversationError),
          workspaceId,
          agentId,
          conversationId: finalConversationId,
        }
      );
      Sentry.captureException(ensureError(conversationError), {
        tags: {
          context: "bot-webhook-queue",
          platform: "discord",
          operation: "log-conversation",
        },
        extra: {
          workspaceId,
          agentId,
          conversationId: finalConversationId,
        },
        level: "warning",
      });
    }

    // Update lastUsedAt
    await db["bot-integration"].update({
      ...integration,
      lastUsedAt: new Date().toISOString(),
    });

    // Track successful processing
    const processingTimeMs = Date.now() - processingStartTime;
    trackEvent("bot_webhook_processed", {
      workspace_id: workspaceId,
      integration_id: message.integrationId,
      platform: "discord",
      agent_id: agentId,
      processing_time_ms: processingTimeMs,
      response_length: responseText.length,
    });
  } catch (error) {
    await stopThinkingUpdates();

    // Update with error
    try {
      await updateDiscordMessage(
        safeBotToken,
        safeApplicationId,
        safeInteractionToken,
        `❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    } catch (updateError) {
      console.error(
        "[Bot Webhook Queue] Error updating Discord message with error:",
        updateError
      );
      Sentry.captureException(ensureError(updateError), {
        tags: {
          context: "bot-webhook-queue",
          platform: "discord",
          operation: "update-error-message",
        },
        extra: {
          workspaceId,
          agentId,
          integrationId: message.integrationId,
        },
        level: "warning",
      });
    }

    // Track failed processing
    trackEvent("bot_webhook_processing_failed", {
      workspace_id: workspaceId,
      integration_id: message.integrationId,
      platform: "discord",
      agent_id: agentId,
      error_type: error instanceof Error ? error.constructor.name : "Unknown",
      error_message: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}

/**
 * Process a Slack webhook task
 */
async function processSlackTask(
  message: BotWebhookTaskMessage,
  context: NonNullable<Awaited<ReturnType<typeof getCurrentSQSContext>>>
): Promise<void> {
  const {
    workspaceId,
    agentId,
    messageText,
    botToken,
    channel,
    messageTs,
    threadTs,
    conversationId,
  } = message;

  if (!botToken || !channel || !messageTs) {
    throw new Error(
      "Missing required Slack fields: botToken, channel, or messageTs"
    );
  }

  // TypeScript: these are guaranteed to be strings after the check above
  const safeBotToken: string = botToken;
  const safeChannel: string = channel;
  const safeMessageTs: string = messageTs;

  const db = await database();

  // Get integration to access config
  const integrationPk = `bot-integrations/${workspaceId}/${message.integrationId}`;
  const integration = await db["bot-integration"].get(
    integrationPk,
    "integration"
  );

  if (!integration || integration.platform !== "slack") {
    throw new Error(`Integration not found: ${message.integrationId}`);
  }

  const config = integration.config as {
    botToken: string;
    signingSecret: string;
    teamId?: string;
    teamName?: string;
    botUserId?: string;
    messageHistoryCount?: number;
  };

  const client = new WebClient(safeBotToken);

  // Capture start time for elapsed time calculation
  const startTime = Date.now();
  const processingStartTime = Date.now();
  let generationStartTime: number | undefined;
  let generationStartedAt: string | undefined;

  // Flag to prevent updates after completion/error
  let isComplete = false;

  // Helper to update the Slack message with elapsed time
  async function updateSlackThinkingMessage(): Promise<void> {
    if (isComplete) {
      return; // Don't update if already complete
    }
    try {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      await updateSlackMessage(
        client,
        safeChannel,
        safeMessageTs,
        `Agent is thinking... (${elapsed}s)`
      );
    } catch (error) {
      // If update fails (e.g., message_not_found), log but don't throw
      // This prevents the interval from breaking
      console.error(
        "[Bot Webhook Queue] Error updating Slack thinking message:",
        error
      );
      Sentry.captureException(ensureError(error), {
        tags: {
          context: "bot-webhook-queue",
          platform: "slack",
          operation: "update-thinking-message",
        },
        extra: {
          workspaceId,
          agentId,
          integrationId: message.integrationId,
        },
        level: "warning",
      });
    }
  }

  const updateLoopAbortController = new AbortController();
  const updateLoopPromise = runPeriodicTask({
    intervalMs: 1500,
    task: updateSlackThinkingMessage,
    shouldContinue: () => !isComplete,
    signal: updateLoopAbortController.signal,
    onError: (error) => {
      console.error(
        "[Bot Webhook Queue] Error in Slack update interval:",
        error
      );
      Sentry.captureException(ensureError(error), {
        tags: {
          context: "bot-webhook-queue",
          platform: "slack",
          operation: "update-interval",
        },
        extra: {
          workspaceId,
          agentId,
          integrationId: message.integrationId,
        },
        level: "warning",
      });
    },
  });

  const stopThinkingUpdates = async (): Promise<void> => {
    if (isComplete) {
      return;
    }
    isComplete = true;
    updateLoopAbortController.abort();
    await updateLoopPromise;
  };

  // Get base URL for model referer (used for logging/tracking)
  // Falls back to BASE_URL if WEBHOOK_BASE_URL is not set
  const webhookBaseFromEnv = process.env.WEBHOOK_BASE_URL?.trim();
  const baseUrlFromEnv = process.env.BASE_URL?.trim();
  const baseUrl: string =
    webhookBaseFromEnv && webhookBaseFromEnv.length > 0
      ? webhookBaseFromEnv
      : baseUrlFromEnv && baseUrlFromEnv.length > 0
      ? baseUrlFromEnv
      : process.env.ARC_ENV === "production"
      ? "https://api.helpmaton.com"
      : process.env.ARC_ENV === "staging"
      ? "https://staging-api.helpmaton.com"
      : "http://localhost:3333";

  // Fetch message history if configured
  let conversationHistory: UIMessage[] = [];
  const messageHistoryCount = config.messageHistoryCount ?? 10;
  if (messageHistoryCount > 0) {
    try {
      // Get bot user ID if not already cached
      let botUserId = config.botUserId;
      if (!botUserId) {
        const authResult = await client.auth.test();
        if (authResult.ok && authResult.user_id) {
          botUserId = authResult.user_id;
          // Update integration config with bot user ID
          const updatedConfig = {
            ...config,
            botUserId,
          };
          await db["bot-integration"].update({
            ...integration,
            config: updatedConfig,
          });
        }
      }

      // Fetch conversation history
      const historyParams: {
        channel: string;
        limit: number;
        latest?: string;
        oldest?: string;
      } = {
        channel: safeChannel,
        limit: messageHistoryCount,
        latest: safeMessageTs,
      };

      // If in a thread, fetch thread history
      if (threadTs) {
        const threadHistory = await client.conversations.replies({
          channel: safeChannel,
          ts: threadTs,
          limit: messageHistoryCount + 1, // +1 to account for the thread parent
        });

        if (threadHistory.ok && threadHistory.messages) {
          // Filter out the current message, then convert
          // Include bot messages in history as assistant messages for context
          const messages = threadHistory.messages
            .filter((msg) => {
              // Exclude current message
              if (msg.ts === safeMessageTs) {
                return false;
              }
              // Exclude messages without text
              if (!msg.text) {
                return false;
              }
              return true;
            })
            .slice(-messageHistoryCount) // Take last N messages
            .map((msg): UIMessage => {
              // Determine role: if it's from bot, it's assistant, otherwise user
              const isBotMessage =
                (botUserId && msg.user === botUserId) || !!msg.bot_id;
              const role = isBotMessage ? "assistant" : "user";
              return {
                role,
                content: msg.text || "",
              };
            });

          conversationHistory = messages;
        }
      } else {
        // Fetch channel history
        const channelHistory = await client.conversations.history(
          historyParams
        );

        if (channelHistory.ok && channelHistory.messages) {
          // Filter out the current message, then convert
          // Include bot messages in history as assistant messages for context
          const messages = channelHistory.messages
            .filter((msg) => {
              // Exclude current message
              if (msg.ts === safeMessageTs) {
                return false;
              }
              // Exclude messages without text
              if (!msg.text) {
                return false;
              }
              // Exclude thread replies (we only want top-level messages)
              if (msg.thread_ts && msg.thread_ts !== msg.ts) {
                return false;
              }
              return true;
            })
            .slice(0, messageHistoryCount) // Take first N messages (they're in reverse chronological order)
            .reverse() // Reverse to get chronological order (oldest first)
            .map((msg): UIMessage => {
              // Determine role: if it's from bot, it's assistant, otherwise user
              const isBotMessage =
                (botUserId && msg.user === botUserId) || !!msg.bot_id;
              const role = isBotMessage ? "assistant" : "user";
              return {
                role,
                content: msg.text || "",
              };
            });

          conversationHistory = messages;
        }
      }
    } catch (error) {
      // Log error but continue without history
      console.error(
        "[Bot Webhook Queue] Error fetching message history:",
        error
      );
      Sentry.captureException(ensureError(error), {
        tags: {
          context: "bot-webhook-queue",
          platform: "slack",
          operation: "fetch-message-history",
        },
        extra: {
          workspaceId,
          agentId,
          integrationId: message.integrationId,
        },
        level: "warning",
      });
    }
  }

  try {
    // Call agent with conversation history
    // Create request timeout (10 minutes) to ensure request completes before Lambda timeout (11 minutes)
    const { createRequestTimeout, cleanupRequestTimeout } = await import(
      "../../http/utils/requestTimeout"
    );
    const requestTimeout = createRequestTimeout();

    let agentResult;
    try {
      generationStartTime = Date.now();
      generationStartedAt = new Date().toISOString();
      agentResult = await executeWithRequestLimits({
        workspaceId,
        agentId,
        endpoint: "webhook",
        execute: () =>
          callAgentNonStreaming(workspaceId, agentId, messageText, {
            modelReferer: `${baseUrl}/api/webhooks/slack`,
            conversationId: conversationId || threadTs || messageTs,
            context,
            endpointType: "webhook",
            conversationHistory,
            abortSignal: requestTimeout.signal,
          }),
      });
    } finally {
      cleanupRequestTimeout(requestTimeout);
    }

    await stopThinkingUpdates();

    // Update with complete response
    const responseText = agentResult.text || "No response generated.";
    await updateSlackMessage(client, safeChannel, safeMessageTs, responseText);

    // Log conversation to trigger judge evaluations
    const finalConversationId =
      conversationId || threadTs || messageTs || randomUUID();
    const generationEndedAt = new Date().toISOString();
    const generationTimeMs =
      generationStartTime !== undefined
        ? Date.now() - generationStartTime
        : undefined;

    try {
      // Extract tool calls and results from agent result
      let toolCallsFromResult: unknown[] = [];
      let toolResultsFromResult: unknown[] = [];
      const reasoningFromSteps: Array<{ type: "reasoning"; text: string }> = [];

      if (agentResult.rawResult) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK generateText result types are complex
        const resultAny = agentResult.rawResult as any;
        const stepsValue = Array.isArray(resultAny.steps)
          ? resultAny.steps
          : resultAny._steps?.status?.value;

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
                    if (
                      contentItem.toolCallId &&
                      contentItem.toolName &&
                      typeof contentItem.toolCallId === "string" &&
                      typeof contentItem.toolName === "string"
                    ) {
                      toolCallsFromSteps.push({
                        toolCallId: contentItem.toolCallId,
                        toolName: contentItem.toolName,
                        args: contentItem.input || contentItem.args || {},
                        toolCallStartedAt: generationStartedAt,
                      });
                    }
                  } else if (contentItem.type === "tool-result") {
                    if (
                      contentItem.toolCallId &&
                      contentItem.toolName &&
                      typeof contentItem.toolCallId === "string" &&
                      typeof contentItem.toolName === "string"
                    ) {
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
                    }
                  } else if (
                    contentItem.type === "reasoning" &&
                    "text" in contentItem &&
                    typeof contentItem.text === "string"
                  ) {
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

        if (toolCallsFromSteps.length > 0) {
          toolCallsFromResult = toolCallsFromSteps;
        } else {
          toolCallsFromResult =
            (agentResult.rawResult as { toolCalls?: unknown[] }).toolCalls ||
            [];
        }

        if (toolResultsFromSteps.length > 0) {
          toolResultsFromResult = toolResultsFromSteps;
        } else {
          toolResultsFromResult =
            (agentResult.rawResult as { toolResults?: unknown[] })
              .toolResults || [];
        }
      }

      // Reconstruct tool calls from results if needed
      if (
        toolCallsFromResult.length === 0 &&
        toolResultsFromResult.length > 0
      ) {
        toolCallsFromResult = reconstructToolCallsFromResults(
          toolResultsFromResult,
          "Bot Webhook Queue (Slack)"
        ) as unknown as typeof toolCallsFromResult;
      }

      // Format tool calls and results as UI messages
      const toolCallMessages = toolCallsFromResult.map(formatToolCallMessage);
      const toolResultMessages = toolResultsFromResult.map(
        formatToolResultMessage
      );

      // Build assistant response message
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
        | {
            type: "delegation";
            toolCallId: string;
            callingAgentId: string;
            targetAgentId: string;
            targetConversationId?: string;
            status: "completed" | "failed" | "cancelled";
            timestamp: string;
            taskId?: string;
          }
      > = [];

      assistantContent.push(...reasoningFromSteps);

      for (const toolCallMsg of toolCallMessages) {
        if (Array.isArray(toolCallMsg.content)) {
          assistantContent.push(...toolCallMsg.content);
        }
      }

      for (const toolResultMsg of toolResultMessages) {
        if (Array.isArray(toolResultMsg.content)) {
          for (const contentItem of toolResultMsg.content) {
            assistantContent.push(
              contentItem as (typeof assistantContent)[number]
            );
          }
        }
      }

      if (responseText && responseText.trim().length > 0) {
        assistantContent.push({ type: "text", text: responseText });
      }

      // Get agent info for model name
      const { setupAgentAndTools } = await import(
        "../../http/utils/agentSetup"
      );
      const { agent, usesByok: agentUsesByok } = await setupAgentAndTools(
        workspaceId,
        agentId,
        [],
        {
          modelReferer: `${baseUrl}/api/webhooks/slack`,
          callDepth: 0,
          maxDelegationDepth: 3,
          context,
        }
      );
      const finalModelName =
        typeof agent.modelName === "string"
          ? agent.modelName
          : "openrouter/gemini-2.0-flash-exp";

      // Combine conversation history with new messages
      const userMessage = convertTextToUIMessage(messageText);
      const messagesForLogging: UIMessage[] = agentResult.observerEvents
        ? buildConversationMessagesFromObserver({
            observerEvents: agentResult.observerEvents,
            fallbackInputMessages: [...conversationHistory, userMessage],
            assistantMeta: {
              tokenUsage: agentResult.tokenUsage,
              modelName: finalModelName,
              provider: "openrouter",
              openrouterGenerationId: agentResult.openrouterGenerationId,
              provisionalCostUsd: agentResult.provisionalCostUsd,
              generationTimeMs,
            },
          })
        : [
            ...conversationHistory,
            userMessage,
            {
              role: "assistant",
              content:
                assistantContent.length > 0
                  ? assistantContent
                  : responseText || "",
              ...(agentResult.tokenUsage && {
                tokenUsage: agentResult.tokenUsage,
              }),
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
            },
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

      // Check if conversation exists
      const conversationPk = `conversations/${workspaceId}/${agentId}/${finalConversationId}`;
      const existingConversation = await db["agent-conversations"].get(
        conversationPk
      );

      if (existingConversation) {
        // Update existing conversation
        await updateConversation(
          db,
          workspaceId,
          agentId,
          finalConversationId,
          validMessages,
          agentResult.tokenUsage,
          agentUsesByok,
          undefined, // error
          undefined, // awsRequestId
          "webhook" // conversationType
        );
      } else {
        // Create new conversation
        await startConversation(db, {
          workspaceId,
          agentId,
          conversationId: finalConversationId,
          conversationType: "webhook",
          messages: validMessages,
          tokenUsage: agentResult.tokenUsage,
          usesByok: agentUsesByok,
        });
      }
    } catch (conversationError) {
      // Log error but don't throw - conversation logging should not block webhook processing
      console.error("[Bot Webhook Queue] Error logging conversation (Slack):", {
        error:
          conversationError instanceof Error
            ? conversationError.message
            : String(conversationError),
        workspaceId,
        agentId,
        conversationId: finalConversationId,
      });
      Sentry.captureException(ensureError(conversationError), {
        tags: {
          context: "bot-webhook-queue",
          platform: "slack",
          operation: "log-conversation",
        },
        extra: {
          workspaceId,
          agentId,
          conversationId: finalConversationId,
        },
        level: "warning",
      });
    }

    // Update lastUsedAt
    await db["bot-integration"].update({
      ...integration,
      lastUsedAt: new Date().toISOString(),
    });

    // Track successful processing
    const processingTimeMs = Date.now() - processingStartTime;
    trackEvent("bot_webhook_processed", {
      workspace_id: workspaceId,
      integration_id: message.integrationId,
      platform: "slack",
      agent_id: agentId,
      processing_time_ms: processingTimeMs,
      response_length: responseText.length,
    });
  } catch (error) {
    await stopThinkingUpdates();

    // Update with error
    try {
      await updateSlackMessage(
        client,
        safeChannel,
        safeMessageTs,
        `❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    } catch (updateError) {
      console.error(
        "[Bot Webhook Queue] Error updating Slack message with error:",
        updateError
      );
      Sentry.captureException(ensureError(updateError), {
        tags: {
          context: "bot-webhook-queue",
          platform: "slack",
          operation: "update-error-message",
        },
        extra: {
          workspaceId,
          agentId,
          integrationId: message.integrationId,
        },
        level: "warning",
      });
    }

    // Track failed processing
    trackEvent("bot_webhook_processing_failed", {
      workspace_id: workspaceId,
      integration_id: message.integrationId,
      platform: "slack",
      agent_id: agentId,
      error_type: error instanceof Error ? error.constructor.name : "Unknown",
      error_message: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}

/**
 * Process a single bot webhook task
 */
async function processBotWebhookTask(
  message: BotWebhookTaskMessage,
  messageId: string
): Promise<void> {
  // Get context for workspace credit transactions
  const context = getCurrentSQSContext(messageId);
  if (!context) {
    throw new Error("Context not available for workspace credit transactions");
  }

  if (message.platform === "discord") {
    await processDiscordTask(message, context);
  } else if (message.platform === "slack") {
    await processSlackTask(message, context);
  } else {
    throw new Error(`Unknown platform: ${message.platform}`);
  }
}

/**
 * Handler for bot webhook queue
 */
export const handler = handlingSQSErrors(
  async (event: SQSEvent): Promise<string[]> => {
    const failedMessageIds: string[] = [];

    for (const record of event.Records) {
      const messageId = record.messageId || "unknown";
      try {
        const body = JSON.parse(record.body);
        const message = BotWebhookTaskMessageSchema.parse(body);

        console.log("[Bot Webhook Queue] Processing task:", {
          platform: message.platform,
          integrationId: message.integrationId,
          workspaceId: message.workspaceId,
          agentId: message.agentId,
        });

        await processBotWebhookTask(message, messageId);
      } catch (error) {
        console.error(
          `[Bot Webhook Queue] Error processing message ${messageId}:`,
          error
        );
        Sentry.captureException(ensureError(error), {
          tags: {
            context: "bot-webhook-queue",
            operation: "process-message",
          },
          extra: {
            messageId,
            messageBody: record.body,
          },
        });
        failedMessageIds.push(messageId);
      }
    }

    return failedMessageIds;
  }
);
