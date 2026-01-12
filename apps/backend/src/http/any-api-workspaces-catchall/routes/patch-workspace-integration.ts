import { badRequest, notFound, unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { trackBusinessEvent } from "../../../utils/tracking";
import { validateBody } from "../../utils/bodyValidation";
import { updateIntegrationSchema } from "../../utils/schemas/workspaceSchemas";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/integrations/{integrationId}:
 *   patch:
 *     summary: Update bot integration
 *     description: Updates a bot integration (status, name, config)
 *     tags:
 *       - Integrations
 *     security:
 *       - bearerAuth: []
 */
export const registerPatchWorkspaceIntegration = (app: express.Application) => {
  app.patch(
    "/api/workspaces/:workspaceId/integrations/:integrationId",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const { workspaceId, integrationId } = req.params;
        const body = validateBody(req.body, updateIntegrationSchema);
        const { name, status, config } = body;
        const db = await database();

        const integrationPk = `bot-integrations/${workspaceId}/${integrationId}`;
        const integration = await db["bot-integration"].get(
          integrationPk,
          "integration"
        );

        if (!integration) {
          throw notFound("Integration not found");
        }

        const currentUserRef = req.userRef;
        if (!currentUserRef) {
          throw unauthorized();
        }

        const updates: Partial<typeof integration> = {
          updatedBy: currentUserRef,
          updatedAt: new Date().toISOString(),
        };

        if (name !== undefined) {
          if (typeof name !== "string") {
            throw badRequest("name must be a string");
          }
          updates.name = name;
        }

        if (status !== undefined) {
          if (
            status !== "active" &&
            status !== "inactive" &&
            status !== "error"
          ) {
            throw badRequest("status must be 'active', 'inactive', or 'error'");
          }
          updates.status = status;
        }

        if (config !== undefined) {
          if (typeof config !== "object") {
            throw badRequest("config must be an object");
          }
          // Validate platform-specific config
          if (integration.platform === "slack") {
            if (
              config.botToken !== undefined &&
              typeof config.botToken !== "string"
            ) {
              throw badRequest("config.botToken must be a string");
            }
            if (
              config.signingSecret !== undefined &&
              typeof config.signingSecret !== "string"
            ) {
              throw badRequest("config.signingSecret must be a string");
            }
            // Validate messageHistoryCount if provided
            if (config.messageHistoryCount !== undefined) {
              if (
                typeof config.messageHistoryCount !== "number" ||
                !Number.isInteger(config.messageHistoryCount) ||
                config.messageHistoryCount < 0 ||
                config.messageHistoryCount > 100
              ) {
                throw badRequest(
                  "config.messageHistoryCount must be an integer between 0 and 100"
                );
              }
            }
          } else if (integration.platform === "discord") {
            if (
              config.botToken !== undefined &&
              typeof config.botToken !== "string"
            ) {
              throw badRequest("config.botToken must be a string");
            }
            if (config.publicKey !== undefined) {
              if (typeof config.publicKey !== "string") {
                throw badRequest("config.publicKey must be a string");
              }
              if (!/^[0-9a-fA-F]{64}$/.test(config.publicKey)) {
                throw badRequest(
                  "config.publicKey must be a 64-character hex string"
                );
              }
            }
          }
          updates.config = { ...integration.config, ...config };
        }

        const updated = await db["bot-integration"].update({
          pk: integrationPk,
          sk: "integration",
          ...updates,
        });

        const updatedConfig = (updated.config || {}) as {
          discordCommand?: {
            commandName: string;
            commandId: string;
          };
        };

        // Track integration update
        const updatedFields: string[] = [];
        if (name !== undefined) updatedFields.push("name");
        if (status !== undefined) updatedFields.push("status");
        if (config !== undefined) updatedFields.push("config");

        trackBusinessEvent(
          "integration",
          "updated",
          {
            workspace_id: workspaceId,
            integration_id: integrationId,
            platform: updated.platform,
            agent_id: updated.agentId,
            status: updated.status,
            updated_fields: updatedFields,
          },
          req
        );

        res.json({
          id: integrationId,
          platform: updated.platform,
          name: updated.name,
          agentId: updated.agentId,
          webhookUrl: updated.webhookUrl,
          status: updated.status,
          lastUsedAt: updated.lastUsedAt || null,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
          discordCommand: updatedConfig.discordCommand,
        });
      } catch (error) {
        handleError(
          error,
          next,
          "PATCH /api/workspaces/:workspaceId/integrations/:integrationId"
        );
      }
    }
  );
};
