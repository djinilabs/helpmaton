import type { ScheduledEvent } from "aws-lambda";

import { database } from "../../tables";
import { handlingScheduledErrors } from "../../utils/handlingErrors";
import { calculateRetentionCutoff } from "../../utils/memory/retentionPolicies";
import type { SubscriptionPlan } from "../../utils/subscriptionPlans";
import { getSubscriptionById } from "../../utils/subscriptionUtils";
import { sendWriteOperation } from "../../utils/vectordb/queueClient";
import { query } from "../../utils/vectordb/readClient";
import { TEMPORAL_GRAINS } from "../../utils/vectordb/types";

/**
 * Clean up old memory records based on retention policies
 * Runs daily and deletes records older than the retention period for each grain
 */
export const handler = handlingScheduledErrors(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- event parameter required by Lambda handler signature
  async (_event: ScheduledEvent): Promise<void> => {
    console.log("[Memory Retention Cleanup] Starting retention cleanup");

    const db = await database();

    // Get all workspaces
    const workspacePermissions = await db.permission.query({
      IndexName: "byResourceTypeAndEntityId",
      KeyConditionExpression: "resourceType = :resourceType",
      ExpressionAttributeValues: {
        ":resourceType": "workspaces",
      },
    });

    const workspaceIds = [
      ...new Set(
        workspacePermissions.items.map((p) => p.pk.replace("workspaces/", ""))
      ),
    ];

    // Process each workspace
    for (const workspaceId of workspaceIds) {
      try {
        // Get workspace to find subscription
        const workspacePk = `workspaces/${workspaceId}`;
        const workspace = await db.workspace.get(workspacePk, "workspace");

        if (!workspace || !workspace.subscriptionId) {
          console.log(
            `[Memory Retention Cleanup] Workspace ${workspaceId}: No subscription found, skipping`
          );
          continue;
        }

        // Get subscription to determine plan
        const subscription = await getSubscriptionById(
          workspace.subscriptionId
        );
        if (!subscription) {
          console.log(
            `[Memory Retention Cleanup] Workspace ${workspaceId}: Subscription not found, skipping`
          );
          continue;
        }

        const plan = subscription.plan as SubscriptionPlan;

        // Get all agents in this workspace
        const agentsQuery = await db.agent.query({
          IndexName: "byWorkspaceId",
          KeyConditionExpression: "workspaceId = :workspaceId",
          ExpressionAttributeValues: {
            ":workspaceId": workspaceId,
          },
        });

        const agents = agentsQuery.items;

        // Process each agent
        for (const agent of agents) {
          try {
            const agentId = agent.pk.replace(`agents/${workspaceId}/`, "");

            // Process each grain, starting from shortest (working) and working up
            for (const grain of TEMPORAL_GRAINS) {
              try {
                // Calculate retention cutoff for this grain and plan
                const cutoffDate = calculateRetentionCutoff(grain, plan);

                // Query all records for this grain
                const allRecords = await query(agentId, grain, {
                  limit: 10000, // Get a large number of records
                });

                // Filter records older than cutoff
                const recordsToDelete = allRecords.filter((record) => {
                  const recordDate = new Date(record.timestamp);
                  return recordDate < cutoffDate;
                });

                if (recordsToDelete.length === 0) {
                  continue;
                }

                console.log(
                  `[Memory Retention Cleanup] Agent ${agentId}, grain ${grain}: Found ${
                    recordsToDelete.length
                  } records to delete (cutoff: ${cutoffDate.toISOString()})`
                );

                // Delete records in batches (SQS has message size limits)
                const batchSize = 100;
                for (let i = 0; i < recordsToDelete.length; i += batchSize) {
                  const batch = recordsToDelete.slice(i, i + batchSize);
                  const recordIds = batch.map((r) => r.id);

                  await sendWriteOperation({
                    operation: "delete",
                    agentId,
                    temporalGrain: grain,
                    data: {
                      recordIds,
                    },
                  });
                }

                console.log(
                  `[Memory Retention Cleanup] Agent ${agentId}, grain ${grain}: Deleted ${recordsToDelete.length} records`
                );
              } catch (error) {
                console.error(
                  `[Memory Retention Cleanup] Error processing grain ${grain} for agent ${agentId}:`,
                  error
                );
                // Continue with next grain
              }
            }
          } catch (error) {
            console.error(
              `[Memory Retention Cleanup] Error processing agent ${agent.pk}:`,
              error
            );
            // Continue with next agent
          }
        }
      } catch (error) {
        console.error(
          `[Memory Retention Cleanup] Error processing workspace ${workspaceId}:`,
          error
        );
        // Continue with next workspace
      }
    }

    console.log("[Memory Retention Cleanup] Completed retention cleanup");
  }
);

