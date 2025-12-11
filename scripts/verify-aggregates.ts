#!/usr/bin/env tsx
/**
 * Verify that aggregate records were created correctly
 * 
 * Usage:
 *   pnpm verify-aggregates 2025-11-19    # Check aggregates for a specific date
 */

// Use dynamic import to handle TypeScript modules
const { database } = await import('../apps/backend/src/tables/index.ts');

async function main() {
  const args = process.argv.slice(2);
  const dateStr = args[0] || new Date().toISOString().split('T')[0];

  try {
    const db = await database();

    console.log(`\n🔍 Checking aggregates for date: ${dateStr}\n`);

    // Query all aggregates for this date using a scan-like approach
    // Since we don't have a date-only index, we'll query by workspace
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

    let totalAggregates = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCostUsd = 0;

    for (const workspaceId of workspaceIds) {
      try {
        const query = await db["token-usage-aggregates"].query({
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

        if (query.items.length > 0) {
          console.log(`📊 Workspace ${workspaceId}:`);
          for (const agg of query.items) {
            totalAggregates++;
            totalInputTokens += agg.inputTokens || 0;
            totalOutputTokens += agg.outputTokens || 0;
            totalCostUsd += agg.costUsd || 0;

            console.log(`  - Agent: ${agg.agentId || 'workspace-level'}`);
            console.log(`    Model: ${agg.modelName}, Provider: ${agg.provider}`);
            console.log(`    Tokens: ${agg.inputTokens} input + ${agg.outputTokens} output = ${agg.totalTokens} total`);
            console.log(`    Costs: $${agg.costUsd.toFixed(4)} USD, €${agg.costEur.toFixed(4)} EUR, £${agg.costGbp.toFixed(4)} GBP`);
            console.log(`    BYOK: ${agg.usesByok ? 'Yes' : 'No'}`);
            console.log('');
          }
        }
      } catch (error) {
        console.error(`Error querying workspace ${workspaceId}:`, error);
      }
    }

    console.log(`\n📈 Summary for ${dateStr}:`);
    console.log(`  Total aggregates: ${totalAggregates}`);
    console.log(`  Total input tokens: ${totalInputTokens.toLocaleString()}`);
    console.log(`  Total output tokens: ${totalOutputTokens.toLocaleString()}`);
    console.log(`  Total tokens: ${(totalInputTokens + totalOutputTokens).toLocaleString()}`);
    console.log(`  Total cost (USD): $${totalCostUsd.toFixed(4)}`);

    if (totalAggregates === 0) {
      console.log('\n⚠️  No aggregates found for this date.');
      console.log('   Make sure you have conversations for this date and run the aggregation.');
    } else {
      console.log('\n✅ Aggregates verified successfully!');
    }
  } catch (error) {
    console.error('❌ Verification failed:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  }
}

main();

