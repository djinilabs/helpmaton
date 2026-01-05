import { WebClient } from "@slack/web-api";
import type { SQSEvent } from "aws-lambda";

import { updateDiscordMessage } from "../../http/any-api-webhooks-discord-000integrationId/services/discordResponse";
import { updateSlackMessage } from "../../http/any-api-webhooks-slack-000integrationId/services/slackResponse";
import { callAgentNonStreaming } from "../../http/utils/agentCallNonStreaming";
import { database } from "../../tables";
import {
  BotWebhookTaskMessageSchema,
  type BotWebhookTaskMessage,
} from "../../utils/botWebhookQueue";
import { handlingSQSErrors } from "../../utils/handlingSQSErrors";
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
  }

  // Helper to update the Discord message with elapsed time
  async function updateDiscordThinkingMessage(): Promise<void> {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    await updateDiscordMessage(
      safeBotToken,
      safeApplicationId,
      safeInteractionToken,
      `Agent is thinking... (${elapsed}s)`
    );
  }

  // Start background task to update message periodically
  const updateInterval = setInterval(() => {
    updateDiscordThinkingMessage().catch((error) => {
      console.error(
        "[Bot Webhook Queue] Error in Discord update interval:",
        error
      );
    });
  }, 1500);

  try {
    // Get base URL for model referer
    const webhookBaseFromEnv = process.env.WEBHOOK_BASE_URL?.trim();
    const baseUrl: string =
      webhookBaseFromEnv && webhookBaseFromEnv.length > 0
        ? webhookBaseFromEnv
        : process.env.ARC_ENV === "production"
        ? "https://api.helpmaton.com"
        : process.env.ARC_ENV === "staging"
        ? "https://staging-api.helpmaton.com"
        : "http://localhost:3333";

    // Call agent
    const agentResult = await callAgentNonStreaming(
      workspaceId,
      agentId,
      messageText,
      {
        modelReferer: `${baseUrl}/api/webhooks/discord`,
        conversationId: conversationId || channelId,
        context,
        endpointType: "webhook",
      }
    );

    clearInterval(updateInterval);

    // Update with complete response
    await updateDiscordMessage(
      safeBotToken,
      safeApplicationId,
      safeInteractionToken,
      agentResult.text || "No response generated."
    );

    // Update lastUsedAt
    await db["bot-integration"].update({
      ...integration,
      lastUsedAt: new Date().toISOString(),
    });
  } catch (error) {
    clearInterval(updateInterval);
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
    }
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

  const client = new WebClient(safeBotToken);

  // Capture start time for elapsed time calculation
  const startTime = Date.now();

  // Helper to update the Slack message with elapsed time
  async function updateSlackThinkingMessage(): Promise<void> {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    await updateSlackMessage(
      client,
      safeChannel,
      safeMessageTs,
      `Agent is thinking... (${elapsed}s)`
    );
  }

  // Start background task to update message periodically
  const updateInterval = setInterval(() => {
    updateSlackThinkingMessage().catch((error) => {
      console.error(
        "[Bot Webhook Queue] Error in Slack update interval:",
        error
      );
    });
  }, 1500);

  // Get base URL for model referer
  const webhookBaseFromEnv = process.env.WEBHOOK_BASE_URL?.trim();
  const baseUrl: string =
    webhookBaseFromEnv && webhookBaseFromEnv.length > 0
      ? webhookBaseFromEnv
      : process.env.ARC_ENV === "production"
      ? "https://api.helpmaton.com"
      : process.env.ARC_ENV === "staging"
      ? "https://staging-api.helpmaton.com"
      : "http://localhost:3333";

  try {
    // Call agent
    const agentResult = await callAgentNonStreaming(
      workspaceId,
      agentId,
      messageText,
      {
        modelReferer: `${baseUrl}/api/webhooks/slack`,
        conversationId: conversationId || threadTs || messageTs,
        context,
        endpointType: "webhook",
      }
    );

    clearInterval(updateInterval);

    // Update with complete response
    await updateSlackMessage(
      client,
      safeChannel,
      safeMessageTs,
      agentResult.text || "No response generated."
    );

    // Update lastUsedAt
    await db["bot-integration"].update({
      ...integration,
      lastUsedAt: new Date().toISOString(),
    });
  } catch (error) {
    clearInterval(updateInterval);
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
    }
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
        failedMessageIds.push(messageId);
      }
    }

    return failedMessageIds;
  }
);
