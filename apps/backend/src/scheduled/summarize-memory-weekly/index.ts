import { randomUUID } from "crypto";

import type { ScheduledEvent } from "aws-lambda";

import { database } from "../../tables";
import { generateEmbedding, resolveEmbeddingApiKey } from "../../utils/embedding";
import { handlingScheduledErrors } from "../../utils/handlingErrors";
import { summarizeWithLLM } from "../../utils/memory/summarizeMemory";
import { formatTimeForGrain } from "../../utils/memory/timeFormats";
import { queueMemoryWrite } from "../../utils/memory/writeMemory";
import { initSentry } from "../../utils/sentry";
import { query } from "../../utils/vectordb/readClient";
import type { FactRecord } from "../../utils/vectordb/types";
import type { AugmentedContext } from "../../utils/workspaceCreditContext";

initSentry();

/**
 * Summarize day summaries into week summaries for all agents
 */
export const handler = handlingScheduledErrors(
   
  async (
    _event: ScheduledEvent,
    context?: AugmentedContext
  ): Promise<void> => {
    console.log("[Weekly Memory Summarization] Starting weekly summarization");

    const db = await database();
    const now = new Date();
    const lastWeek = new Date(now);
    lastWeek.setDate(lastWeek.getDate() - 7);

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
        workspacePermissions.items.map((p) => p.pk.replace("workspaces/", "")),
      ),
    ];

    // Process each workspace
    for (const workspaceId of workspaceIds) {
      try {
        const { apiKey } = await resolveEmbeddingApiKey(workspaceId);
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

            // Query day summaries from last 7 days
            const daySummaries = await query(agentId, "daily", {
              limit: 1000,
              temporalFilter: {
                startDate: lastWeek.toISOString(),
                endDate: now.toISOString(),
              },
            });

            if (daySummaries.length === 0) {
              continue;
            }

            // Sort day summaries by timestamp (oldest first) to ensure chronological order
            const sortedDaySummaries = [...daySummaries].sort((a, b) => {
              const aTime = new Date(a.timestamp).getTime();
              const bTime = new Date(b.timestamp).getTime();
              return aTime - bTime;
            });

            // Extract content from sorted day summaries
            const content = sortedDaySummaries.map((record) => record.content);

            // Summarize
            const summary = await summarizeWithLLM(
              content,
              "weekly",
              workspaceId,
              agentId,
              agent.summarizationPrompts,
              context,
            );

            if (!summary || summary.trim().length === 0) {
              continue;
            }

            // Generate embedding
            const embedding = await generateEmbedding(
              summary,
              apiKey,
              undefined,
              undefined,
            );

            // Create week summary record
            const weekTimeString = formatTimeForGrain("weekly", lastWeek);
            const record: FactRecord = {
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
              `[Weekly Memory Summarization] Agent ${agentId}: Created week summary for ${weekTimeString}`,
            );
          } catch (error) {
            console.error(
              `[Weekly Memory Summarization] Error processing agent ${agent.pk}:`,
              error,
            );
          }
        }
      } catch (error) {
        console.error(
          `[Weekly Memory Summarization] Error processing workspace ${workspaceId}:`,
          error,
        );
      }
    }

    console.log("[Weekly Memory Summarization] Completed weekly summarization");
  },
);
