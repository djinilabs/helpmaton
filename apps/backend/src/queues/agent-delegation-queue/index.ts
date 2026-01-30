import type { SQSEvent } from "aws-lambda";
import { z } from "zod";

import { callAgentInternal } from "../../http/utils/agentUtils";
import { executeWithRequestLimits } from "../../http/utils/nonStreamingRequestLimits";
import { database } from "../../tables";
import { trackDelegation } from "../../utils/conversationLogger";
import { handlingSQSErrors } from "../../utils/handlingSQSErrors";
import { Sentry, ensureError, initSentry } from "../../utils/sentry";
import { getCurrentSQSContext } from "../../utils/workspaceCreditContext";

initSentry();

// Exponential backoff configuration for delegation retries
const BACKOFF_INITIAL_DELAY_MS = 1000; // 1 second
const BACKOFF_MAX_ATTEMPTS = 4; // Total attempts: initial + 3 retries
const BACKOFF_MAX_DELAY_MS = 10000; // 10 seconds maximum
const BACKOFF_MULTIPLIER = 2; // Doubles delay each retry: 1s, 2s, 4s, 8s (capped at 10s)

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
  const errorName = error.name?.toLowerCase() || "";

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
  if (
    message.includes("500") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504")
  ) {
    return true;
  }

  // Retry on DynamoDB throttling errors (transient)
  if (
    errorName.includes("provisionedthroughputexceeded") ||
    errorName.includes("throttling") ||
    errorName.includes("throttled") ||
    message.includes("provisionedthroughputexceeded") ||
    message.includes("throttling") ||
    message.includes("throttled") ||
    message.includes("throughput") ||
    message.includes("too many requests")
  ) {
    return true;
  }

  // Retry on DynamoDB service errors (transient)
  if (
    errorName.includes("serviceunavailable") ||
    errorName.includes("internalservererror") ||
    message.includes("service unavailable") ||
    message.includes("internal server error")
  ) {
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
  conversationId: z.string().optional(),
});

type DelegationTaskMessage = z.infer<typeof DelegationTaskMessageSchema>;

/**
 * Log delegation metrics with consistent structure
 */
function logDelegationMetrics(
  type: "async",
  workspaceId: string,
  callingAgentId: string,
  targetAgentId: string,
  taskId: string,
  callDepth: number,
  status: "completed" | "failed",
  extra?: { error?: string }
): void {
  console.log("[Delegation Metrics]", {
    type,
    workspaceId,
    callingAgentId,
    targetAgentId,
    taskId,
    callDepth,
    status,
    ...(extra ?? {}),
    timestamp: new Date().toISOString(),
  });
}

/**
 * Track delegation in conversation metadata (best-effort, errors are logged but don't fail)
 */
async function trackDelegationSafely(
  db: Awaited<ReturnType<typeof database>>,
  workspaceId: string,
  callingAgentId: string,
  conversationId: string | undefined,
  targetAgentId: string,
  taskId: string,
  status: "completed" | "failed",
  targetConversationId?: string
): Promise<void> {
  if (!conversationId) {
    return;
  }

  try {
    await trackDelegation(db, workspaceId, callingAgentId, conversationId, {
      callingAgentId,
      targetAgentId,
      targetConversationId,
      taskId,
      status,
    });
  } catch (error) {
    // Log but don't fail - delegation tracking is best-effort
    console.error("[Delegation Queue] Error tracking delegation:", {
      error: error instanceof Error ? error.message : String(error),
      workspaceId,
      callingAgentId,
      conversationId,
      taskId,
    });
    Sentry.captureException(ensureError(error), {
      tags: {
        context: "agent-delegation",
        operation: "track-delegation",
      },
      extra: {
        workspaceId,
        callingAgentId,
        targetAgentId,
        conversationId,
        taskId,
      },
      level: "warning",
    });
  }
}

/**
 * Process a single delegation task
 */
async function processDelegationTask(
  message: DelegationTaskMessage,
  context: NonNullable<Awaited<ReturnType<typeof getCurrentSQSContext>>>
): Promise<void> {
  const db = await database();
  const {
    taskId,
    workspaceId,
    callingAgentId,
    targetAgentId,
    message: taskMessage,
    callDepth,
    maxDepth,
    conversationId,
  } = message;

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
  let targetAgentConversationId: string | undefined;

  for (let attempt = 0; attempt < BACKOFF_MAX_ATTEMPTS; attempt++) {
    try {
      if (attempt > 0) {
        // Calculate delay with exponential backoff: 2^(attempt-1) seconds, capped at max delay
        // This creates delays of 1s, 2s, 4s, 8s (capped at 10s) for attempts 1, 2, 3, 4
        const baseDelay = Math.min(
          BACKOFF_INITIAL_DELAY_MS * Math.pow(BACKOFF_MULTIPLIER, attempt - 1),
          BACKOFF_MAX_DELAY_MS
        );
        // Add jitter: random value between 0 and 20% of base delay
        const jitter = Math.random() * baseDelay * 0.2;
        const delay = baseDelay + jitter;

        console.log(
          `[Delegation Queue] Retrying task ${taskId} (attempt ${attempt + 1}/${BACKOFF_MAX_ATTEMPTS}) after ${Math.round(delay)}ms:`,
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
      // Create request timeout (10 minutes) to ensure request completes before Lambda timeout (11 minutes)
      const { createRequestTimeout, cleanupRequestTimeout } = await import(
        "../../http/utils/requestTimeout"
      );
      const requestTimeout = createRequestTimeout();

      try {
        const delegationResult = await executeWithRequestLimits({
          workspaceId,
          agentId: targetAgentId,
          endpoint: "test",
          execute: () =>
            callAgentInternal(
              workspaceId,
              targetAgentId,
              taskMessage,
              callDepth,
              maxDepth,
              context,
              0, // timeoutMs deprecated, using abortSignal instead
              conversationId, // Pass conversationId from message if available
              callingAgentId, // Use callingAgentId as conversationOwnerAgentId for tracking
              requestTimeout.signal
            ),
          shouldTrack: (value) => value.shouldTrackRequest,
        });
        result = delegationResult.response;
        targetAgentConversationId = delegationResult.targetAgentConversationId;
      } finally {
        cleanupRequestTimeout(requestTimeout);
      }

      // Success - break out of retry loop
      break;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if error is retryable and we have retries left
      if (attempt < BACKOFF_MAX_ATTEMPTS - 1 && isRetryableError(error)) {
        // Will retry on next iteration
        continue;
      }

      // Not retryable or out of retries - throw to update task status
      throw error;
    }
  }

  // Update task to completed
  if (result !== undefined) {
    const completedTask = await db["agent-delegation-tasks"].get(
      taskPk,
      "task"
    );
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
    logDelegationMetrics(
      "async",
      workspaceId,
      callingAgentId,
      targetAgentId,
      taskId,
      callDepth,
      "completed"
    );

    // Track delegation in conversation metadata if conversationId is available
    await trackDelegationSafely(
      db,
      workspaceId,
      callingAgentId,
      conversationId,
      targetAgentId,
      taskId,
      "completed",
      targetAgentConversationId
    );
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
    logDelegationMetrics(
      "async",
      workspaceId,
      callingAgentId,
      targetAgentId,
      taskId,
      callDepth,
      "failed",
      { error: error.message }
    );

    // Track delegation in conversation metadata if conversationId is available
    await trackDelegationSafely(
      db,
      workspaceId,
      callingAgentId,
      conversationId,
      targetAgentId,
      taskId,
      "failed"
    );

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
  const {
    taskId,
    workspaceId,
    callingAgentId,
    targetAgentId,
    callDepth,
    conversationId,
  } = message;
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
    logDelegationMetrics(
      "async",
      workspaceId,
      callingAgentId,
      targetAgentId,
      taskId,
      callDepth,
      "failed",
      { error: errorMessage }
    );

    // Track delegation in conversation metadata if conversationId is available
    await trackDelegationSafely(
      db,
      workspaceId,
      callingAgentId,
      conversationId,
      targetAgentId,
      taskId,
      "failed"
    );

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
        // Log error before re-throwing so handlingSQSErrors wrapper can catch it
        // and report to Sentry. The wrapper will add this messageId to failedMessageIds.
        console.error(
          `[Delegation Queue] Error processing message ${messageId}:`,
          error
        );
        // Re-throw so handlingSQSErrors wrapper can catch and report to Sentry
        throw error;
      }
    }

    return failedMessageIds;
  },
  { handlerName: "agent-delegation-queue" }
);
