import { queues } from "@architect/functions";
import { z } from "zod";

// Export schema for use in queue handler
export const BotWebhookTaskMessageSchema = z.object({
  platform: z.enum(["discord", "slack"]),
  integrationId: z.string(),
  workspaceId: z.string(),
  agentId: z.string(),
  messageText: z.string(),
  // Discord-specific
  interactionToken: z.string().optional(),
  applicationId: z.string().optional(),
  channelId: z.string().optional(),
  // Slack-specific
  botToken: z.string().optional(),
  channel: z.string().optional(),
  messageTs: z.string().optional(),
  threadTs: z.string().optional(),
  conversationId: z.string().optional(),
});

export type BotWebhookTaskMessage = z.infer<typeof BotWebhookTaskMessageSchema>;

export interface DiscordQueueData {
  interactionToken: string;
  applicationId: string;
  channelId?: string;
  botToken: string;
}

export interface SlackQueueData {
  botToken: string;
  channel: string;
  messageTs: string;
  threadTs?: string;
}

/**
 * Enqueues a bot webhook task to be processed asynchronously
 */
export async function enqueueBotWebhookTask(
  platform: "discord" | "slack",
  integrationId: string,
  workspaceId: string,
  agentId: string,
  messageText: string,
  platformData: DiscordQueueData | SlackQueueData,
  conversationId?: string
): Promise<void> {
  const message: BotWebhookTaskMessage = {
    platform,
    integrationId,
    workspaceId,
    agentId,
    messageText,
    ...platformData,
    ...(conversationId && { conversationId }),
  };

  // Validate before enqueueing (queue handler will also validate)
  BotWebhookTaskMessageSchema.parse(message);

  await queues.publish({
    name: "bot-webhook-queue",
    payload: message,
  });
}

