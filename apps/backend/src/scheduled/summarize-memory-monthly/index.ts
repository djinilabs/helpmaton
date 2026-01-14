import { randomUUID } from "crypto";

import type { ScheduledEvent } from "aws-lambda";

import { database } from "../../tables";
import { getDefined } from "../../utils";
import { generateEmbedding } from "../../utils/embedding";
import { handlingScheduledErrors } from "../../utils/handlingErrors";
import { summarizeWithLLM } from "../../utils/memory/summarizeMemory";
import { formatTimeForGrain } from "../../utils/memory/timeFormats";
import { queueMemoryWrite } from "../../utils/memory/writeMemory";
import { query } from "../../utils/vectordb/readClient";
import type { FactRecord } from "../../utils/vectordb/types";

/**
 * Summarize week summaries into month summaries for all agents
 */
export const handler = handlingScheduledErrors(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- event parameter required by Lambda handler signature
  async (_event: ScheduledEvent): Promise<void> => {
    console.log(
      "[Monthly Memory Summarization] Starting monthly summarization"
    );

    const db = await database();
    const now = new Date();
    const lastMonth = new Date(now);
    lastMonth.setMonth(lastMonth.getMonth() - 1);

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
        const agentsQuery = await db.agent.query({
          IndexName: "byWorkspaceId",
          KeyConditionExpression: "workspaceId = :workspaceId",
          ExpressionAttributeValues: {
            ":workspaceId": workspaceId,
          },
        });

        const agents = agentsQuery.items;

        for (const agent of agents) {
          try {
            const agentId = agent.pk.replace(`agents/${workspaceId}/`, "");

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
              continue;
            }

            // Sort week summaries by timestamp (oldest first) to ensure chronological order
            const sortedWeekSummaries = [...weekSummaries].sort((a, b) => {
              const aTime = new Date(a.timestamp).getTime();
              const bTime = new Date(b.timestamp).getTime();
              return aTime - bTime;
            });

            // Extract content from sorted week summaries
            const content = sortedWeekSummaries.map((record) => record.content);

            // Summarize
            const summary = await summarizeWithLLM(
              content,
              "monthly",
              workspaceId
            );

            if (!summary || summary.trim().length === 0) {
              continue;
            }

            // Generate embedding
            // Note: Embeddings use Google's API directly, workspace API keys are not supported for embeddings
            const apiKey = getDefined(
              process.env.GEMINI_API_KEY,
              "GEMINI_API_KEY is not set"
            );

            const embedding = await generateEmbedding(
              summary,
              apiKey,
              undefined,
              undefined
            );

            // Create month summary record
            const monthTimeString = formatTimeForGrain("monthly", lastMonth);
            const record: FactRecord = {
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
              `[Monthly Memory Summarization] Agent ${agentId}: Created month summary for ${monthTimeString}`
            );
          } catch (error) {
            console.error(
              `[Monthly Memory Summarization] Error processing agent ${agent.pk}:`,
              error
            );
          }
        }
      } catch (error) {
        console.error(
          `[Monthly Memory Summarization] Error processing workspace ${workspaceId}:`,
          error
        );
      }
    }

    console.log(
      "[Monthly Memory Summarization] Completed monthly summarization"
    );
  }
);
