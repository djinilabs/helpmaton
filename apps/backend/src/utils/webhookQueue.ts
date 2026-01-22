import { queues } from "@architect/functions";
import { z } from "zod";

export const WebhookQueueMessageSchema = z
  .object({
    workspaceId: z.string(),
    agentId: z.string(),
    bodyText: z.string(),
    conversationId: z.string(),
  })
  .strict();

export type WebhookQueueMessage = z.infer<typeof WebhookQueueMessageSchema>;

export async function enqueueWebhookTask(
  workspaceId: string,
  agentId: string,
  bodyText: string,
  conversationId: string
): Promise<void> {
  const message: WebhookQueueMessage = {
    workspaceId,
    agentId,
    bodyText,
    conversationId,
  };

  // Runtime validation protects against unexpected external callers.
  WebhookQueueMessageSchema.parse(message);

  await queues.publish({
    name: "webhook-queue",
    payload: message,
  });
}
