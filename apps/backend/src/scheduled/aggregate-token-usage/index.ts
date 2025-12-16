import type { ScheduledEvent } from "aws-lambda";

import { database } from "../../tables";
import type {
  AgentConversationRecord,
  TokenUsageAggregateRecord,
} from "../../tables/schema";
import { formatDate } from "../../utils/aggregation";
import { handlingScheduledErrors } from "../../utils/handlingErrors";

/**
 * Aggregate token usage from conversations for a specific date
 */
export async function aggregateTokenUsageForDate(date: Date): Promise<void> {
  const db = await database();
  const dateStr = formatDate(date);

  console.log(`[Aggregate Token Usage] Aggregating usage for date: ${dateStr}`);

  // Get all conversations from the previous day
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  // Query all conversations for the target date
  // Strategy: Query all agents, then query conversations for each agent filtered by date
  const allConversations: AgentConversationRecord[] = [];

  try {
    console.log(
      `[Aggregate Token Usage] Querying conversations for date range: ${startOfDay.toISOString()} to ${endOfDay.toISOString()}`
    );

    // Get all workspaces by querying the permission table
    // We'll use a scan-like approach to get all workspace IDs
    // Note: In production, you might want to maintain a separate list of active workspaces
    const workspacePermissions = await db.permission.query({
      IndexName: "byResourceTypeAndEntityId",
      KeyConditionExpression: "resourceType = :resourceType",
      ExpressionAttributeValues: {
        ":resourceType": "workspaces",
      },
    });

    // Extract unique workspace IDs from permissions
    const workspaceIds = [
      ...new Set(
        workspacePermissions.items.map((p) => p.pk.replace("workspaces/", ""))
      ),
    ];

    console.log(
      `[Aggregate Token Usage] Found ${workspaceIds.length} workspaces to process`
    );

    // For each workspace, get all agents and query their conversations
    for (const workspaceId of workspaceIds) {
      try {
        // Get all agents in this workspace
        const agentsQuery = await db.agent.query({
          IndexName: "byWorkspaceId",
          KeyConditionExpression: "workspaceId = :workspaceId",
          ExpressionAttributeValues: {
            ":workspaceId": workspaceId,
          },
        });

        const agentIds = agentsQuery.items.map((agent) => {
          // Extract agentId from pk (format: "agents/{workspaceId}/{agentId}")
          const parts = agent.pk.split("/");
          return parts[parts.length - 1];
        });

        console.log(
          `[Aggregate Token Usage] Workspace ${workspaceId}: Found ${agentIds.length} agents`
        );

        // Query conversations for each agent
        for (const agentId of agentIds) {
          try {
            const conversationsQuery = await db["agent-conversations"].query({
              IndexName: "byAgentId",
              KeyConditionExpression: "agentId = :agentId",
              ExpressionAttributeNames: {
                "#startedAt": "startedAt",
              },
              ExpressionAttributeValues: {
                ":agentId": agentId,
                ":startDate": startOfDay.toISOString(),
                ":endDate": endOfDay.toISOString(),
              },
              FilterExpression: "#startedAt BETWEEN :startDate AND :endDate",
            });

            if (conversationsQuery.items.length > 0) {
              console.log(
                `[Aggregate Token Usage] Agent ${agentId}: Found ${conversationsQuery.items.length} conversations`
              );
              allConversations.push(...conversationsQuery.items);
            }
          } catch (agentError) {
            console.error(
              `[Aggregate Token Usage] Error querying conversations for agent ${agentId}:`,
              agentError instanceof Error
                ? agentError.message
                : String(agentError)
            );
            // Continue with other agents
          }
        }
      } catch (workspaceError) {
        console.error(
          `[Aggregate Token Usage] Error processing workspace ${workspaceId}:`,
          workspaceError instanceof Error
            ? workspaceError.message
            : String(workspaceError)
        );
        // Continue with other workspaces
      }
    }

    console.log(
      `[Aggregate Token Usage] Total conversations found: ${allConversations.length}`
    );
  } catch (error) {
    console.error("[Aggregate Token Usage] Error aggregating conversations:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      date: dateStr,
    });
    throw error;
  }

  // Group conversations by workspace, agent, model, provider, and BYOK status
  const aggregates = new Map<
    string,
    {
      workspaceId?: string;
      agentId?: string;
      userId?: string;
      modelName: string;
      provider: string;
      usesByok: boolean;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costUsd: number;
    }
  >();

  for (const conv of allConversations) {
    if (!conv.tokenUsage || !conv.modelName || !conv.provider) {
      console.warn(
        `[Aggregate Token Usage] Skipping conversation due to missing required fields:`,
        {
          workspaceId: conv.workspaceId,
          agentId: conv.agentId,
          conversationId: conv.conversationId,
          missingTokenUsage: !conv.tokenUsage,
          missingModelName: !conv.modelName,
          missingProvider: !conv.provider,
        }
      );
      continue;
    }

    const tokenUsage = conv.tokenUsage;
    const key = `${conv.workspaceId || ""}:${conv.agentId || ""}:${
      conv.modelName
    }:${conv.provider}:${conv.usesByok ? "byok" : "platform"}`;

    if (!aggregates.has(key)) {
      aggregates.set(key, {
        workspaceId: conv.workspaceId,
        agentId: conv.agentId,
        modelName: conv.modelName,
        provider: conv.provider,
        usesByok: conv.usesByok === true,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      });
    }

    const agg = aggregates.get(key)!;
    agg.inputTokens += tokenUsage.promptTokens || 0;
    agg.outputTokens += tokenUsage.completionTokens || 0;
    agg.totalTokens += tokenUsage.totalTokens || 0;
    agg.costUsd += conv.costUsd || 0;
  }

  // Create aggregate records
  for (const [, aggData] of aggregates.entries()) {
    // Create aggregates at different levels: workspace, agent, user
    if (aggData.workspaceId) {
      const pk = `aggregates/${aggData.workspaceId}/${dateStr}`;
      const sk = `${aggData.agentId || "workspace"}:${aggData.modelName}:${
        aggData.provider
      }:${aggData.usesByok ? "byok" : "platform"}`;

      const aggregate: Omit<TokenUsageAggregateRecord, "version"> = {
        pk,
        sk,
        date: dateStr,
        aggregateType: aggData.agentId ? "agent" : "workspace",
        workspaceId: aggData.workspaceId,
        agentId: aggData.agentId,
        modelName: aggData.modelName,
        provider: aggData.provider,
        usesByok: aggData.usesByok ? true : undefined,
        inputTokens: aggData.inputTokens,
        outputTokens: aggData.outputTokens,
        totalTokens: aggData.totalTokens,
        costUsd: aggData.costUsd,
        createdAt: new Date().toISOString(),
      };

      await db["token-usage-aggregates"].upsert(aggregate);
    }
  }

  console.log(
    `[Aggregate Token Usage] Created ${aggregates.size} aggregate records for ${dateStr}`
  );
}

/**
 * Aggregate token usage for the previous day
 */
export async function aggregatePreviousDay(): Promise<void> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  await aggregateTokenUsageForDate(yesterday);
}

/**
 * Lambda handler for scheduled aggregation
 */
export const handler = handlingScheduledErrors(
  async (event: ScheduledEvent): Promise<void> => {
    console.log("[Aggregate Token Usage] Scheduled event received:", event);
    await aggregatePreviousDay();
  }
);
