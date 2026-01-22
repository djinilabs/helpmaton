import type { SQSEvent } from "aws-lambda";

import { handlingSQSErrors } from "../../utils/handlingSQSErrors";
import { Sentry, ensureError } from "../../utils/sentry";
import {
  WebhookQueueMessageSchema,
  type WebhookQueueMessage,
} from "../../utils/webhookQueue";
import { getCurrentSQSContext } from "../../utils/workspaceCreditContext";

import { processWebhookTask } from "./webhookTask";

async function processWebhookQueueMessage(
  message: WebhookQueueMessage,
  messageId: string
): Promise<void> {
  const context = getCurrentSQSContext(messageId);
  if (!context) {
    throw new Error("Context not available for workspace credit transactions");
  }

  await processWebhookTask({
    workspaceId: message.workspaceId,
    agentId: message.agentId,
    bodyText: message.bodyText,
    conversationId: message.conversationId,
    subscriptionId: message.subscriptionId,
    context,
    awsRequestId: messageId,
  });
}

export const handler = handlingSQSErrors(
  async (event: SQSEvent): Promise<string[]> => {
    const failedMessageIds: string[] = [];

    for (const record of event.Records) {
      const messageId = record.messageId || "unknown";
      try {
        const body = JSON.parse(record.body);
        const message = WebhookQueueMessageSchema.parse(body);

        console.log("[Webhook Queue] Processing task:", {
          workspaceId: message.workspaceId,
          agentId: message.agentId,
          conversationId: message.conversationId,
        });

        await processWebhookQueueMessage(message, messageId);
      } catch (error) {
        console.error(
          `[Webhook Queue] Error processing message ${messageId}:`,
          error
        );
        Sentry.captureException(ensureError(error), {
          tags: {
            context: "webhook-queue",
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
