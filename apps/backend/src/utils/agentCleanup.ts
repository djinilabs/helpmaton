import type {
  DatabaseSchemaWithAtomicUpdate,
  TableAPI,
} from "../tables/schema";

import { deleteAllRecordsForAgent } from "./conversationRecords";
import { deleteDiscordCommand } from "./discordApi";
import { deleteGraphFactsFile } from "./duckdb/graphDb";
import { removeAgentDatabases } from "./vectordb/agentRemoval";

type CleanupResult = {
  cleanupErrors: Error[];
};

type CleanupParams = {
  db: DatabaseSchemaWithAtomicUpdate;
  workspaceId: string;
  agentId: string;
};

export async function removeAgentResources(
  params: CleanupParams,
): Promise<CleanupResult> {
  const { db, workspaceId, agentId } = params;
  const cleanupErrors: Error[] = [];
  const agentPk = `agents/${workspaceId}/${agentId}`;

  const safeCleanup = async (label: string, cleanup: () => Promise<void>) => {
    try {
      await cleanup();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.warn(`[Agent Removal] Cleanup failed for ${label}:`, err.message);
      cleanupErrors.push(err);
    }
  };

  await safeCleanup("agent-keys", async () => {
    const agentKeyTable = db["agent-key"];
    for await (const key of agentKeyTable.queryAsync({
      IndexName: "byAgentId",
      KeyConditionExpression: "agentId = :agentId",
      ExpressionAttributeValues: {
        ":agentId": agentId,
      },
    })) {
      if (key.workspaceId !== workspaceId) {
        continue;
      }
      await agentKeyTable.delete(key.pk, key.sk);
    }
  });

  await safeCleanup("agent-schedules", async () => {
    const scheduleTable = db["agent-schedule"];
    for await (const schedule of scheduleTable.queryAsync({
      IndexName: "byAgentId",
      KeyConditionExpression: "agentId = :agentId",
      ExpressionAttributeValues: {
        ":agentId": agentId,
      },
    })) {
      if (schedule.workspaceId !== workspaceId) {
        continue;
      }
      await scheduleTable.delete(schedule.pk, schedule.sk);
    }
  });

  await safeCleanup("agent-conversations", async () => {
    await deleteAllRecordsForAgent(db, workspaceId, agentId);
  });

  await safeCleanup("agent-eval-judges", async () => {
    const evalJudgeTable = (db as Record<string, unknown>)[
      "agent-eval-judge"
    ] as TableAPI<"agent-eval-judge">;
    for await (const judge of evalJudgeTable.queryAsync({
      IndexName: "byAgentId",
      KeyConditionExpression: "agentId = :agentId",
      ExpressionAttributeValues: {
        ":agentId": agentId,
      },
    })) {
      if (judge.workspaceId !== workspaceId) {
        continue;
      }
      await evalJudgeTable.delete(judge.pk, judge.sk);
    }
  });

  await safeCleanup("agent-eval-results", async () => {
    const evalResultTable = (db as Record<string, unknown>)[
      "agent-eval-result"
    ] as TableAPI<"agent-eval-result">;
    for await (const result of evalResultTable.queryAsync({
      IndexName: "byAgentId",
      KeyConditionExpression: "agentId = :agentId",
      ExpressionAttributeValues: {
        ":agentId": agentId,
      },
    })) {
      if (result.workspaceId !== workspaceId) {
        continue;
      }
      await evalResultTable.delete(result.pk, result.sk);
    }
  });

  await safeCleanup("agent-stream-servers", async () => {
    const streamServerPk = `stream-servers/${workspaceId}/${agentId}`;
    await db["agent-stream-servers"].deleteIfExists(streamServerPk, "config");
  });

  await safeCleanup("agent-delegation-tasks", async () => {
    const gsi1pk = `workspace/${workspaceId}/agent/${agentId}`;
    const delegationTable = db["agent-delegation-tasks"];
    for await (const task of delegationTable.queryAsync({
      IndexName: "byWorkspaceAndAgent",
      KeyConditionExpression: "gsi1pk = :gsi1pk",
      ExpressionAttributeValues: {
        ":gsi1pk": gsi1pk,
      },
    })) {
      await delegationTable.delete(task.pk, task.sk);
    }
  });

  await safeCleanup("bot-integrations", async () => {
    const integrationTable = db["bot-integration"];
    for await (const integration of integrationTable.queryAsync({
      IndexName: "byAgentId",
      KeyConditionExpression: "agentId = :agentId",
      ExpressionAttributeValues: {
        ":agentId": agentId,
      },
    })) {
      if (integration.workspaceId !== workspaceId) {
        continue;
      }
      if (integration.platform === "discord") {
        const config = integration.config as {
          botToken?: string;
          applicationId?: string;
          discordCommand?: {
            commandName: string;
            commandId: string;
          };
        };
        if (config.discordCommand && config.applicationId && config.botToken) {
          try {
            await deleteDiscordCommand(
              config.applicationId,
              config.discordCommand.commandId,
              config.botToken,
            );
          } catch (error) {
            console.warn(
              `[Agent Removal] Failed to delete Discord command for integration ${integration.pk}:`,
              error instanceof Error ? error.message : String(error),
            );
          }
        }
      }
      await integrationTable.delete(integration.pk, integration.sk);
    }
  });

  await safeCleanup("graph-facts", async () => {
    await deleteGraphFactsFile(workspaceId, agentId);
  });

  await safeCleanup("vector-databases", async () => {
    await removeAgentDatabases(agentId);
  });

  await db.agent.delete(agentPk, "agent");

  return { cleanupErrors };
}
