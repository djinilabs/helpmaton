import { badRequest, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { removeAgentResources } from "../../../utils/agentCleanup";
import { deleteDiscordCommand } from "../../../utils/discordApi";
import { deleteDocumentSnippets } from "../../../utils/documentIndexing";
import { deleteDocument } from "../../../utils/s3";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}:
 *   delete:
 *     summary: Delete workspace
 *     description: Permanently deletes a workspace and all associated permissions, members, and resources. This action cannot be undone. Requires OWNER permission. All permission records for the workspace are also deleted.
 *     tags:
 *       - Workspaces
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: workspaceId
 *         in: path
 *         required: true
 *         description: Workspace ID
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Workspace deleted successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       410:
 *         description: Workspace not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerDeleteWorkspace = (app: express.Application) => {
  app.delete(
    "/api/workspaces/:workspaceId",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.OWNER),
    async (req, res, next) => {
      try {
        const db = await database();
        const workspaceResource = req.workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }

        const workspace = await db.workspace.get(
          workspaceResource,
          "workspace",
        );
        if (!workspace) {
          throw resourceGone("Workspace not found");
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
              `[Workspace Removal] Cleanup failed for ${label}:`,
              err.message,
            );
            cleanupErrors.push(err);
          }
        };

        await safeCleanup("agents", async () => {
          for await (const agent of db.agent.queryAsync({
            IndexName: "byWorkspaceId",
            KeyConditionExpression: "workspaceId = :workspaceId",
            ExpressionAttributeValues: {
              ":workspaceId": req.params.workspaceId,
            },
          })) {
            const agentId = agent.pk.replace(
              `agents/${req.params.workspaceId}/`,
              "",
            );
            const { cleanupErrors: agentErrors } = await removeAgentResources({
              db,
              workspaceId: req.params.workspaceId,
              agentId,
            });
            cleanupErrors.push(...agentErrors);
          }
        });

        await safeCleanup("workspace-api-keys", async () => {
          for await (const apiKey of db["workspace-api-key"].queryAsync({
            IndexName: "byWorkspaceId",
            KeyConditionExpression: "workspaceId = :workspaceId",
            ExpressionAttributeValues: {
              ":workspaceId": req.params.workspaceId,
            },
          })) {
            await db["workspace-api-key"].delete(apiKey.pk, apiKey.sk);
          }
        });

        await safeCleanup("workspace-documents", async () => {
          for await (const document of db["workspace-document"].queryAsync({
            IndexName: "byWorkspaceId",
            KeyConditionExpression: "workspaceId = :workspaceId",
            ExpressionAttributeValues: {
              ":workspaceId": req.params.workspaceId,
            },
          })) {
            const documentId = document.pk.replace(
              `workspace-documents/${req.params.workspaceId}/`,
              "",
            );
            try {
              await deleteDocumentSnippets(req.params.workspaceId, documentId);
            } catch (error) {
              const err =
                error instanceof Error ? error : new Error(String(error));
              console.warn(
                `[Workspace Removal] Failed to delete document snippets for ${documentId}:`,
                err.message,
              );
              cleanupErrors.push(err);
            }
            try {
              await deleteDocument(
                req.params.workspaceId,
                documentId,
                document.s3Key,
              );
            } catch (error) {
              const err =
                error instanceof Error ? error : new Error(String(error));
              console.warn(
                `[Workspace Removal] Failed to delete document S3 object for ${documentId}:`,
                err.message,
              );
              cleanupErrors.push(err);
            }
            await db["workspace-document"].delete(document.pk, document.sk);
          }
        });

        await safeCleanup("output-channels", async () => {
          for await (const channel of db.output_channel.queryAsync({
            IndexName: "byWorkspaceId",
            KeyConditionExpression: "workspaceId = :workspaceId",
            ExpressionAttributeValues: {
              ":workspaceId": req.params.workspaceId,
            },
          })) {
            await db.output_channel.delete(channel.pk, channel.sk);
          }
        });

        await safeCleanup("email-connections", async () => {
          for await (const connection of db["email-connection"].queryAsync({
            IndexName: "byWorkspaceId",
            KeyConditionExpression: "workspaceId = :workspaceId",
            ExpressionAttributeValues: {
              ":workspaceId": req.params.workspaceId,
            },
          })) {
            await db["email-connection"].delete(connection.pk, connection.sk);
          }
        });

        await safeCleanup("mcp-servers", async () => {
          for await (const server of db["mcp-server"].queryAsync({
            IndexName: "byWorkspaceId",
            KeyConditionExpression: "workspaceId = :workspaceId",
            ExpressionAttributeValues: {
              ":workspaceId": req.params.workspaceId,
            },
          })) {
            await db["mcp-server"].delete(server.pk, server.sk);
          }
        });

        await safeCleanup("workspace-invites", async () => {
          for await (const invite of db["workspace-invite"].queryAsync({
            IndexName: "byWorkspaceId",
            KeyConditionExpression: "workspaceId = :workspaceId",
            ExpressionAttributeValues: {
              ":workspaceId": req.params.workspaceId,
            },
          })) {
            await db["workspace-invite"].delete(invite.pk, invite.sk);
          }
        });

        await safeCleanup("trial-credit-requests", async () => {
          const requestPk = `trial-credit-requests/${req.params.workspaceId}`;
          await db["trial-credit-requests"].delete(requestPk, "request");
        });

        await safeCleanup("token-usage-aggregates", async () => {
          for await (const aggregate of db["token-usage-aggregates"].queryAsync(
            {
              IndexName: "byWorkspaceIdAndDate",
              KeyConditionExpression: "workspaceId = :workspaceId",
              ExpressionAttributeValues: {
                ":workspaceId": req.params.workspaceId,
              },
            },
          )) {
            await db["token-usage-aggregates"].delete(
              aggregate.pk,
              aggregate.sk,
            );
          }
        });

        await safeCleanup("tool-usage-aggregates", async () => {
          for await (const aggregate of db["tool-usage-aggregates"].queryAsync({
            IndexName: "byWorkspaceIdAndDate",
            KeyConditionExpression: "workspaceId = :workspaceId",
            ExpressionAttributeValues: {
              ":workspaceId": req.params.workspaceId,
            },
          })) {
            await db["tool-usage-aggregates"].delete(
              aggregate.pk,
              aggregate.sk,
            );
          }
        });

        await safeCleanup("credit-reservations", async () => {
          for await (const reservation of db["credit-reservations"].queryAsync({
            IndexName: "byWorkspaceId",
            KeyConditionExpression: "workspaceId = :workspaceId",
            ExpressionAttributeValues: {
              ":workspaceId": req.params.workspaceId,
            },
          })) {
            await db["credit-reservations"].delete(
              reservation.pk,
              reservation.sk,
            );
          }
        });

        await safeCleanup("bot-integrations", async () => {
          for await (const integration of db["bot-integration"].queryAsync({
            IndexName: "byWorkspaceId",
            KeyConditionExpression: "workspaceId = :workspaceId",
            ExpressionAttributeValues: {
              ":workspaceId": req.params.workspaceId,
            },
          })) {
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
                    `[Workspace Removal] Failed to delete Discord command for integration ${integration.pk}:`,
                    error instanceof Error ? error.message : String(error),
                  );
                }
              }
            }
            await db["bot-integration"].delete(integration.pk, integration.sk);
          }
        });

        // Delete all permissions for this workspace
        const permissions = await db.permission.query({
          KeyConditionExpression: "pk = :workspacePk",
          ExpressionAttributeValues: {
            ":workspacePk": workspaceResource,
          },
        });

        // Delete all permission records
        for (const permission of permissions.items) {
          await db.permission.delete(permission.pk, permission.sk);
        }

        // Delete workspace
        await db.workspace.delete(workspaceResource, "workspace");

        res.status(204).send();
      } catch (error) {
        handleError(error, next, "DELETE /api/workspaces/:workspaceId");
      }
    },
  );
};
