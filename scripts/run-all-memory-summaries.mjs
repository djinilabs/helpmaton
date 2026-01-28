#!/usr/bin/env node
/**
 * Script to run all memory summarizations for all agents in dev mode
 *
 * This script runs all temporal grain summarizations (daily, weekly, monthly, quarterly, yearly)
 * for all agents across all workspaces in the local database.
 *
 * Usage:
 *   pnpm run-all-memory-summaries
 */

import { randomUUID } from "crypto";

// Use dynamic imports to handle TypeScript modules
const { database } = await import("../apps/backend/src/tables/index.ts");
const { getDefined } = await import("../apps/backend/src/utils.ts");
const { generateEmbedding } = await import(
  "../apps/backend/src/utils/embedding.ts"
);
const { summarizeWithLLM } = await import(
  "../apps/backend/src/utils/memory/summarizeMemory.ts"
);
const { formatTimeForGrain } = await import(
  "../apps/backend/src/utils/memory/timeFormats.ts"
);
const { queueMemoryWrite } = await import(
  "../apps/backend/src/utils/memory/writeMemory.ts"
);
const { query } = await import(
  "../apps/backend/src/utils/vectordb/readClient.ts"
);

/**
 * Get workspace API key if it exists for the specified provider
 * Inlined from agentUtils to avoid dependency issues
 */
async function getWorkspaceApiKey(workspaceId, provider = "google") {
  const db = await database();
  const sk = "key";

  // Try new format first: workspace-api-keys/{workspaceId}/{provider}
  const newPk = `workspace-api-keys/${workspaceId}/${provider}`;
  try {
    const workspaceKey = await db["workspace-api-key"].get(newPk, sk);
    if (workspaceKey?.key) {
      return workspaceKey.key;
    }
  } catch {
    // Key doesn't exist in new format, continue to check old format
  }

  // Backward compatibility: check old format for Google provider only
  // Old format: workspace-api-keys/{workspaceId}
  if (provider === "google") {
    const oldPk = `workspace-api-keys/${workspaceId}`;
    try {
      const workspaceKey = await db["workspace-api-key"].get(oldPk, sk);
      if (workspaceKey?.key) {
        return workspaceKey.key;
      }
    } catch {
      // Old key doesn't exist either
    }
  }

  return null;
}

/**
 * Summarize working memory into daily summaries for an agent
 */
async function summarizeDaily(agentId, workspaceId, summarizationPrompts) {
  console.log(`[Daily] Starting summarization for agent ${agentId}`);

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Query working memory from last 24 hours
  const workingMemory = await query(agentId, "working", {
    limit: 1000,
    temporalFilter: {
      startDate: yesterday.toISOString(),
      endDate: today.toISOString(),
    },
  });

  if (workingMemory.length === 0) {
    console.log(`[Daily] Agent ${agentId}: No working memory to summarize`);
    return;
  }

  console.log(
    `[Daily] Agent ${agentId}: Found ${workingMemory.length} working memory records`
  );

  // Extract content from working memory
  const content = workingMemory.map((record) => record.content);

  // Summarize with LLM
  const summary = await summarizeWithLLM(
    content,
    "daily",
    workspaceId,
    summarizationPrompts
  );

  if (!summary || summary.trim().length === 0) {
    console.log(`[Daily] Agent ${agentId}: Empty summary, skipping`);
    return;
  }

  // Generate embedding for the summary
  const workspaceApiKey = await getWorkspaceApiKey(workspaceId, "google");
  const apiKey =
    workspaceApiKey ||
    getDefined(process.env.OPENROUTER_API_KEY, "OPENROUTER_API_KEY is not set");

  const embedding = await generateEmbedding(
    summary,
    apiKey,
    undefined,
    undefined
  );

  // Create fact record for the day summary
  const dayTimeString = formatTimeForGrain("daily", yesterday);
  const record = {
    id: randomUUID(),
    content: summary,
    embedding,
    timestamp: yesterday.toISOString(),
    metadata: {
      agentId,
      workspaceId,
      grain: "daily",
      timeString: dayTimeString,
    },
  };

  // Queue write to day grain database
  await queueMemoryWrite(agentId, "daily", [record]);

  console.log(
    `[Daily] Agent ${agentId}: Created day summary for ${dayTimeString}`
  );
}

/**
 * Summarize daily summaries into weekly summaries for an agent
 */
async function summarizeWeekly(agentId, workspaceId, summarizationPrompts) {
  console.log(`[Weekly] Starting summarization for agent ${agentId}`);

  const now = new Date();
  const lastWeek = new Date(now);
  lastWeek.setDate(lastWeek.getDate() - 7);

  // Query day summaries from last 7 days
  const daySummaries = await query(agentId, "daily", {
    limit: 1000,
    temporalFilter: {
      startDate: lastWeek.toISOString(),
      endDate: now.toISOString(),
    },
  });

  if (daySummaries.length === 0) {
    console.log(`[Weekly] Agent ${agentId}: No daily summaries to summarize`);
    return;
  }

  // Extract content
  const content = daySummaries.map((record) => record.content);

  // Summarize
  const summary = await summarizeWithLLM(
    content,
    "weekly",
    workspaceId,
    summarizationPrompts
  );

  if (!summary || summary.trim().length === 0) {
    console.log(`[Weekly] Agent ${agentId}: Empty summary, skipping`);
    return;
  }

  // Generate embedding
  const workspaceApiKey = await getWorkspaceApiKey(workspaceId, "google");
  const apiKey =
    workspaceApiKey ||
    getDefined(process.env.OPENROUTER_API_KEY, "OPENROUTER_API_KEY is not set");

  const embedding = await generateEmbedding(
    summary,
    apiKey,
    undefined,
    undefined
  );

  // Create week summary record
  const weekTimeString = formatTimeForGrain("weekly", lastWeek);
  const record = {
    id: randomUUID(),
    content: summary,
    embedding,
    timestamp: lastWeek.toISOString(),
    metadata: {
      agentId,
      workspaceId,
      grain: "weekly",
      timeString: weekTimeString,
    },
  };

  await queueMemoryWrite(agentId, "weekly", [record]);

  console.log(
    `[Weekly] Agent ${agentId}: Created week summary for ${weekTimeString}`
  );
}

/**
 * Summarize weekly summaries into monthly summaries for an agent
 */
async function summarizeMonthly(agentId, workspaceId, summarizationPrompts) {
  console.log(`[Monthly] Starting summarization for agent ${agentId}`);

  const now = new Date();
  const lastMonth = new Date(now);
  lastMonth.setMonth(lastMonth.getMonth() - 1);

  // Query week summaries from last 30 days
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const weekSummaries = await query(agentId, "weekly", {
    limit: 1000,
    temporalFilter: {
      startDate: thirtyDaysAgo.toISOString(),
      endDate: now.toISOString(),
    },
  });

  if (weekSummaries.length === 0) {
    console.log(`[Monthly] Agent ${agentId}: No weekly summaries to summarize`);
    return;
  }

  // Extract content
  const content = weekSummaries.map((record) => record.content);

  // Summarize
  const summary = await summarizeWithLLM(
    content,
    "monthly",
    workspaceId,
    summarizationPrompts
  );

  if (!summary || summary.trim().length === 0) {
    console.log(`[Monthly] Agent ${agentId}: Empty summary, skipping`);
    return;
  }

  // Generate embedding
  const workspaceApiKey = await getWorkspaceApiKey(workspaceId, "google");
  const apiKey =
    workspaceApiKey ||
    getDefined(process.env.OPENROUTER_API_KEY, "OPENROUTER_API_KEY is not set");

  const embedding = await generateEmbedding(
    summary,
    apiKey,
    undefined,
    undefined
  );

  // Create month summary record
  const monthTimeString = formatTimeForGrain("monthly", lastMonth);
  const record = {
    id: randomUUID(),
    content: summary,
    embedding,
    timestamp: lastMonth.toISOString(),
    metadata: {
      agentId,
      workspaceId,
      grain: "monthly",
      timeString: monthTimeString,
    },
  };

  await queueMemoryWrite(agentId, "monthly", [record]);

  console.log(
    `[Monthly] Agent ${agentId}: Created month summary for ${monthTimeString}`
  );
}

/**
 * Summarize monthly summaries into quarterly summaries for an agent
 */
async function summarizeQuarterly(agentId, workspaceId, summarizationPrompts) {
  console.log(`[Quarterly] Starting summarization for agent ${agentId}`);

  const now = new Date();
  const lastQuarter = new Date(now);
  lastQuarter.setMonth(lastQuarter.getMonth() - 3);

  // Query month summaries from last 3 months
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const monthSummaries = await query(agentId, "monthly", {
    limit: 1000,
    temporalFilter: {
      startDate: threeMonthsAgo.toISOString(),
      endDate: now.toISOString(),
    },
  });

  if (monthSummaries.length === 0) {
    console.log(
      `[Quarterly] Agent ${agentId}: No monthly summaries to summarize`
    );
    return;
  }

  // Extract content
  const content = monthSummaries.map((record) => record.content);

  // Summarize
  const summary = await summarizeWithLLM(
    content,
    "quarterly",
    workspaceId,
    summarizationPrompts
  );

  if (!summary || summary.trim().length === 0) {
    console.log(`[Quarterly] Agent ${agentId}: Empty summary, skipping`);
    return;
  }

  // Generate embedding
  const workspaceApiKey = await getWorkspaceApiKey(workspaceId, "google");
  const apiKey =
    workspaceApiKey ||
    getDefined(process.env.OPENROUTER_API_KEY, "OPENROUTER_API_KEY is not set");

  const embedding = await generateEmbedding(
    summary,
    apiKey,
    undefined,
    undefined
  );

  // Create quarter summary record
  const quarterTimeString = formatTimeForGrain("quarterly", lastQuarter);
  const record = {
    id: randomUUID(),
    content: summary,
    embedding,
    timestamp: lastQuarter.toISOString(),
    metadata: {
      agentId,
      workspaceId,
      grain: "quarterly",
      timeString: quarterTimeString,
    },
  };

  await queueMemoryWrite(agentId, "quarterly", [record]);

  console.log(
    `[Quarterly] Agent ${agentId}: Created quarter summary for ${quarterTimeString}`
  );
}

/**
 * Summarize quarterly summaries into yearly summaries for an agent
 */
async function summarizeYearly(agentId, workspaceId, summarizationPrompts) {
  console.log(`[Yearly] Starting summarization for agent ${agentId}`);

  const now = new Date();
  const lastYear = new Date(now);
  lastYear.setFullYear(lastYear.getFullYear() - 1);

  // Query quarter summaries from last 12 months
  const twelveMonthsAgo = new Date(now);
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  const quarterSummaries = await query(agentId, "quarterly", {
    limit: 1000,
    temporalFilter: {
      startDate: twelveMonthsAgo.toISOString(),
      endDate: now.toISOString(),
    },
  });

  if (quarterSummaries.length === 0) {
    console.log(
      `[Yearly] Agent ${agentId}: No quarterly summaries to summarize`
    );
    return;
  }

  // Extract content
  const content = quarterSummaries.map((record) => record.content);

  // Summarize
  const summary = await summarizeWithLLM(
    content,
    "yearly",
    workspaceId,
    summarizationPrompts
  );

  if (!summary || summary.trim().length === 0) {
    console.log(`[Yearly] Agent ${agentId}: Empty summary, skipping`);
    return;
  }

  // Generate embedding
  const workspaceApiKey = await getWorkspaceApiKey(workspaceId, "google");
  const apiKey =
    workspaceApiKey ||
    getDefined(process.env.OPENROUTER_API_KEY, "OPENROUTER_API_KEY is not set");

  const embedding = await generateEmbedding(
    summary,
    apiKey,
    undefined,
    undefined
  );

  // Create year summary record
  const yearTimeString = formatTimeForGrain("yearly", lastYear);
  const record = {
    id: randomUUID(),
    content: summary,
    embedding,
    timestamp: lastYear.toISOString(),
    metadata: {
      agentId,
      workspaceId,
      grain: "yearly",
      timeString: yearTimeString,
    },
  };

  await queueMemoryWrite(agentId, "yearly", [record]);

  console.log(
    `[Yearly] Agent ${agentId}: Created year summary for ${yearTimeString}`
  );
}

/**
 * Run all summarizations for a single agent
 */
async function runAllSummarizationsForAgent(
  agentId,
  workspaceId,
  summarizationPrompts
) {
  console.log(
    `\n=== Processing agent ${agentId} in workspace ${workspaceId} ===`
  );

  try {
    // Run summarizations in order: daily -> weekly -> monthly -> quarterly -> yearly
    await summarizeDaily(agentId, workspaceId, summarizationPrompts);
    await summarizeWeekly(agentId, workspaceId, summarizationPrompts);
    await summarizeMonthly(agentId, workspaceId, summarizationPrompts);
    await summarizeQuarterly(agentId, workspaceId, summarizationPrompts);
    await summarizeYearly(agentId, workspaceId, summarizationPrompts);

    console.log(`✅ Completed all summarizations for agent ${agentId}\n`);
  } catch (error) {
    console.error(
      `❌ Error processing agent ${agentId}:`,
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }
}

/**
 * Main function to run all summarizations for all agents
 */
async function main() {
  console.log("🚀 Starting memory summarization for all agents...\n");

  // Check if we're in dev mode
  const arcEnv = process.env.ARC_ENV;
  const nodeEnv = process.env.NODE_ENV;
  const isLocal =
    arcEnv === "testing" ||
    (arcEnv !== "production" && nodeEnv !== "production");

  if (!isLocal) {
    console.error(
      "❌ This script should only be run in local development mode!"
    );
    console.error(
      `Current environment: ARC_ENV=${arcEnv}, NODE_ENV=${nodeEnv}`
    );
    process.exit(1);
  }

  try {
    const db = await database();

    // Get all workspaces by querying permissions
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

    console.log(`Found ${workspaceIds.length} workspaces\n`);

    let totalAgents = 0;
    let processedAgents = 0;

    // Process each workspace
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

        const agents = agentsQuery.items;
        totalAgents += agents.length;

        console.log(`Workspace ${workspaceId}: Found ${agents.length} agents`);

        // Process each agent
        for (const agent of agents) {
          try {
            const agentId = agent.pk.replace(`agents/${workspaceId}/`, "");

            await runAllSummarizationsForAgent(
              agentId,
              workspaceId,
              agent.summarizationPrompts
            );
            processedAgents++;
          } catch (error) {
            console.error(
              `Error processing agent ${agent.pk}:`,
              error instanceof Error ? error.message : String(error)
            );
            // Continue with next agent
          }
        }
      } catch (error) {
        console.error(
          `Error processing workspace ${workspaceId}:`,
          error instanceof Error ? error.message : String(error)
        );
        // Continue with next workspace
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log(
      `✅ Completed summarization for ${processedAgents}/${totalAgents} agents`
    );
    console.log("=".repeat(60));
  } catch (error) {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  }
}

// Run the script
main().catch((error) => {
  console.error("❌ Unhandled error:", error);
  process.exit(1);
});
