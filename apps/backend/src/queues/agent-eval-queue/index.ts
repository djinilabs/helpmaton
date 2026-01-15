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
  // handlingSQSErrors always sets the context before calling this handler,
  // so getCurrentSQSContext will always return a context
  const context = getCurrentSQSContext(messageId);
  if (!context) {
    // This should never happen in practice since handlingSQSErrors sets the context,
    // but keep as defensive check for edge cases
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
 * 
 * Note: handlingSQSErrors processes each record separately and calls this handler
 * once per record with a single-record event. Errors should be allowed to propagate
 * so handlingSQSErrors can catch them, report to Sentry, and track failed message IDs.
 */
export const handler = handlingSQSErrors(async (event) => {
  // handlingSQSErrors calls this handler once per record with a single-record event
  // Process the single record - if it throws, handlingSQSErrors will catch it and report to Sentry
  const record = event.Records[0];
  if (!record) {
    throw new Error("No records in event");
  }

  await processEvalTask(record);

  // Return empty array - if processing succeeded, no failed message IDs
  // If processing failed, handlingSQSErrors will catch the error and track the message ID
  return [];
});
