export const DUE_PARTITION = "due";
export const DISABLED_PARTITION = "disabled";

export const buildAgentSchedulePk = (
  workspaceId: string,
  agentId: string,
  scheduleId: string
): string => `agent-schedules/${workspaceId}/${agentId}/${scheduleId}`;
