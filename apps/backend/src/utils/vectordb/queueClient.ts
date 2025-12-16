import crypto from "crypto";

import { queues } from "@architect/functions";

import { once } from "../../utils";

import { getMessageGroupId } from "./paths";
import type { WriteOperationMessage } from "./types";

/**
 * Get the queue client from @architect/functions
 * queues is an object, not a function
 */
export const getQueueClient = once(async () => {
  // queues is already an object, not a function that needs to be called
  return queues;
});

/**
 * Generate a deduplication ID for FIFO queue messages
 * Based on operation type, agentId, temporalGrain, and data hash
 */
function generateDeduplicationId(
  message: WriteOperationMessage
): string {
  const dataHash = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        operation: message.operation,
        agentId: message.agentId,
        temporalGrain: message.temporalGrain,
        data: message.data,
        timestamp: Date.now(),
      })
    )
    .digest("hex");
  return dataHash.substring(0, 128); // SQS FIFO deduplication ID max length is 128
}

/**
 * Send a write operation message to the SQS FIFO queue
 */
export async function sendWriteOperation(
  message: WriteOperationMessage
): Promise<void> {
  const queue = await getQueueClient();
  const queueName = "agent-temporal-grain-queue";
  const messageGroupId = getMessageGroupId(
    message.agentId,
    message.temporalGrain
  );
  const deduplicationId = generateDeduplicationId(message);

  try {
    // @architect/functions queues.publish API
    // Type assertion needed as the types may not include FIFO queue properties
    await (queue.publish as (params: {
      name: string;
      payload: unknown;
      MessageGroupId?: string;
      MessageDeduplicationId?: string;
      groupId?: string;
      dedupeId?: string;
    }) => Promise<void>)({
      name: queueName,
      payload: message,
      // Try both naming conventions
      MessageGroupId: messageGroupId,
      MessageDeduplicationId: deduplicationId,
      groupId: messageGroupId,
      dedupeId: deduplicationId,
    });

    console.log(
      `[Queue Client] Sent ${message.operation} operation for agent ${message.agentId}, grain ${message.temporalGrain}`
    );
  } catch (error) {
    console.error("[Queue Client] Failed to send message:", error);
    throw new Error(
      `Failed to send write operation to queue: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

