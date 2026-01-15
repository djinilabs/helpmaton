import type { SQSRecord } from "aws-lambda";

import { database } from "../../tables";
import { executeEvaluation } from "../../utils/evalExecution";
import { handlingSQSErrors } from "../../utils/handlingSQSErrors";
import { getCurrentSQSContext } from "../../utils/workspaceCreditContext";

interface EvalTaskMessage {
  workspaceId: string;
  agentId: string;
  conversationId: string;
  judgeId: string;
}

/**
 * Process an evaluation task from the queue
 */
async function processEvalTask(record: SQSRecord): Promise<void> {
  const messageId = record.messageId;
  const context = getCurrentSQSContext(messageId);
  if (!context) {
    throw new Error("SQS context not available");
  }

  const db = await database();

  let message: EvalTaskMessage;
  try {
    message = JSON.parse(record.body) as EvalTaskMessage;
  } catch (error) {
    console.error("[Eval Queue] Failed to parse message body:", {
      error: error instanceof Error ? error.message : String(error),
      body: record.body,
    });
    throw error;
  }

  const { workspaceId, agentId, conversationId, judgeId } = message;

  console.log("[Eval Queue] Processing evaluation task:", {
    workspaceId,
    agentId,
    conversationId,
    judgeId,
    messageId: record.messageId,
  });

  try {
    await executeEvaluation(
      db,
      workspaceId,
      agentId,
      conversationId,
      judgeId,
      context
    );

    console.log("[Eval Queue] Evaluation completed successfully:", {
      workspaceId,
      agentId,
      conversationId,
      judgeId,
    });
  } catch (error) {
    console.error("[Eval Queue] Evaluation failed:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      workspaceId,
      agentId,
      conversationId,
      judgeId,
    });
    throw error;
  }
}

/**
 * Lambda handler for the agent eval queue
 */
export const handler = handlingSQSErrors(async (event) => {

  const failedMessageIds: string[] = [];

  for (const record of event.Records) {
    try {
      await processEvalTask(record);
    } catch (error) {
      console.error("[Eval Queue] Failed to process message:", {
        error: error instanceof Error ? error.message : String(error),
        messageId: record.messageId,
      });
      failedMessageIds.push(record.messageId);
    }
  }

  return failedMessageIds;
});
