import { randomUUID } from "crypto";

import type { ScheduledEvent } from "aws-lambda";

import { getWorkspaceApiKey } from "../../http/utils/agentUtils";
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
 * Summarize quarter summaries into year summaries for all agents
 */
export const handler = handlingScheduledErrors(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- event parameter required by Lambda handler signature
  async (_event: ScheduledEvent): Promise<void> => {
    console.log("[Yearly Memory Summarization] Starting yearly summarization");

    const db = await database();
    const now = new Date();
    const lastYear = new Date(now);
    lastYear.setFullYear(lastYear.getFullYear() - 1);

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

            // Query quarter summaries from last year
            const quarterSummaries = await query(agentId, "quarterly", {
              limit: 1000,
              temporalFilter: {
                startDate: lastYear.toISOString(),
                endDate: now.toISOString(),
              },
            });

            if (quarterSummaries.length === 0) {
              continue;
            }

            // Extract content
            const content = quarterSummaries.map((record) => record.content);

            // Summarize
            const summary = await summarizeWithLLM(
              content,
              "yearly",
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

            // Create year summary record
            const yearTimeString = formatTimeForGrain("yearly", lastYear);
            const record: FactRecord = {
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
              `[Yearly Memory Summarization] Agent ${agentId}: Created year summary for ${yearTimeString}`
            );
          } catch (error) {
            console.error(
              `[Yearly Memory Summarization] Error processing agent ${agent.pk}:`,
              error
            );
          }
        }
      } catch (error) {
        console.error(
          `[Yearly Memory Summarization] Error processing workspace ${workspaceId}:`,
          error
        );
      }
    }

    console.log("[Yearly Memory Summarization] Completed yearly summarization");
  }
);
