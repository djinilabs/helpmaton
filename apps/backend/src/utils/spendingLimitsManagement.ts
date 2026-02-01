import type { DatabaseSchema, AgentRecord, WorkspaceRecord } from "../tables/schema";

import type { SpendingLimit, TimeFrame } from "./spendingLimits";

/**
 * Get all spending limits for workspace or agent
 */
export function getSpendingLimits(
  record: WorkspaceRecord | AgentRecord
): SpendingLimit[] {
  return record.spendingLimits || [];
}

/**
 * Add a spending limit to workspace or agent
 * If limit with same timeFrame exists, replaces it
 * Uses existing tableApi.update() method (optimistic locking handled automatically)
 */
export async function addSpendingLimit(
  db: DatabaseSchema,
  workspaceId: string,
  limit: SpendingLimit,
  agentId?: string
): Promise<WorkspaceRecord | AgentRecord> {
  if (agentId) {
    // Add limit to agent
    const agentPk = `agents/${workspaceId}/${agentId}`;
    const agent = await db.agent.get(agentPk, "agent");
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    const existingLimits = agent.spendingLimits || [];
    // Check if limit with same timeFrame exists
    const existingIndex = existingLimits.findIndex(
      (l) => l.timeFrame === limit.timeFrame
    );

    let updatedLimits: SpendingLimit[];
    if (existingIndex >= 0) {
      // Replace existing limit
      updatedLimits = [...existingLimits];
      updatedLimits[existingIndex] = limit;
    } else {
      // Add new limit
      updatedLimits = [...existingLimits, limit];
    }

    return await db.agent.update({
      pk: agentPk,
      sk: "agent",
      spendingLimits: updatedLimits,
      suggestions: null,
    });
  } else {
    // Add limit to workspace
    const workspacePk = `workspaces/${workspaceId}`;
    const workspace = await db.workspace.get(workspacePk, "workspace");
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }

    const existingLimits = workspace.spendingLimits || [];
    // Check if limit with same timeFrame exists
    const existingIndex = existingLimits.findIndex(
      (l) => l.timeFrame === limit.timeFrame
    );

    let updatedLimits: SpendingLimit[];
    if (existingIndex >= 0) {
      // Replace existing limit
      updatedLimits = [...existingLimits];
      updatedLimits[existingIndex] = limit;
    } else {
      // Add new limit
      updatedLimits = [...existingLimits, limit];
    }

    return await db.workspace.update({
      pk: workspacePk,
      sk: "workspace",
      spendingLimits: updatedLimits,
      suggestions: null,
    });
  }
}

/**
 * Update existing spending limit
 * Uses existing tableApi.update() method (optimistic locking handled automatically)
 */
export async function updateSpendingLimit(
  db: DatabaseSchema,
  workspaceId: string,
  timeFrame: TimeFrame,
  amount: number,
  agentId?: string
): Promise<WorkspaceRecord | AgentRecord> {
  if (agentId) {
    // Update limit in agent
    const agentPk = `agents/${workspaceId}/${agentId}`;
    const agent = await db.agent.get(agentPk, "agent");
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    const existingLimits = agent.spendingLimits || [];
    const existingIndex = existingLimits.findIndex(
      (l) => l.timeFrame === timeFrame
    );

    if (existingIndex < 0) {
      throw new Error(
        `Spending limit with timeFrame ${timeFrame} not found for agent ${agentId}`
      );
    }

    const updatedLimits = [...existingLimits];
    updatedLimits[existingIndex] = { timeFrame, amount };

    return await db.agent.update({
      pk: agentPk,
      sk: "agent",
      spendingLimits: updatedLimits,
      suggestions: null,
    });
  } else {
    // Update limit in workspace
    const workspacePk = `workspaces/${workspaceId}`;
    const workspace = await db.workspace.get(workspacePk, "workspace");
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }

    const existingLimits = workspace.spendingLimits || [];
    const existingIndex = existingLimits.findIndex(
      (l) => l.timeFrame === timeFrame
    );

    if (existingIndex < 0) {
      throw new Error(
        `Spending limit with timeFrame ${timeFrame} not found for workspace ${workspaceId}`
      );
    }

    const updatedLimits = [...existingLimits];
    updatedLimits[existingIndex] = { timeFrame, amount };

    return await db.workspace.update({
      pk: workspacePk,
      sk: "workspace",
      spendingLimits: updatedLimits,
      suggestions: null,
    });
  }
}

/**
 * Remove a spending limit
 * Uses existing tableApi.update() method (optimistic locking handled automatically)
 */
export async function removeSpendingLimit(
  db: DatabaseSchema,
  workspaceId: string,
  timeFrame: TimeFrame,
  agentId?: string
): Promise<WorkspaceRecord | AgentRecord> {
  if (agentId) {
    // Remove limit from agent
    const agentPk = `agents/${workspaceId}/${agentId}`;
    const agent = await db.agent.get(agentPk, "agent");
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    const existingLimits = agent.spendingLimits || [];
    const updatedLimits = existingLimits.filter(
      (l) => l.timeFrame !== timeFrame
    );

    return await db.agent.update({
      pk: agentPk,
      sk: "agent",
      spendingLimits: updatedLimits.length > 0 ? updatedLimits : undefined,
      suggestions: null,
    });
  } else {
    // Remove limit from workspace
    const workspacePk = `workspaces/${workspaceId}`;
    const workspace = await db.workspace.get(workspacePk, "workspace");
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }

    const existingLimits = workspace.spendingLimits || [];
    const updatedLimits = existingLimits.filter(
      (l) => l.timeFrame !== timeFrame
    );

    return await db.workspace.update({
      pk: workspacePk,
      sk: "workspace",
      spendingLimits: updatedLimits.length > 0 ? updatedLimits : undefined,
      suggestions: null,
    });
  }
}

