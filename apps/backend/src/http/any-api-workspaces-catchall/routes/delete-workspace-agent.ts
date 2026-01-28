import { badRequest, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import type { TableAPI } from "../../../tables/schema";
import { deleteDiscordCommand } from "../../../utils/discordApi";
import { trackBusinessEvent } from "../../../utils/tracking";
import { removeAgentDatabases } from "../../../utils/vectordb/agentRemoval";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}:
 *   delete:
 *     summary: Delete workspace agent
 *     description: Deletes an agent from the workspace
 *     tags:
 *       - Agents
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: workspaceId
 *         in: path
 *         required: true
 *         description: Workspace ID
 *         schema:
 *           type: string
 *       - name: agentId
 *         in: path
 *         required: true
 *         description: Agent ID
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Agent deleted successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       410:
 *         description: Agent not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerDeleteWorkspaceAgent = (app: express.Application) => {
  app.delete(
    "/api/workspaces/:workspaceId/agents/:agentId",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const db = await database();
        const workspaceResource = req.workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const workspaceId = req.params.workspaceId;
        const agentId = req.params.agentId;
        const agentPk = `agents/${workspaceId}/${agentId}`;

        const agent = await db.agent.get(agentPk, "agent");
        if (!agent) {
          throw resourceGone("Agent not found");
        }

        const cleanupErrors: Error[] = [];
        const safeCleanup = async (
          label: string,
          cleanup: () => Promise<void>,
        ) => {
          try {
            await cleanup();
          } catch (error) {
            const err =
              error instanceof Error ? error : new Error(String(error));
            console.warn(
              `[Agent Removal] Cleanup failed for ${label}:`,
              err.message,
            );
            cleanupErrors.push(err);
          }
        };

        await safeCleanup("agent-keys", async () => {
          for await (const key of db["agent-key"].queryAsync({
            IndexName: "byAgentId",
            KeyConditionExpression: "agentId = :agentId",
            ExpressionAttributeValues: {
              ":agentId": agentId,
            },
          })) {
            if (key.workspaceId !== workspaceId) {
              continue;
            }
            await db["agent-key"].delete(key.pk, key.sk);
          }
        });

        await safeCleanup("agent-schedules", async () => {
          for await (const schedule of db["agent-schedule"].queryAsync({
            IndexName: "byAgentId",
            KeyConditionExpression: "agentId = :agentId",
            ExpressionAttributeValues: {
              ":agentId": agentId,
            },
          })) {
            if (schedule.workspaceId !== workspaceId) {
              continue;
            }
            await db["agent-schedule"].delete(schedule.pk, schedule.sk);
          }
        });

        await safeCleanup("agent-conversations", async () => {
          for await (const conversation of db["agent-conversations"].queryAsync(
            {
              IndexName: "byAgentId",
              KeyConditionExpression: "agentId = :agentId",
              FilterExpression: "workspaceId = :workspaceId",
              ExpressionAttributeValues: {
                ":agentId": agentId,
                ":workspaceId": workspaceId,
              },
            },
          )) {
            await db["agent-conversations"].delete(
              conversation.pk,
              conversation.sk,
            );
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
          await db["agent-stream-servers"].deleteIfExists(
            streamServerPk,
            "config",
          );
        });

        await safeCleanup("agent-delegation-tasks", async () => {
          const gsi1pk = `workspace/${workspaceId}/agent/${agentId}`;
          for await (const task of db["agent-delegation-tasks"].queryAsync({
            IndexName: "byWorkspaceAndAgent",
            KeyConditionExpression: "gsi1pk = :gsi1pk",
            ExpressionAttributeValues: {
              ":gsi1pk": gsi1pk,
            },
          })) {
            await db["agent-delegation-tasks"].delete(task.pk, task.sk);
          }
        });

        await safeCleanup("bot-integrations", async () => {
          for await (const integration of db["bot-integration"].queryAsync({
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
              if (
                config.discordCommand &&
                config.applicationId &&
                config.botToken
              ) {
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
            await db["bot-integration"].delete(integration.pk, integration.sk);
          }
        });

        await safeCleanup("vector-databases", async () => {
          await removeAgentDatabases(agentId);
        });

        // Delete agent
        await db.agent.delete(agentPk, "agent");

        // Track agent deletion
        trackBusinessEvent(
          "agent",
          "deleted",
          {
            workspace_id: workspaceId,
            agent_id: agentId,
            cleanup_errors: cleanupErrors.length,
          },
          req,
        );

        res.status(204).send();
      } catch (error) {
        handleError(
          error,
          next,
          "DELETE /api/workspaces/:workspaceId/agents/:agentId",
        );
      }
    },
  );
};
