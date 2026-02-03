import type { DatabaseSchema, AgentRecord, WorkspaceRecord } from "../tables/schema";

import { queryUsageStats } from "./aggregation";

export type TimeFrame = "daily" | "weekly" | "monthly";

export interface SpendingLimit {
  timeFrame: TimeFrame;
  amount: number;
}

export interface SpendingLimitCheckResult {
  passed: boolean;
  failedLimits: Array<{
    scope: "workspace" | "agent";
    timeFrame: string;
    limit: number;
    current: number;
  }>;
}

/**
 * Calculate start date for rolling window based on time frame
 */
export function calculateRollingWindow(timeFrame: TimeFrame): Date {
  const now = new Date();
  const startDate = new Date(now);

  switch (timeFrame) {
    case "daily":
      startDate.setHours(startDate.getHours() - 24);
      break;
    case "weekly":
      startDate.setDate(startDate.getDate() - 7);
      break;
    case "monthly":
      startDate.setDate(startDate.getDate() - 30);
      break;
  }

  return startDate;
}

/**
 * Get spending in a rolling window for workspace or agent
 * Returns total cost in USD
 */
export async function getSpendingInWindow(
  db: DatabaseSchema,
  workspaceId: string,
  agentId: string | undefined,
  startDate: Date
): Promise<number> {
  const endDate = new Date();

  // Query usage stats for the date range.
  // When agentId is set, pass both workspaceId and agentId so aggregation scopes
  // agent spending to this workspace (avoids summing across workspaces that share an agentId).
  const stats = await queryUsageStats(db, {
    workspaceId,
    agentId: agentId || undefined,
    startDate,
    endDate,
  });

  // Return total cost for limits: text gen, embeddings, tool calls (in costUsd),
  // plus reranking and eval (separate fields), so limits match the displayed total.
  return (
    (stats.costUsd || 0) +
    (stats.rerankingCostUsd || 0) +
    (stats.evalCostUsd || 0)
  );
}

/**
 * Verify all spending limits are not exceeded
 * Checks both workspace and agent limits
 * Only checks limits that are defined (array may be empty or missing)
 */
export async function checkSpendingLimits(
  db: DatabaseSchema,
  workspace: WorkspaceRecord,
  agent: AgentRecord | undefined,
  estimatedCost: number
): Promise<SpendingLimitCheckResult> {
  const failedLimits: Array<{
    scope: "workspace" | "agent";
    timeFrame: string;
    limit: number;
    current: number;
  }> = [];

  // Check workspace spending limits
  if (workspace.spendingLimits && workspace.spendingLimits.length > 0) {
    // Extract workspaceId from pk (format: "workspaces/{workspaceId}")
    const workspaceId = workspace.pk.split("/")[1] || workspace.pk;
    
    for (const limit of workspace.spendingLimits) {
      const startDate = calculateRollingWindow(limit.timeFrame);
      const currentSpending = await getSpendingInWindow(
        db,
        workspaceId,
        undefined,
        startDate
      );

      // Check if adding estimated cost would exceed limit
      const totalWithEstimate = currentSpending + estimatedCost;
      if (totalWithEstimate > limit.amount) {
        failedLimits.push({
          scope: "workspace",
          timeFrame: limit.timeFrame,
          limit: limit.amount,
          current: totalWithEstimate,
        });
      }
    }
  }

  // Check agent spending limits
  if (agent?.spendingLimits && agent.spendingLimits.length > 0) {
    // Extract agentId from agent.pk (format: "agents/{workspaceId}/{agentId}")
    const agentIdParts = agent.pk.split("/");
    const agentId = agentIdParts.length >= 3 ? agentIdParts[2] : undefined;

    if (agentId) {
      // Extract workspaceId from pk (format: "workspaces/{workspaceId}")
      const workspaceId = workspace.pk.split("/")[1] || workspace.pk;
      
      for (const limit of agent.spendingLimits) {
        const startDate = calculateRollingWindow(limit.timeFrame);
        const currentSpending = await getSpendingInWindow(
          db,
          workspaceId,
          agentId,
          startDate
        );

        // Check if adding estimated cost would exceed limit
        const totalWithEstimate = currentSpending + estimatedCost;
        if (totalWithEstimate > limit.amount) {
          failedLimits.push({
            scope: "agent",
            timeFrame: limit.timeFrame,
            limit: limit.amount,
            current: totalWithEstimate,
          });
        }
      }
    }
  }

  return {
    passed: failedLimits.length === 0,
    failedLimits,
  };
}

