import { notFound } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { deleteDiscordCommand } from "../../../utils/discordApi";
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

        // If this is a Discord integration with a registered command, delete it from Discord
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
                config.botToken
              );
              console.log(
                `Deleted Discord command: ${config.discordCommand.commandName} (${config.discordCommand.commandId})`
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

        res.status(204).send();
      } catch (error) {
        handleError(error, next, "DELETE /api/workspaces/:workspaceId/integrations/:integrationId");
      }
    }
  );
};

