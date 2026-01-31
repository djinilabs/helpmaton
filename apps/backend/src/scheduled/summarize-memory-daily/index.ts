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
 * Summarize working memory into day summaries for all agents
 */
export const handler = handlingScheduledErrors(
   
  async (
    _event: ScheduledEvent,
    context?: AugmentedContext
  ): Promise<void> => {
    console.log("[Daily Memory Summarization] Starting daily summarization");

    const db = await database();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

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
        workspacePermissions.items.map((p) => p.pk.replace("workspaces/", "")),
      ),
    ];

    console.log(
      `[Daily Memory Summarization] Found ${workspaceIds.length} workspaces`,
    );

    // Process each workspace
    for (const workspaceId of workspaceIds) {
      try {
        const { apiKey } = await resolveEmbeddingApiKey(workspaceId);

        // Get all agents in this workspace
        const agentsQuery = await db.agent.query({
          IndexName: "byWorkspaceId",
          KeyConditionExpression: "workspaceId = :workspaceId",
          ExpressionAttributeValues: {
            ":workspaceId": workspaceId,
          },
        });

        const agents = agentsQuery.items;
        console.log(
          `[Daily Memory Summarization] Workspace ${workspaceId}: Found ${agents.length} agents`,
        );

        // Process each agent
        for (const agent of agents) {
          try {
            const agentId = agent.pk.replace(`agents/${workspaceId}/`, "");

            // Query working memory from last 24 hours
            const workingMemory = await query(agentId, "working", {
              limit: 1000, // Get up to 1000 records
              temporalFilter: {
                startDate: yesterday.toISOString(),
                endDate: today.toISOString(),
              },
            });

            if (workingMemory.length === 0) {
              console.log(
                `[Daily Memory Summarization] Agent ${agentId}: No working memory to summarize`,
              );
              continue;
            }

            console.log(
              `[Daily Memory Summarization] Agent ${agentId}: Found ${workingMemory.length} working memory records`,
            );

            // Sort working memory by timestamp (oldest first) to ensure chronological order
            const sortedWorkingMemory = [...workingMemory].sort((a, b) => {
              const aTime = new Date(a.timestamp).getTime();
              const bTime = new Date(b.timestamp).getTime();
              return aTime - bTime;
            });

            // Extract content from sorted working memory
            const content = sortedWorkingMemory.map((record) => record.content);

            // Summarize with LLM
            const summary = await summarizeWithLLM(
              content,
              "daily",
              workspaceId,
              agentId,
              agent.summarizationPrompts,
              context,
            );

            if (!summary || summary.trim().length === 0) {
              console.log(
                `[Daily Memory Summarization] Agent ${agentId}: Empty summary, skipping`,
              );
              continue;
            }

            // Generate embedding for the summary
            const embedding = await generateEmbedding(
              summary,
              apiKey,
              undefined,
              undefined,
            );

            // Create fact record for the day summary
            const dayTimeString = formatTimeForGrain("daily", yesterday);
            const record: FactRecord = {
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
              `[Daily Memory Summarization] Agent ${agentId}: Created day summary for ${dayTimeString}`,
            );
          } catch (error) {
            console.error(
              `[Daily Memory Summarization] Error processing agent ${agent.pk}:`,
              error,
            );
            // Continue with next agent
          }
        }
      } catch (error) {
        console.error(
          `[Daily Memory Summarization] Error processing workspace ${workspaceId}:`,
          error,
        );
        // Continue with next workspace
      }
    }

    console.log("[Daily Memory Summarization] Completed daily summarization");
  },
);
