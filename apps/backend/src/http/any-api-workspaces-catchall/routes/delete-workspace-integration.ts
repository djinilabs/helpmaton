import { notFound } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { deleteDiscordCommand } from "../../../utils/discordApi";
import { trackBusinessEvent } from "../../../utils/tracking";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/integrations/{integrationId}:
 *   delete:
 *     summary: Delete bot integration
 *     description: Deletes a bot integration
 *     tags:
 *       - Integrations
 *     security:
 *       - bearerAuth: []
 */
export const registerDeleteWorkspaceIntegration = (app: express.Application) => {
  app.delete(
    "/api/workspaces/:workspaceId/integrations/:integrationId",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const { workspaceId, integrationId } = req.params;
        const db = await database();

        const integrationPk = `bot-integrations/${workspaceId}/${integrationId}`;
        const integration = await db["bot-integration"].get(integrationPk, "integration");

        if (!integration) {
          throw notFound("Integration not found");
        }

        // Check if integration has Discord command before deletion
        let hadDiscordCommand = false;
        if (integration.platform === "discord") {
          const config = integration.config as {
            botToken?: string;
            applicationId?: string;
            discordCommand?: {
              commandName: string;
              commandId: string;
            };
          };

          hadDiscordCommand = !!(
            config.discordCommand &&
            config.applicationId &&
            config.botToken
          );

          if (hadDiscordCommand) {
            try {
              await deleteDiscordCommand(
                config.applicationId!,
                config.discordCommand!.commandId,
                config.botToken!
              );
              console.log(
                `Deleted Discord command: ${config.discordCommand!.commandName} (${config.discordCommand!.commandId})`
              );
            } catch (error) {
              // Log but don't fail - the command might already be deleted
              console.warn(
                `Failed to delete Discord command during integration deletion: ${
                  error instanceof Error ? error.message : String(error)
                }`
              );
            }
          }
        }

        await db["bot-integration"].delete(integrationPk, "integration");

        // Track integration deletion
        trackBusinessEvent(
          "integration",
          "deleted",
          {
            workspace_id: workspaceId,
            integration_id: integrationId,
            platform: integration.platform,
            agent_id: integration.agentId,
            had_discord_command: hadDiscordCommand,
          },
          req
        );

        res.status(204).send();
      } catch (error) {
        handleError(error, next, "DELETE /api/workspaces/:workspaceId/integrations/:integrationId");
      }
    }
  );
};

