import { randomUUID } from "crypto";

import { WebClient } from "@slack/web-api";

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
import type { BotIntegrationRecord } from "../../tables/schema";
import { runPeriodicTask } from "../../utils/asyncTasks";
import type { BotWebhookTaskMessage } from "../../utils/botWebhookQueue";
import {
  extractErrorMessage,
  startConversation,
  updateConversation,
} from "../../utils/conversationLogger";
import { getRecord } from "../../utils/conversationRecords";
import type { UIMessage } from "../../utils/messageTypes";
import { resetPostHogRequestContext } from "../../utils/posthog";
import { Sentry, ensureError } from "../../utils/sentry";
import { trackEvent } from "../../utils/tracking";
import { getCurrentSQSContext } from "../../utils/workspaceCreditContext";

type SlackTaskContext = NonNullable<
  Awaited<ReturnType<typeof getCurrentSQSContext>>
>;

type SlackIntegrationConfig = {
  botToken: string;
  signingSecret: string;
  teamId?: string;
  teamName?: string;
  botUserId?: string;
  messageHistoryCount?: number;
};

type SlackHistoryMessage = {
  ts?: string;
  text?: string;
  user?: string;
  bot_id?: string;
  thread_ts?: string;
};

type ToolingExtraction = {
  toolCallsFromResult: unknown[];
  toolResultsFromResult: unknown[];
  reasoningFromSteps: Array<{ type: "reasoning"; text: string }>;
};

function requireSlackFields(message: BotWebhookTaskMessage): {
  safeBotToken: string;
  safeChannel: string;
  safeMessageTs: string;
} {
  const { botToken, channel, messageTs } = message;
  if (!botToken || !channel || !messageTs) {
    throw new Error(
      "Missing required Slack fields: botToken, channel, or messageTs"
    );
  }

  return {
    safeBotToken: botToken,
    safeChannel: channel,
    safeMessageTs: messageTs,
  };
}

async function getSlackIntegration(
  db: Awaited<ReturnType<typeof database>>,
  workspaceId: string,
  integrationId: string
): Promise<BotIntegrationRecord> {
  const integrationPk = `bot-integrations/${workspaceId}/${integrationId}`;
  const integration = await db["bot-integration"].get(
    integrationPk,
    "integration"
  );

  if (!integration || integration.platform !== "slack") {
    throw new Error(`Integration not found: ${integrationId}`);
  }

  return integration;
}

function resolveSlackBaseUrl(): string {
  const webhookBaseFromEnv = process.env.WEBHOOK_BASE_URL?.trim();
  const baseUrlFromEnv = process.env.BASE_URL?.trim();
  if (webhookBaseFromEnv && webhookBaseFromEnv.length > 0) {
    return webhookBaseFromEnv;
  }
  if (baseUrlFromEnv && baseUrlFromEnv.length > 0) {
    return baseUrlFromEnv;
  }
  if (process.env.ARC_ENV === "production") {
    return "https://api.helpmaton.com";
  }
  if (process.env.ARC_ENV === "staging") {
    return "https://staging-api.helpmaton.com";
  }
  return "http://localhost:3333";
}

function isSlackBotMessage(botUserId: string | undefined, msg: SlackHistoryMessage) {
  return (botUserId && msg.user === botUserId) || !!msg.bot_id;
}

function toSlackUIMessage(
  msg: SlackHistoryMessage,
  botUserId: string | undefined
): UIMessage {
  const role = isSlackBotMessage(botUserId, msg) ? "assistant" : "user";
  return {
    role,
    content: msg.text || "",
  };
}

export function buildSlackThreadHistoryMessages(params: {
  messages: SlackHistoryMessage[];
  safeMessageTs: string;
  messageHistoryCount: number;
  botUserId: string | undefined;
}): UIMessage[] {
  const { messages, safeMessageTs, messageHistoryCount, botUserId } = params;
  return messages
    .filter((msg) => {
      if (msg.ts === safeMessageTs) {
        return false;
      }
      if (!msg.text) {
        return false;
      }
      return true;
    })
    .slice(-messageHistoryCount)
    .map((msg) => toSlackUIMessage(msg, botUserId));
}

export function buildSlackChannelHistoryMessages(params: {
  messages: SlackHistoryMessage[];
  safeMessageTs: string;
  messageHistoryCount: number;
  botUserId: string | undefined;
}): UIMessage[] {
  const { messages, safeMessageTs, messageHistoryCount, botUserId } = params;
  return messages
    .filter((msg) => {
      if (msg.ts === safeMessageTs) {
        return false;
      }
      if (!msg.text) {
        return false;
      }
      if (msg.thread_ts && msg.thread_ts !== msg.ts) {
        return false;
      }
      return true;
    })
    .slice(0, messageHistoryCount)
    .reverse()
    .map((msg) => toSlackUIMessage(msg, botUserId));
}

async function resolveSlackBotUserId(params: {
  client: WebClient;
  config: SlackIntegrationConfig;
  db: Awaited<ReturnType<typeof database>>;
  integration: BotIntegrationRecord;
}): Promise<string | undefined> {
  const { client, config, db, integration } = params;
  let botUserId = config.botUserId;
  if (botUserId) {
    return botUserId;
  }

  const authResult = await client.auth.test();
  if (authResult.ok && authResult.user_id) {
    botUserId = authResult.user_id;
    const updatedConfig = {
      ...config,
      botUserId,
    };
    await db["bot-integration"].update({
      ...integration,
      config: updatedConfig,
    });
  }

  return botUserId;
}

async function fetchSlackConversationHistory(params: {
  client: WebClient;
  config: SlackIntegrationConfig;
  db: Awaited<ReturnType<typeof database>>;
  integration: BotIntegrationRecord;
  safeChannel: string;
  safeMessageTs: string;
  threadTs?: string;
}): Promise<UIMessage[]> {
  const {
    client,
    config,
    db,
    integration,
    safeChannel,
    safeMessageTs,
    threadTs,
  } = params;

  const messageHistoryCount = config.messageHistoryCount ?? 10;
  if (messageHistoryCount <= 0) {
    return [];
  }

  const botUserId = await resolveSlackBotUserId({
    client,
    config,
    db,
    integration,
  });

  if (threadTs) {
    const threadHistory = await client.conversations.replies({
      channel: safeChannel,
      ts: threadTs,
      limit: messageHistoryCount + 1,
    });

    if (threadHistory.ok && threadHistory.messages) {
      return buildSlackThreadHistoryMessages({
        messages: threadHistory.messages as SlackHistoryMessage[],
        safeMessageTs,
        messageHistoryCount,
        botUserId,
      });
    }
  } else {
    const channelHistory = await client.conversations.history({
      channel: safeChannel,
      limit: messageHistoryCount,
      latest: safeMessageTs,
    });

    if (channelHistory.ok && channelHistory.messages) {
      return buildSlackChannelHistoryMessages({
        messages: channelHistory.messages as SlackHistoryMessage[],
        safeMessageTs,
        messageHistoryCount,
        botUserId,
      });
    }
  }

  return [];
}

function startSlackThinkingUpdates(params: {
  client: WebClient;
  safeChannel: string;
  safeMessageTs: string;
  workspaceId: string;
  agentId: string;
  integrationId: string;
}): {
  stopThinkingUpdates: () => Promise<void>;
} {
  const {
    client,
    safeChannel,
    safeMessageTs,
    workspaceId,
    agentId,
    integrationId,
  } = params;
  const startTime = Date.now();
  let isComplete = false;

  async function updateSlackThinkingMessage(): Promise<void> {
    if (isComplete) {
      return;
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
          integrationId,
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
          integrationId,
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

  return { stopThinkingUpdates };
}

async function executeSlackAgentCall(params: {
  workspaceId: string;
  agentId: string;
  messageText: string;
  baseUrl: string;
  conversationId: string;
  context: SlackTaskContext;
  conversationHistory: UIMessage[];
}): Promise<{
  agentResult: Awaited<ReturnType<typeof callAgentNonStreaming>>;
  generationStartedAt: string;
  generationStartTime: number;
}> {
  const {
    workspaceId,
    agentId,
    messageText,
    baseUrl,
    conversationId,
    context,
    conversationHistory,
  } = params;

  const { createRequestTimeout, cleanupRequestTimeout } = await import(
    "../../http/utils/requestTimeout"
  );
  const requestTimeout = createRequestTimeout();
  const generationStartTime = Date.now();
  const generationStartedAt = new Date().toISOString();

  try {
    const agentResult = await executeWithRequestLimits({
      workspaceId,
      agentId,
      endpoint: "webhook",
      execute: () =>
        callAgentNonStreaming(workspaceId, agentId, messageText, {
          modelReferer: `${baseUrl}/api/webhooks/slack`,
          conversationId,
          context,
          endpointType: "webhook",
          conversationHistory,
          abortSignal: requestTimeout.signal,
        }),
    });
    return { agentResult, generationStartedAt, generationStartTime };
  } finally {
    cleanupRequestTimeout(requestTimeout);
  }
}

function extractSlackToolingFromResult(params: {
  agentResult: Awaited<ReturnType<typeof callAgentNonStreaming>>;
  generationStartedAt: string;
}): ToolingExtraction {
  const { agentResult, generationStartedAt } = params;
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
                      resultValue || contentItem.output || contentItem.result,
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
        (agentResult.rawResult as { toolCalls?: unknown[] }).toolCalls || [];
    }

    if (toolResultsFromSteps.length > 0) {
      toolResultsFromResult = toolResultsFromSteps;
    } else {
      toolResultsFromResult =
        (agentResult.rawResult as { toolResults?: unknown[] }).toolResults || [];
    }
  }

  if (toolCallsFromResult.length === 0 && toolResultsFromResult.length > 0) {
    toolCallsFromResult = reconstructToolCallsFromResults(
      toolResultsFromResult,
      "Bot Webhook Queue (Slack)"
    ) as unknown as typeof toolCallsFromResult;
  }

  return {
    toolCallsFromResult,
    toolResultsFromResult,
    reasoningFromSteps,
  };
}

function buildSlackAssistantContent(params: {
  reasoningFromSteps: Array<{ type: "reasoning"; text: string }>;
  toolCallsFromResult: unknown[];
  toolResultsFromResult: unknown[];
  responseText: string;
  provider?: string;
  modelName?: string;
}): Array<
  | { type: "text"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool-result"; toolCallId: string; toolName: string; result: unknown }
  | { type: "reasoning"; text: string }
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
> {
  const {
    reasoningFromSteps,
    toolCallsFromResult,
    toolResultsFromResult,
    responseText,
    provider = "openrouter",
    modelName,
  } = params;
  const toolCallMessages = toolCallsFromResult.map(formatToolCallMessage);
  const toolResultMessages = toolResultsFromResult.map((tr) =>
    formatToolResultMessage(tr, { provider, modelName })
  );

  const assistantContent: Array<
    | { type: "text"; text: string }
    | { type: "tool-call"; toolCallId: string; toolName: string; args: unknown }
    | { type: "tool-result"; toolCallId: string; toolName: string; result: unknown }
    | { type: "reasoning"; text: string }
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
        assistantContent.push(contentItem as (typeof assistantContent)[number]);
      }
    }
  }

  if (responseText && responseText.trim().length > 0) {
    assistantContent.push({ type: "text", text: responseText });
  }

  return assistantContent;
}

async function logSlackConversation(params: {
  db: Awaited<ReturnType<typeof database>>;
  workspaceId: string;
  agentId: string;
  integrationId: string;
  messageText: string;
  responseText: string;
  agentResult: Awaited<ReturnType<typeof callAgentNonStreaming>>;
  conversationHistory: UIMessage[];
  generationStartedAt: string;
  generationStartTime: number;
  baseUrl: string;
  finalConversationId: string;
  context: SlackTaskContext;
}): Promise<void> {
  const {
    db,
    workspaceId,
    agentId,
    messageText,
    responseText,
    agentResult,
    conversationHistory,
    generationStartedAt,
    generationStartTime,
    baseUrl,
    finalConversationId,
    context,
  } = params;

  const generationEndedAt = new Date().toISOString();
  const generationTimeMs = Date.now() - generationStartTime;

  const {
    toolCallsFromResult,
    toolResultsFromResult,
    reasoningFromSteps,
  } = extractSlackToolingFromResult({
    agentResult,
    generationStartedAt,
  });

  const { setupAgentAndTools } = await import("../../http/utils/agentSetup");
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

  const assistantContent = buildSlackAssistantContent({
    reasoningFromSteps,
    toolCallsFromResult,
    toolResultsFromResult,
    responseText,
    provider: "openrouter",
    modelName: finalModelName,
  });

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
          content: assistantContent.length > 0 ? assistantContent : responseText || "",
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
          ...(generationTimeMs != null && { generationTimeMs }),
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

  const conversationPk = `conversations/${workspaceId}/${agentId}/${finalConversationId}`;
  const existingConversation = await getRecord(db, conversationPk, undefined, {
    enrichFromS3: false,
  });

  if (existingConversation) {
    await updateConversation(
      db,
      workspaceId,
      agentId,
      finalConversationId,
      validMessages,
      agentResult.tokenUsage,
      agentUsesByok,
      undefined,
      undefined,
      "webhook",
      context
    );
  } else {
    await startConversation(db, {
      workspaceId,
      agentId,
      conversationId: finalConversationId,
      conversationType: "webhook",
      messages: validMessages,
      tokenUsage: agentResult.tokenUsage,
      usesByok: agentUsesByok,
      context,
    });
  }
}

export async function processSlackTask(
  message: BotWebhookTaskMessage,
  context: SlackTaskContext
): Promise<void> {
  resetPostHogRequestContext();

  const {
    workspaceId,
    agentId,
    messageText,
    threadTs,
    conversationId,
  } = message;

  const { safeBotToken, safeChannel, safeMessageTs } =
    requireSlackFields(message);

  const db = await database();
  const integration = await getSlackIntegration(
    db,
    workspaceId,
    message.integrationId
  );
  const config = integration.config as SlackIntegrationConfig;
  const client = new WebClient(safeBotToken);
  const processingStartTime = Date.now();
  const { stopThinkingUpdates } = startSlackThinkingUpdates({
    client,
    safeChannel,
    safeMessageTs,
    workspaceId,
    agentId,
    integrationId: message.integrationId,
  });

  const baseUrl = resolveSlackBaseUrl();
  let conversationHistory: UIMessage[] = [];
  try {
    conversationHistory = await fetchSlackConversationHistory({
      client,
      config,
      db,
      integration,
      safeChannel,
      safeMessageTs,
      threadTs,
    });
  } catch (error) {
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

  try {
    const conversationKey = conversationId || threadTs || safeMessageTs;
    const { agentResult, generationStartedAt, generationStartTime } =
      await executeSlackAgentCall({
        workspaceId,
        agentId,
        messageText,
        baseUrl,
        conversationId: conversationKey,
        context,
        conversationHistory,
      });

    await stopThinkingUpdates();

    const responseText = agentResult.text || "No response generated.";
    await updateSlackMessage(client, safeChannel, safeMessageTs, responseText);

    const finalConversationId =
      conversationId || threadTs || safeMessageTs || randomUUID();

    try {
      await logSlackConversation({
        db,
        workspaceId,
        agentId,
        integrationId: message.integrationId,
        messageText,
        responseText,
        agentResult,
        conversationHistory,
        generationStartedAt,
        generationStartTime,
        baseUrl,
        finalConversationId,
        context,
      });
    } catch (conversationError) {
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

    await db["bot-integration"].update({
      ...integration,
      lastUsedAt: new Date().toISOString(),
    });

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
    try {
      await updateSlackMessage(
        client,
        safeChannel,
        safeMessageTs,
        `❌ Error: ${extractErrorMessage(error)}`
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

    trackEvent("bot_webhook_processing_failed", {
      workspace_id: workspaceId,
      integration_id: message.integrationId,
      platform: "slack",
      agent_id: agentId,
      error_type: error instanceof Error ? error.constructor.name : "Unknown",
      error_message: extractErrorMessage(error),
    });

    throw error;
  }
}
