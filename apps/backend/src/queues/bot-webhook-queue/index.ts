import type { SQSEvent } from "aws-lambda";

import {
  BotWebhookTaskMessageSchema,
  type BotWebhookTaskMessage,
} from "../../utils/botWebhookQueue";
import { handlingSQSErrors } from "../../utils/handlingSQSErrors";
import { Sentry, ensureError } from "../../utils/sentry";
import { getCurrentSQSContext } from "../../utils/workspaceCreditContext";

import { processDiscordTask } from "./discordTask";
import { processSlackTask } from "./slackTask";

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
  },
  { handlerName: "bot-webhook-queue" }
);
