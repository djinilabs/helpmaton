import type { SQSEvent } from "aws-lambda";
import { z } from "zod";

import { callAgentInternal } from "../../http/utils/agentUtils";
import { database } from "../../tables";
import { handlingSQSErrors } from "../../utils/handlingSQSErrors";
import { getCurrentSQSContext } from "../../utils/workspaceCreditContext";

// Exponential backoff configuration for delegation retries
const BACKOFF_INITIAL_DELAY_MS = 1000; // 1 second
const BACKOFF_MAX_RETRIES = 3;
const BACKOFF_MAX_DELAY_MS = 10000; // 10 seconds maximum
const BACKOFF_MULTIPLIER = 2;

/**
 * Sleep for a given duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if an error is retryable
 * Retry on network errors, timeouts, and transient failures
 */
function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  
  // Retry on timeouts
  if (message.includes("timeout")) {
    return true;
  }

  // Retry on network errors
  if (
    message.includes("network") ||
    message.includes("connection") ||
    message.includes("econnrefused") ||
    message.includes("enotfound")
  ) {
    return true;
  }

  // Retry on rate limits
  if (message.includes("rate limit") || message.includes("429")) {
    return true;
  }

  // Retry on server errors (5xx)
  if (message.includes("500") || message.includes("502") || message.includes("503") || message.includes("504")) {
    return true;
  }

  // Don't retry on permanent failures (validation errors, not found, etc.)
  return false;
}

/**
 * Message schema for delegation queue
 */
const DelegationTaskMessageSchema = z.object({
  taskId: z.string(),
  workspaceId: z.string(),
  callingAgentId: z.string(),
  targetAgentId: z.string(),
  message: z.string(),
  callDepth: z.number(),
  maxDepth: z.number(),
});

type DelegationTaskMessage = z.infer<typeof DelegationTaskMessageSchema>;

/**
 * Process a single delegation task
 */
async function processDelegationTask(
  message: DelegationTaskMessage,
  context: Awaited<ReturnType<typeof getCurrentSQSContext>>
): Promise<void> {
  const db = await database();
  const { taskId, workspaceId, callingAgentId, targetAgentId, message: taskMessage, callDepth, maxDepth } = message;

  // Update task status to running
  const taskPk = `delegation-tasks/${taskId}`;
  try {
    const existingTask = await db["agent-delegation-tasks"].get(taskPk, "task");
    if (!existingTask) {
      throw new Error(`Task ${taskId} not found`);
    }

    // Check if task was cancelled
    if (existingTask.status === "cancelled") {
      console.log(`[Delegation Queue] Task ${taskId} was cancelled, skipping`);
      return;
    }

    // Update to running
    await db["agent-delegation-tasks"].update({
      ...existingTask,
      status: "running",
    });
  } catch (error) {
    console.error(`[Delegation Queue] Error updating task to running:`, error);
    throw error;
  }

  // Retry logic with exponential backoff
  let lastError: Error | undefined;
  let result: string | undefined;

  for (let attempt = 0; attempt <= BACKOFF_MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        // Calculate delay with exponential backoff, capped at max delay
        const baseDelay = Math.min(
          BACKOFF_INITIAL_DELAY_MS * Math.pow(BACKOFF_MULTIPLIER, attempt - 1),
          BACKOFF_MAX_DELAY_MS
        );
        // Add jitter: random value between 0 and 20% of base delay
        const jitter = Math.random() * baseDelay * 0.2;
        const delay = baseDelay + jitter;

        console.log(
          `[Delegation Queue] Retrying task ${taskId} (attempt ${
            attempt + 1
          }/${BACKOFF_MAX_RETRIES + 1}) after ${Math.round(delay)}ms:`,
          {
            taskId,
            previousError:
              lastError instanceof Error
                ? lastError.message
                : String(lastError),
          }
        );

        await sleep(delay);
      }

      // Call the agent internally
      result = await callAgentInternal(
        workspaceId,
        targetAgentId,
        taskMessage,
        callDepth,
        maxDepth,
        context
      );

      // Success - break out of retry loop
      break;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if error is retryable and we have retries left
      if (attempt < BACKOFF_MAX_RETRIES && isRetryableError(error)) {
        // Will retry on next iteration
        continue;
      }

      // Not retryable or out of retries - throw to update task status
      throw error;
    }
  }

  // Update task to completed
  if (result !== undefined) {
    const completedTask = await db["agent-delegation-tasks"].get(taskPk, "task");
    if (completedTask) {
      await db["agent-delegation-tasks"].update({
        ...completedTask,
        status: "completed",
        result,
        completedAt: new Date().toISOString(),
      });
    }

    console.log(`[Delegation Queue] Task ${taskId} completed successfully`);

    // Log delegation metrics
    console.log("[Delegation Metrics]", {
      type: "async",
      workspaceId,
      callingAgentId,
      targetAgentId,
      taskId,
      callDepth,
      status: "completed",
      timestamp: new Date().toISOString(),
    });
  } else {
    // This shouldn't happen, but handle it
    const error = new Error("Delegation completed but no result returned");
    
    // Update task to failed
    const failedTask = await db["agent-delegation-tasks"].get(taskPk, "task");
    if (failedTask) {
      await db["agent-delegation-tasks"].update({
        ...failedTask,
        status: "failed",
        error: error.message,
        completedAt: new Date().toISOString(),
      });
    }

    // Log delegation metrics (failed)
    console.log("[Delegation Metrics]", {
      type: "async",
      workspaceId,
      callingAgentId,
      targetAgentId,
      taskId,
      callDepth,
      status: "failed",
      error: error.message,
      timestamp: new Date().toISOString(),
    });

    throw error;
  }
}

/**
 * Wrapper to handle errors and update task status
 */
async function processDelegationTaskWithErrorHandling(
  message: DelegationTaskMessage,
  messageId: string
): Promise<void> {
  const { taskId, workspaceId, callingAgentId, targetAgentId, callDepth } = message;
  const db = await database();
  const taskPk = `delegation-tasks/${taskId}`;

  // Get context for workspace credit transactions
  const context = getCurrentSQSContext(messageId);
  if (!context) {
    throw new Error("Context not available for workspace credit transactions");
  }

  try {
    await processDelegationTask(message, context);
  } catch (error) {
    // Update task to failed
    const errorMessage = error instanceof Error ? error.message : String(error);
    const failedTask = await db["agent-delegation-tasks"].get(taskPk, "task");
    if (failedTask) {
      await db["agent-delegation-tasks"].update({
        ...failedTask,
        status: "failed",
        error: errorMessage,
        completedAt: new Date().toISOString(),
      });
    }

    // Log delegation metrics (failed)
    console.log("[Delegation Metrics]", {
      type: "async",
      workspaceId,
      callingAgentId,
      targetAgentId,
      taskId,
      callDepth,
      status: "failed",
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });

    console.error(`[Delegation Queue] Task ${taskId} failed:`, error);
    throw error;
  }
}

/**
 * Handler for agent delegation queue
 */
export const handler = handlingSQSErrors(
  async (event: SQSEvent): Promise<string[]> => {
    const failedMessageIds: string[] = [];

    for (const record of event.Records) {
      const messageId = record.messageId || "unknown";
      try {
        const body = JSON.parse(record.body);
        const message = DelegationTaskMessageSchema.parse(body);

        console.log("[Delegation Queue] Processing task:", {
          taskId: message.taskId,
          workspaceId: message.workspaceId,
          callingAgentId: message.callingAgentId,
          targetAgentId: message.targetAgentId,
        });

        await processDelegationTaskWithErrorHandling(message, messageId);
      } catch (error) {
        console.error(
          `[Delegation Queue] Error processing message ${messageId}:`,
          error
        );
        failedMessageIds.push(messageId);
      }
    }

    return failedMessageIds;
  }
);

