import { randomUUID } from "crypto";

import { updateDiscordMessage } from "../../http/any-api-webhooks-000type-000workspaceId-000integrationId/services/discordResponse";
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
import { startConversation, updateConversation } from "../../utils/conversationLogger";
import type { UIMessage } from "../../utils/messageTypes";
import { Sentry, ensureError } from "../../utils/sentry";
import { trackEvent } from "../../utils/tracking";
import { getCurrentSQSContext } from "../../utils/workspaceCreditContext";

type DiscordTaskContext = NonNullable<
  Awaited<ReturnType<typeof getCurrentSQSContext>>
>;

type ToolingExtraction = {
  toolCallsFromResult: unknown[];
  toolResultsFromResult: unknown[];
  reasoningFromSteps: Array<{ type: "reasoning"; text: string }>;
};

function requireDiscordFields(message: BotWebhookTaskMessage): {
  safeBotToken: string;
  safeApplicationId: string;
  safeInteractionToken: string;
} {
  const { interactionToken, applicationId, botToken } = message;
  if (!interactionToken || !applicationId || !botToken) {
    throw new Error(
      "Missing required Discord fields: interactionToken, applicationId, or botToken"
    );
  }

  return {
    safeBotToken: botToken,
    safeApplicationId: applicationId,
    safeInteractionToken: interactionToken,
  };
}

async function getDiscordIntegration(
  db: Awaited<ReturnType<typeof database>>,
  workspaceId: string,
  integrationId: string
): Promise<BotIntegrationRecord> {
  const integrationPk = `bot-integrations/${workspaceId}/${integrationId}`;
  const integration = await db["bot-integration"].get(
    integrationPk,
    "integration"
  );

  if (!integration || integration.platform !== "discord") {
    throw new Error(`Integration not found: ${integrationId}`);
  }

  return integration;
}

export function resolveDiscordBaseUrl(): string {
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

async function updateDiscordMessageSafe(options: {
  botToken: string;
  applicationId: string;
  interactionToken: string;
  content: string;
  operation: string;
  workspaceId: string;
  agentId: string;
  integrationId: string;
}): Promise<void> {
  try {
    await updateDiscordMessage(
      options.botToken,
      options.applicationId,
      options.interactionToken,
      options.content
    );
  } catch (error) {
    console.error(
      `[Bot Webhook Queue] Error updating Discord message (${options.operation}):`,
      error
    );
    Sentry.captureException(ensureError(error), {
      tags: {
        context: "bot-webhook-queue",
        platform: "discord",
        operation: options.operation,
      },
      extra: {
        workspaceId: options.workspaceId,
        agentId: options.agentId,
        integrationId: options.integrationId,
      },
      level: "warning",
    });
  }
}

function startDiscordThinkingUpdates(options: {
  botToken: string;
  applicationId: string;
  interactionToken: string;
  startTime: number;
  workspaceId: string;
  agentId: string;
  integrationId: string;
}): {
  stop: () => Promise<void>;
  markComplete: () => void;
} {
  let isComplete = false;

  const updateDiscordThinkingMessage = async (): Promise<void> => {
    if (isComplete) {
      return;
    }
    const elapsed = Math.floor((Date.now() - options.startTime) / 1000);
    await updateDiscordMessageSafe({
      botToken: options.botToken,
      applicationId: options.applicationId,
      interactionToken: options.interactionToken,
      content: `Agent is thinking... (${elapsed}s)`,
      operation: "update-thinking-message",
      workspaceId: options.workspaceId,
      agentId: options.agentId,
      integrationId: options.integrationId,
    });
  };

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
          workspaceId: options.workspaceId,
          agentId: options.agentId,
          integrationId: options.integrationId,
        },
        level: "warning",
      });
    },
  });

  const stop = async (): Promise<void> => {
    if (isComplete) {
      return;
    }
    isComplete = true;
    updateLoopAbortController.abort();
    await updateLoopPromise;
  };

  const markComplete = (): void => {
    isComplete = true;
  };

  return { stop, markComplete };
}

export function extractDiscordToolingFromResult(options: {
  rawResult?: unknown;
  generationStartedAt?: string;
}): ToolingExtraction {
  const toolCallsFromResult: unknown[] = [];
  const toolResultsFromResult: unknown[] = [];
  const reasoningFromSteps: Array<{ type: "reasoning"; text: string }> = [];

  if (!options.rawResult) {
    return {
      toolCallsFromResult,
      toolResultsFromResult,
      reasoningFromSteps,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK generateText result types are complex
  const resultAny = options.rawResult as any;
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
                  toolCallStartedAt: options.generationStartedAt,
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

  const finalToolCalls =
    toolCallsFromSteps.length > 0
      ? toolCallsFromSteps
      : (options.rawResult as { toolCalls?: unknown[] }).toolCalls || [];
  const finalToolResults =
    toolResultsFromSteps.length > 0
      ? toolResultsFromSteps
      : (options.rawResult as { toolResults?: unknown[] }).toolResults || [];

  return {
    toolCallsFromResult: finalToolCalls,
    toolResultsFromResult: finalToolResults,
    reasoningFromSteps,
  };
}

function buildDiscordAssistantContent(options: {
  responseText: string;
  toolCallsFromResult: unknown[];
  toolResultsFromResult: unknown[];
  reasoningFromSteps: Array<{ type: "reasoning"; text: string }>;
}): Array<
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

  assistantContent.push(...options.reasoningFromSteps);

  const toolCallMessages = options.toolCallsFromResult.map(formatToolCallMessage);
  const toolResultMessages = options.toolResultsFromResult.map(
    formatToolResultMessage
  );

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

  if (options.responseText && options.responseText.trim().length > 0) {
    assistantContent.push({ type: "text", text: options.responseText });
  }

  return assistantContent;
}

async function getDiscordAgentInfo(options: {
  workspaceId: string;
  agentId: string;
  baseUrl: string;
  context: DiscordTaskContext;
}): Promise<{ finalModelName: string; usesByok: boolean }> {
  const { setupAgentAndTools } = await import("../../http/utils/agentSetup");
  const { agent, usesByok } = await setupAgentAndTools(
    options.workspaceId,
    options.agentId,
    [],
    {
      modelReferer: `${options.baseUrl}/api/webhooks/discord`,
      callDepth: 0,
      maxDelegationDepth: 3,
      context: options.context,
    }
  );
  return {
    finalModelName:
      typeof agent.modelName === "string"
        ? agent.modelName
        : "openrouter/gemini-2.0-flash-exp",
    usesByok,
  };
}

async function logDiscordConversation(options: {
  db: Awaited<ReturnType<typeof database>>;
  workspaceId: string;
  agentId: string;
  messageText: string;
  responseText: string;
  agentResult: Awaited<ReturnType<typeof callAgentNonStreaming>>;
  finalConversationId: string;
  baseUrl: string;
  context: DiscordTaskContext;
  generationTimeMs?: number;
  generationStartedAt?: string;
  generationEndedAt?: string;
}): Promise<void> {
  const tooling = extractDiscordToolingFromResult({
    rawResult: options.agentResult.rawResult,
    generationStartedAt: options.generationStartedAt,
  });

  if (
    tooling.toolCallsFromResult.length === 0 &&
    tooling.toolResultsFromResult.length > 0
  ) {
    tooling.toolCallsFromResult = reconstructToolCallsFromResults(
      tooling.toolResultsFromResult,
      "Bot Webhook Queue (Discord)"
    ) as unknown as typeof tooling.toolCallsFromResult;
  }

  const assistantContent = buildDiscordAssistantContent({
    responseText: options.responseText,
    toolCallsFromResult: tooling.toolCallsFromResult,
    toolResultsFromResult: tooling.toolResultsFromResult,
    reasoningFromSteps: tooling.reasoningFromSteps,
  });

  const { finalModelName, usesByok } = await getDiscordAgentInfo({
    workspaceId: options.workspaceId,
    agentId: options.agentId,
    baseUrl: options.baseUrl,
    context: options.context,
  });

  const userMessage = convertTextToUIMessage(options.messageText);
  const messagesForLogging: UIMessage[] = options.agentResult.observerEvents
    ? buildConversationMessagesFromObserver({
        observerEvents: options.agentResult.observerEvents,
        fallbackInputMessages: [userMessage],
        assistantMeta: {
          tokenUsage: options.agentResult.tokenUsage,
          modelName: finalModelName,
          provider: "openrouter",
          openrouterGenerationId: options.agentResult.openrouterGenerationId,
          provisionalCostUsd: options.agentResult.provisionalCostUsd,
          generationTimeMs: options.generationTimeMs,
        },
      })
    : [
        userMessage,
        {
          role: "assistant",
          content:
            assistantContent.length > 0
              ? assistantContent
              : options.responseText || "",
          ...(options.agentResult.tokenUsage && {
            tokenUsage: options.agentResult.tokenUsage,
          }),
          modelName: finalModelName,
          provider: "openrouter",
          ...(options.agentResult.openrouterGenerationId && {
            openrouterGenerationId: options.agentResult.openrouterGenerationId,
          }),
          ...(options.agentResult.provisionalCostUsd !== undefined && {
            provisionalCostUsd: options.agentResult.provisionalCostUsd,
          }),
          ...(options.generationTimeMs !== undefined && {
            generationTimeMs: options.generationTimeMs,
          }),
          ...(options.generationStartedAt && {
            generationStartedAt: options.generationStartedAt,
          }),
          ...(options.generationEndedAt && {
            generationEndedAt: options.generationEndedAt,
          }),
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

  const conversationPk = `conversations/${options.workspaceId}/${options.agentId}/${options.finalConversationId}`;
  const existingConversation = await options.db["agent-conversations"].get(
    conversationPk
  );

  if (existingConversation) {
    await updateConversation(
      options.db,
      options.workspaceId,
      options.agentId,
      options.finalConversationId,
      validMessages,
      options.agentResult.tokenUsage,
      usesByok,
      undefined,
      undefined,
      "webhook"
    );
  } else {
    await startConversation(options.db, {
      workspaceId: options.workspaceId,
      agentId: options.agentId,
      conversationId: options.finalConversationId,
      conversationType: "webhook",
      messages: validMessages,
      tokenUsage: options.agentResult.tokenUsage,
      usesByok,
    });
  }
}

export async function processDiscordTask(
  message: BotWebhookTaskMessage,
  context: DiscordTaskContext
): Promise<void> {
  const {
    workspaceId,
    agentId,
    messageText,
    conversationId,
    channelId,
  } = message;

  const { safeBotToken, safeApplicationId, safeInteractionToken } =
    requireDiscordFields(message);

  const db = await database();
  const integration = await getDiscordIntegration(
    db,
    workspaceId,
    message.integrationId
  );

  const startTime = Date.now();
  const processingStartTime = Date.now();
  let generationStartTime: number | undefined;
  let generationStartedAt: string | undefined;

  await updateDiscordMessageSafe({
    botToken: safeBotToken,
    applicationId: safeApplicationId,
    interactionToken: safeInteractionToken,
    content: "Agent is thinking...",
    operation: "post-initial-message",
    workspaceId,
    agentId,
    integrationId: message.integrationId,
  });

  const thinkingUpdates = startDiscordThinkingUpdates({
    botToken: safeBotToken,
    applicationId: safeApplicationId,
    interactionToken: safeInteractionToken,
    startTime,
    workspaceId,
    agentId,
    integrationId: message.integrationId,
  });

  try {
    const baseUrl = resolveDiscordBaseUrl();

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

    await thinkingUpdates.stop();

    const responseText = agentResult.text || "No response generated.";
    await updateDiscordMessage(
      safeBotToken,
      safeApplicationId,
      safeInteractionToken,
      responseText
    );

    const finalConversationId = conversationId || channelId || randomUUID();
    const generationEndedAt = new Date().toISOString();
    const generationTimeMs =
      generationStartTime !== undefined
        ? Date.now() - generationStartTime
        : undefined;

    try {
      await logDiscordConversation({
        db,
        workspaceId,
        agentId,
        messageText,
        responseText,
        agentResult,
        finalConversationId,
        baseUrl,
        context,
        generationTimeMs,
        generationStartedAt,
        generationEndedAt,
      });
    } catch (conversationError) {
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

    await db["bot-integration"].update({
      ...integration,
      lastUsedAt: new Date().toISOString(),
    });

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
    thinkingUpdates.markComplete();
    await thinkingUpdates.stop();

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
