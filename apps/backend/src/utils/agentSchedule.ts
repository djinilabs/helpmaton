import { getNextRunAtEpochSeconds } from "./cron";

export const DUE_PARTITION = "due";
export const DISABLED_PARTITION = "disabled";

export const buildAgentSchedulePk = (
  workspaceId: string,
  agentId: string,
  scheduleId: string
): string => `agent-schedules/${workspaceId}/${agentId}/${scheduleId}`;

/** Params for creating a new agent schedule (from createAgentScheduleSchema or tool args). */
export type CreateScheduleParams = {
  name: string;
  cronExpression: string;
  prompt: string;
  enabled?: boolean;
};

/**
 * Builds the full record to create for a new agent schedule.
 * Shared by POST /api/.../schedules and meta-agent create_my_schedule tool.
 */
export function buildScheduleRecordForCreate(
  workspaceId: string,
  agentId: string,
  scheduleId: string,
  params: CreateScheduleParams
): Record<string, unknown> {
  const enabled = params.enabled ?? true;
  const now = new Date();
  const nextRunAt = getNextRunAtEpochSeconds(params.cronExpression, now);
  return {
    pk: buildAgentSchedulePk(workspaceId, agentId, scheduleId),
    sk: "schedule",
    workspaceId,
    agentId,
    scheduleId,
    name: params.name,
    cronExpression: params.cronExpression,
    prompt: params.prompt,
    enabled,
    duePartition: enabled ? DUE_PARTITION : DISABLED_PARTITION,
    nextRunAt,
    version: 1,
    createdAt: now.toISOString(),
  };
}

/** Existing schedule record (from DB) with fields needed for update. */
export type ExistingScheduleForUpdate = {
  pk: string;
  sk?: string;
  workspaceId: string;
  agentId: string;
  scheduleId: string;
  name: string;
  cronExpression: string;
  prompt: string;
  enabled: boolean;
  duePartition: string;
  nextRunAt: number;
  [key: string]: unknown;
};

/** Params for updating a schedule (from updateAgentScheduleSchema or tool args). */
export type UpdateScheduleParams = {
  name?: string;
  cronExpression?: string;
  prompt?: string;
  enabled?: boolean;
};

/**
 * Builds the update payload for an existing agent schedule (updatedAt + changed fields + duePartition/nextRunAt when needed).
 * Shared by PUT /api/.../schedules/:scheduleId and meta-agent update_my_schedule tool.
 */
export function buildScheduleUpdatePayload(
  existing: ExistingScheduleForUpdate,
  params: UpdateScheduleParams
): Record<string, unknown> {
  const updateData: Record<string, unknown> = {
    ...existing,
    updatedAt: new Date().toISOString(),
  };
  if (params.name !== undefined) updateData.name = params.name;
  if (params.prompt !== undefined) updateData.prompt = params.prompt;
  if (params.cronExpression !== undefined) {
    updateData.cronExpression = params.cronExpression;
  }
  if (params.enabled !== undefined) {
    updateData.enabled = params.enabled;
    updateData.duePartition = params.enabled
      ? DUE_PARTITION
      : DISABLED_PARTITION;
  }
  const shouldRecomputeNextRunAt =
    params.cronExpression !== undefined ||
    (params.enabled === true && !existing.enabled);
  if (shouldRecomputeNextRunAt) {
    const finalCronExpression =
      (params.cronExpression ?? existing.cronExpression) as string;
    updateData.nextRunAt = getNextRunAtEpochSeconds(
      finalCronExpression,
      new Date()
    );
  }
  return updateData;
}
