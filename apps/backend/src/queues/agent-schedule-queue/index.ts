import { randomUUID } from "crypto";

import type { SQSRecord } from "aws-lambda";
import { z } from "zod";

import { callAgentNonStreaming } from "../../http/utils/agentCallNonStreaming";
import { setupAgentAndTools } from "../../http/utils/agentSetup";
import {
  trackSuccessfulRequest,
  validateSubscriptionAndLimits,
} from "../../http/utils/generationRequestTracking";
import { buildConversationMessagesFromObserver } from "../../http/utils/llmObserver";
import { convertTextToUIMessage } from "../../http/utils/messageConversion";
import {
  createRequestTimeout,
  cleanupRequestTimeout,
} from "../../http/utils/requestTimeout";
import { database } from "../../tables";
import {
  buildConversationErrorInfo,
  startConversation,
} from "../../utils/conversationLogger";
import { handlingSQSErrors } from "../../utils/handlingSQSErrors";
import { Sentry, ensureError } from "../../utils/sentry";
import { getCurrentSQSContext } from "../../utils/workspaceCreditContext";

const ScheduleExecutionMessageSchema = z.object({
  scheduleId: z.string(),
  workspaceId: z.string(),
  agentId: z.string(),
  enqueuedAt: z.string().optional(),
});

type ScheduleExecutionMessage = z.infer<typeof ScheduleExecutionMessageSchema>;

async function persistScheduleConversationError(params: {
  db: Awaited<ReturnType<typeof database>>;
  workspaceId: string;
  agentId: string;
  prompt: string;
  conversationId: string;
  error: unknown;
}): Promise<void> {
  try {
    const uiMessage = convertTextToUIMessage(params.prompt);
    const errorInfo = buildConversationErrorInfo(params.error, {
      provider: "openrouter",
      modelName: undefined,
      endpoint: "scheduled",
    });

    await startConversation(params.db, {
      workspaceId: params.workspaceId,
      agentId: params.agentId,
      conversationId: params.conversationId,
      conversationType: "scheduled",
      messages: [uiMessage],
      error: errorInfo,
    });
  } catch (logError) {
    console.error("[Schedule Queue] Failed to persist error:", {
      error: logError instanceof Error ? logError.message : String(logError),
      workspaceId: params.workspaceId,
      agentId: params.agentId,
      scheduleId: params.conversationId,
    });
  }
}

async function processScheduleExecution(record: SQSRecord): Promise<void> {
  const messageId = record.messageId || "unknown";
  const context = getCurrentSQSContext(messageId);
  if (!context) {
    throw new Error("SQS context not available");
  }

  const db = await database();

  let message: ScheduleExecutionMessage;
  try {
    message = ScheduleExecutionMessageSchema.parse(
      JSON.parse(record.body) as unknown
    );
  } catch (error) {
    console.error("[Schedule Queue] Failed to parse message body:", {
      error: error instanceof Error ? error.message : String(error),
      body: record.body,
    });
    throw error;
  }

  const { scheduleId, workspaceId, agentId } = message;
  const schedulePk = `agent-schedules/${workspaceId}/${agentId}/${scheduleId}`;

  console.log("[Schedule Queue] Processing schedule execution:", {
    scheduleId,
    workspaceId,
    agentId,
    messageId: record.messageId,
  });

  const schedule = await db["agent-schedule"].get(
    schedulePk,
    "schedule"
  );
  if (!schedule) {
    console.warn("[Schedule Queue] Schedule not found, skipping:", {
      scheduleId,
      workspaceId,
      agentId,
    });
    return;
  }
  if (!schedule.enabled) {
    console.log("[Schedule Queue] Schedule disabled, skipping:", {
      scheduleId,
      workspaceId,
      agentId,
    });
    return;
  }

  const prompt = schedule.prompt;
  const conversationId = randomUUID();
  const requestTimeout = createRequestTimeout();

  try {
    const subscriptionId = await validateSubscriptionAndLimits(
      workspaceId,
      "scheduled"
    );

    const generationStartTime = Date.now();
    const agentResult = await callAgentNonStreaming(
      workspaceId,
      agentId,
      prompt,
      {
        modelReferer: "http://localhost:3000/api/scheduled",
        context,
        endpointType: "scheduled",
        conversationId,
        abortSignal: requestTimeout.signal,
      }
    );
    const generationTimeMs = Date.now() - generationStartTime;

    await trackSuccessfulRequest(
      subscriptionId,
      workspaceId,
      agentId,
      "scheduled"
    );

    const { agent, usesByok } = await setupAgentAndTools(
      workspaceId,
      agentId,
      [],
      {
        modelReferer: "http://localhost:3000/api/scheduled",
        callDepth: 0,
        maxDelegationDepth: 3,
        context,
      }
    );
    const finalModelName =
      typeof agent.modelName === "string"
        ? agent.modelName
        : "openrouter/gemini-2.0-flash-exp";

    const userMessage = convertTextToUIMessage(prompt);
    const messagesForLogging = agentResult.observerEvents
      ? buildConversationMessagesFromObserver({
          observerEvents: agentResult.observerEvents,
          fallbackInputMessages: [userMessage],
          assistantMeta: {
            tokenUsage: agentResult.tokenUsage,
            modelName: finalModelName,
            provider: "openrouter",
            openrouterGenerationId: agentResult.openrouterGenerationId,
            provisionalCostUsd: agentResult.provisionalCostUsd,
            generationTimeMs,
          },
        })
      : [userMessage];

    const validMessages = messagesForLogging.filter(
      (msg): msg is typeof userMessage =>
        msg != null &&
        typeof msg === "object" &&
        "role" in msg &&
        "content" in msg
    );

    await startConversation(db, {
      workspaceId,
      agentId,
      conversationId,
      conversationType: "scheduled",
      messages: validMessages,
      tokenUsage: agentResult.tokenUsage,
      usesByok,
    });

    await db["agent-schedule"].update({
      ...schedule,
      lastRunAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    console.log("[Schedule Queue] Schedule execution completed:", {
      scheduleId,
      workspaceId,
      agentId,
      conversationId,
    });
  } catch (error) {
    console.error("[Schedule Queue] Schedule execution failed:", {
      scheduleId,
      workspaceId,
      agentId,
      error: error instanceof Error ? error.message : String(error),
    });

    await persistScheduleConversationError({
      db,
      workspaceId,
      agentId,
      prompt,
      conversationId,
      error,
    });

    Sentry.captureException(ensureError(error), {
      tags: {
        handler: "agent-schedule-queue",
      },
      extra: {
        scheduleId,
        workspaceId,
        agentId,
        conversationId,
      },
    });

    throw error;
  } finally {
    cleanupRequestTimeout(requestTimeout);
  }
}

/**
 * Lambda handler for the agent schedule queue
 */
export const handler = handlingSQSErrors(async (event) => {
  const record = event.Records[0];
  if (!record) {
    throw new Error("No records in event");
  }

  await processScheduleExecution(record);
  return [];
});
