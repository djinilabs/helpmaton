import { queues } from "@architect/functions";
import type { ScheduledEvent } from "aws-lambda";

import { database } from "../../tables";
import { DUE_PARTITION } from "../../utils/agentSchedule";
import { getNextRunAtEpochSeconds } from "../../utils/cron";
import { handlingScheduledErrors } from "../../utils/handlingErrors";
import { Sentry, ensureError, initSentry } from "../../utils/sentry";

initSentry();

const MAX_SCHEDULES_PER_RUN = 100;
const QUEUE_NAME = "agent-schedule-queue";

interface ScheduleRecord {
  pk: string;
  sk?: string;
  scheduleId: string;
  workspaceId: string;
  agentId: string;
  cronExpression: string;
  prompt: string;
  enabled: boolean;
  nextRunAt: number;
  duePartition: string;
}

export const handler = handlingScheduledErrors(
  async (event: ScheduledEvent): Promise<void> => {
    const db = await database();
    const now = Math.floor(Date.now() / 1000);
    const nowIso = new Date().toISOString();

    console.log("[Agent Schedules] Checking for due schedules:", {
      now,
      nowIso,
      eventTime: event.time,
    });

    const dueSchedules: ScheduleRecord[] = [];
    try {
      for await (const schedule of db["agent-schedule"].queryAsync({
        IndexName: "byNextRunAt",
        KeyConditionExpression: "duePartition = :due AND nextRunAt <= :now",
        ExpressionAttributeValues: {
          ":due": DUE_PARTITION,
          ":now": now,
        },
      })) {
        dueSchedules.push(schedule as ScheduleRecord);
        if (dueSchedules.length >= MAX_SCHEDULES_PER_RUN) {
          break;
        }
      }
    } catch (error) {
      console.error("[Agent Schedules] Failed to query due schedules:", {
        error: error instanceof Error ? error.message : String(error),
      });
      Sentry.captureException(ensureError(error), {
        tags: {
          handler: "run-agent-schedules",
          operation: "query",
        },
      });
      throw error;
    }

    if (dueSchedules.length === 0) {
      console.log("[Agent Schedules] No schedules due.");
      return;
    }

    console.log("[Agent Schedules] Found due schedules:", {
      count: dueSchedules.length,
    });

    for (const schedule of dueSchedules) {
      const {
        scheduleId,
        workspaceId,
        agentId,
        cronExpression,
        enabled,
      } = schedule;

      if (!enabled) {
        console.log("[Agent Schedules] Skipping disabled schedule:", {
          scheduleId,
          workspaceId,
          agentId,
        });
        continue;
      }

      try {
        let nextRunAt = getNextRunAtEpochSeconds(
          cronExpression,
          new Date(schedule.nextRunAt * 1000)
        );
        while (nextRunAt <= now) {
          nextRunAt = getNextRunAtEpochSeconds(
            cronExpression,
            new Date(nextRunAt * 1000)
          );
        }

        await queues.publish({
          name: QUEUE_NAME,
          payload: {
            scheduleId,
            workspaceId,
            agentId,
            enqueuedAt: nowIso,
          },
        });

        await db["agent-schedule"].update({
          ...schedule,
          nextRunAt,
          updatedAt: nowIso,
        });

        console.log("[Agent Schedules] Enqueued schedule run:", {
          scheduleId,
          workspaceId,
          agentId,
          nextRunAt,
        });
      } catch (error) {
        console.error("[Agent Schedules] Failed to enqueue schedule run:", {
          scheduleId,
          workspaceId,
          agentId,
          error: error instanceof Error ? error.message : String(error),
        });
        Sentry.captureException(ensureError(error), {
          tags: {
            handler: "run-agent-schedules",
            operation: "enqueue",
          },
          extra: {
            scheduleId,
            workspaceId,
            agentId,
          },
        });
      }
    }
  }
);
