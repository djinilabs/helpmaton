import type {
  DatabaseSchemaWithAtomicUpdate,
  TableAPI,
} from "../tables/schema";

import { deleteDiscordCommand } from "./discordApi";
import { deleteS3Object } from "./s3";
import { removeAgentDatabases } from "./vectordb/agentRemoval";

type CleanupResult = {
  cleanupErrors: Error[];
};

type CleanupParams = {
  db: DatabaseSchemaWithAtomicUpdate;
  workspaceId: string;
  agentId: string;
};

function normalizeConversationFileKey(
  value: string,
  workspaceId: string,
): string | null {
  const keyPrefix = `conversation-files/${workspaceId}/`;
  const startIndex = value.indexOf(keyPrefix);
  if (startIndex === -1) {
    return null;
  }

  let endIndex = value.length;
  const queryIndex = value.indexOf("?", startIndex);
  if (queryIndex !== -1) {
    endIndex = Math.min(endIndex, queryIndex);
  }
  const hashIndex = value.indexOf("#", startIndex);
  if (hashIndex !== -1) {
    endIndex = Math.min(endIndex, hashIndex);
  }

  let key = value.slice(startIndex, endIndex).trim();
  key = key.replace(/[).,;:'"\]>}\s]+$/g, "");
  return key.startsWith(keyPrefix) ? key : null;
}

function collectConversationFileKeys(
  value: unknown,
  workspaceId: string,
  keys: Set<string>,
): void {
  if (typeof value === "string") {
    const key = normalizeConversationFileKey(value, workspaceId);
    if (key) {
      keys.add(key);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) =>
      collectConversationFileKeys(item, workspaceId, keys),
    );
    return;
  }

  if (value && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((item) =>
      collectConversationFileKeys(item, workspaceId, keys),
    );
  }
}

function extractConversationFileKeys(
  messages: unknown,
  workspaceId: string,
): Set<string> {
  const keys = new Set<string>();
  collectConversationFileKeys(messages, workspaceId, keys);
  return keys;
}

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
    const conversationTable = db["agent-conversations"];
    for await (const conversation of conversationTable.queryAsync({
      IndexName: "byAgentId",
      KeyConditionExpression: "agentId = :agentId",
      FilterExpression: "workspaceId = :workspaceId",
      ExpressionAttributeValues: {
        ":agentId": agentId,
        ":workspaceId": workspaceId,
      },
    })) {
      const fileKeys = extractConversationFileKeys(
        conversation.messages,
        workspaceId,
      );
      for (const key of fileKeys) {
        try {
          await deleteS3Object(key);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          console.warn(
            `[Agent Removal] Failed to delete conversation file ${key}:`,
            err.message,
          );
          cleanupErrors.push(err);
        }
      }

      await conversationTable.delete(conversation.pk, conversation.sk);
    }
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

  await safeCleanup("vector-databases", async () => {
    await removeAgentDatabases(agentId);
  });

  await db.agent.delete(agentPk, "agent");

  return { cleanupErrors };
}
