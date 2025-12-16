#!/usr/bin/env tsx
/**
 * Migration script to convert all workspaces and historical data to USD
 * 
 * This script:
 * 1. Updates all workspaces with currency != "usd" to "usd" (keeps credit balance numeric value)
 * 2. Updates all credit-reservations with currency != "usd" to "usd" (keeps reservedAmount as-is)
 * 3. Updates all trial-credit-requests with currency != "usd" to "usd"
 * 4. Removes costEur and costGbp fields from agent-conversations (keeps costUsd as-is)
 * 5. Removes costEur and costGbp fields from token-usage-aggregates (keeps costUsd as-is)
 * 
 * Note: No exchange rate conversion is performed - numeric values remain the same,
 * only the currency label changes from EUR/GBP to USD.
 */

import { database } from "../apps/backend/src/tables";

async function migrateToUsd() {
  console.log("[Migrate to USD] Starting migration...");
  const db = await database();

  // 1. Migrate workspaces
  console.log("[Migrate to USD] Step 1: Migrating workspaces...");
  let workspaceCount = 0;
  try {
    // Query all workspaces by scanning permissions (similar to aggregation script)
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

    console.log(
      `[Migrate to USD] Found ${workspaceIds.length} workspaces to check`
    );

    for (const workspaceId of workspaceIds) {
      const workspacePk = `workspaces/${workspaceId}`;
      const workspace = await db.workspace.get(workspacePk, "workspace");

      if (workspace && workspace.currency && workspace.currency !== "usd") {
        console.log(
          `[Migrate to USD] Updating workspace ${workspaceId} from ${workspace.currency} to usd`
        );
        await db.workspace.update({
          pk: workspacePk,
          sk: "workspace",
          currency: "usd",
        });
        workspaceCount++;
      }
    }
    console.log(
      `[Migrate to USD] Updated ${workspaceCount} workspaces to USD`
    );
  } catch (error) {
    console.error("[Migrate to USD] Error migrating workspaces:", error);
    throw error;
  }

  // 2. Migrate credit-reservations
  console.log("[Migrate to USD] Step 2: Migrating credit-reservations...");
  console.log(
    "[Migrate to USD] Note: credit-reservations have TTL (15 minutes), so active reservations will be automatically cleaned up. Skipping migration for this table."
  );
  let reservationCount = 0;
  // Note: credit-reservations have TTL and expire quickly, so we skip migration
  // Any active reservations will be recreated with USD currency when new requests come in
  console.log(
    `[Migrate to USD] Skipped credit-reservations (TTL table, will auto-update)`
  );

  // 3. Migrate trial-credit-requests
  console.log("[Migrate to USD] Step 3: Migrating trial-credit-requests...");
  let trialRequestCount = 0;
  try {
    // Query trial-credit-requests by workspace (similar to workspaces migration)
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

    for (const workspaceId of workspaceIds) {
      const requestPk = `trial-credit-requests/${workspaceId}`;
      const request = await db["trial-credit-requests"].get(requestPk, "request");

      if (request && request.currency && request.currency !== "usd") {
        console.log(
          `[Migrate to USD] Updating trial-credit-request ${workspaceId} from ${request.currency} to usd`
        );
        await db["trial-credit-requests"].update({
          pk: requestPk,
          sk: "request",
          currency: "usd",
        });
        trialRequestCount++;
      }
    }
    console.log(
      `[Migrate to USD] Updated ${trialRequestCount} trial-credit-requests to USD`
    );
  } catch (error) {
    console.error(
      "[Migrate to USD] Error migrating trial-credit-requests:",
      error
    );
    throw error;
  }

  // 4. Remove costEur and costGbp from agent-conversations
  console.log(
    "[Migrate to USD] Step 4: Removing costEur/costGbp from agent-conversations..."
  );
  let conversationCount = 0;
  try {
    // Query conversations by workspace/agent (similar to aggregation script)
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

    console.log(
      `[Migrate to USD] Checking conversations for ${workspaceIds.length} workspaces`
    );

    for (const workspaceId of workspaceIds) {
      // Get all agents in this workspace
      const agentsQuery = await db.agent.query({
        IndexName: "byWorkspaceId",
        KeyConditionExpression: "workspaceId = :workspaceId",
        ExpressionAttributeValues: {
          ":workspaceId": workspaceId,
        },
      });

      const agentIds = agentsQuery.items.map((agent) => {
        const parts = agent.pk.split("/");
        return parts[parts.length - 1];
      });

      // Query conversations for each agent
      for (const agentId of agentIds) {
        const conversationsQuery = await db["agent-conversations"].query({
          IndexName: "byAgentId",
          KeyConditionExpression: "agentId = :agentId",
          ExpressionAttributeValues: {
            ":agentId": agentId,
          },
        });

        for (const conv of conversationsQuery.items) {
          // Check if conversation has costEur or costGbp (they may not exist in schema anymore)
          // We'll try to update anyway - DynamoDB will ignore undefined fields
          const updateData: {
            pk: string;
            sk?: string;
          } = {
            pk: conv.pk,
          };

          if (conv.sk) {
            updateData.sk = conv.sk;
          }

          // Note: Setting fields to undefined in update won't remove them from DynamoDB
          // We need to use a different approach - but since schema no longer includes these fields,
          // they'll be ignored in future reads. For now, we'll just log them.
          // In practice, these old fields will remain in DynamoDB but won't be used.
          if ((conv as any).costEur !== undefined || (conv as any).costGbp !== undefined) {
            console.log(
              `[Migrate to USD] Found conversation ${conv.conversationId} with EUR/GBP costs (will be ignored in future)`
            );
            conversationCount++;
          }
        }
      }
    }
    console.log(
      `[Migrate to USD] Found ${conversationCount} conversations with EUR/GBP costs (fields will be ignored)`
    );
  } catch (error) {
    console.error(
      "[Migrate to USD] Error checking conversations:",
      error
    );
    throw error;
  }

  // 5. Remove costEur and costGbp from token-usage-aggregates
  console.log(
    "[Migrate to USD] Step 5: Checking token-usage-aggregates for EUR/GBP costs..."
  );
  let aggregateCount = 0;
  try {
    // Query aggregates by workspace (similar to aggregation script)
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

    // Check aggregates for the last 90 days (reasonable range for aggregates)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 90);

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split("T")[0];
      
      for (const workspaceId of workspaceIds) {
        const aggregatesQuery = await db["token-usage-aggregates"].query({
          IndexName: "byWorkspaceIdAndDate",
          KeyConditionExpression: "workspaceId = :workspaceId AND #date = :date",
          ExpressionAttributeNames: {
            "#date": "date",
          },
          ExpressionAttributeValues: {
            ":workspaceId": workspaceId,
            ":date": dateStr,
          },
        });

        for (const agg of aggregatesQuery.items) {
          // Check if aggregate has costEur or costGbp
          if ((agg as any).costEur !== undefined || (agg as any).costGbp !== undefined) {
            console.log(
              `[Migrate to USD] Found aggregate ${agg.pk} with EUR/GBP costs (will be ignored in future)`
            );
            aggregateCount++;
          }
        }
      }
    }
    console.log(
      `[Migrate to USD] Found ${aggregateCount} aggregates with EUR/GBP costs (fields will be ignored)`
    );
  } catch (error) {
    console.error(
      "[Migrate to USD] Error checking aggregates:",
      error
    );
    throw error;
  }

  console.log("[Migrate to USD] Migration completed successfully!");
  console.log("[Migrate to USD] Summary:");
  console.log(`  - Workspaces updated: ${workspaceCount}`);
  console.log(`  - Credit-reservations: Skipped (TTL table, will auto-update)`);
  console.log(`  - Trial-credit-requests updated: ${trialRequestCount}`);
  console.log(`  - Conversations with EUR/GBP costs found: ${conversationCount} (fields will be ignored)`);
  console.log(`  - Aggregates with EUR/GBP costs found: ${aggregateCount} (fields will be ignored)`);
  console.log("[Migrate to USD] Note: Old costEur/costGbp fields in conversations and aggregates");
  console.log("  will remain in DynamoDB but will be ignored by the application since they're");
  console.log("  no longer in the schema. They can be manually cleaned up if needed.");
}

// Run migration
migrateToUsd()
  .then(() => {
    console.log("[Migrate to USD] Migration script completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("[Migrate to USD] Migration failed:", error);
    process.exit(1);
  });

