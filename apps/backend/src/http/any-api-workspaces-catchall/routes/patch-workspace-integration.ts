import { badRequest, notFound, unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
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
        const { name, status, config } = req.body;
        const db = await database();

        const integrationPk = `bot-integrations/${workspaceId}/${integrationId}`;
        const integration = await db["bot-integration"].get(integrationPk, "integration");

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
          if (status !== "active" && status !== "inactive" && status !== "error") {
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
            if (config.botToken !== undefined && typeof config.botToken !== "string") {
              throw badRequest("config.botToken must be a string");
            }
            if (config.signingSecret !== undefined && typeof config.signingSecret !== "string") {
              throw badRequest("config.signingSecret must be a string");
            }
          } else if (integration.platform === "discord") {
            if (config.botToken !== undefined && typeof config.botToken !== "string") {
              throw badRequest("config.botToken must be a string");
            }
            if (config.publicKey !== undefined) {
              if (typeof config.publicKey !== "string") {
                throw badRequest("config.publicKey must be a string");
              }
              if (!/^[0-9a-fA-F]{64}$/.test(config.publicKey)) {
                throw badRequest("config.publicKey must be a 64-character hex string");
              }
            }
          }
          updates.config = { ...integration.config, ...config };
        }

        const updated = await db["bot-integration"].update(updates);

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
        });
      } catch (error) {
        handleError(error, next, "PATCH /api/workspaces/:workspaceId/integrations/:integrationId");
      }
    }
  );
};

