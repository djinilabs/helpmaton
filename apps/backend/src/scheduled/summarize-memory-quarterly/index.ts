import { randomUUID } from "crypto";

import type { ScheduledEvent } from "aws-lambda";

import { getWorkspaceApiKey } from "../../http/utils/agentUtils";
import { database } from "../../tables";
import { getDefined } from "../../utils";
import { generateEmbedding } from "../../utils/documentSearch";
import { handlingScheduledErrors } from "../../utils/handlingErrors";
import { summarizeWithLLM } from "../../utils/memory/summarizeMemory";
import { formatTimeForGrain } from "../../utils/memory/timeFormats";
import { queueMemoryWrite } from "../../utils/memory/writeMemory";
import { query } from "../../utils/vectordb/readClient";
import type { FactRecord } from "../../utils/vectordb/types";

/**
 * Summarize month summaries into quarter summaries for all agents
 */
export const handler = handlingScheduledErrors(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- event parameter required by Lambda handler signature
  async (_event: ScheduledEvent): Promise<void> => {
    console.log(
      "[Quarterly Memory Summarization] Starting quarterly summarization"
    );

    const db = await database();
    const now = new Date();
    const lastQuarter = new Date(now);
    lastQuarter.setMonth(lastQuarter.getMonth() - 3);

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

            // Query month summaries from last quarter
            const monthSummaries = await query(agentId, "monthly", {
              limit: 1000,
              temporalFilter: {
                startDate: lastQuarter.toISOString(),
                endDate: now.toISOString(),
              },
            });

            if (monthSummaries.length === 0) {
              continue;
            }

            // Extract content
            const content = monthSummaries.map((record) => record.content);

            // Summarize
            const summary = await summarizeWithLLM(
              content,
              "quarterly",
              workspaceId
            );

            if (!summary || summary.trim().length === 0) {
              continue;
            }

            // Generate embedding
            const workspaceApiKey = await getWorkspaceApiKey(
              workspaceId,
              "google"
            );
            const apiKey =
              workspaceApiKey ||
              getDefined(
                process.env.GEMINI_API_KEY,
                "GEMINI_API_KEY is not set"
              );

            const embedding = await generateEmbedding(
              summary,
              apiKey,
              undefined,
              undefined
            );

            // Create quarter summary record
            const quarterTimeString = formatTimeForGrain(
              "quarterly",
              lastQuarter
            );
            const record: FactRecord = {
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
              `[Quarterly Memory Summarization] Agent ${agentId}: Created quarter summary for ${quarterTimeString}`
            );
          } catch (error) {
            console.error(
              `[Quarterly Memory Summarization] Error processing agent ${agent.pk}:`,
              error
            );
          }
        }
      } catch (error) {
        console.error(
          `[Quarterly Memory Summarization] Error processing workspace ${workspaceId}:`,
          error
        );
      }
    }

    console.log(
      "[Quarterly Memory Summarization] Completed quarterly summarization"
    );
  }
);

