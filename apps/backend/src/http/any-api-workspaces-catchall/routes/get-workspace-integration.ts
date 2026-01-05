import { notFound } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/integrations/{integrationId}:
 *   get:
 *     summary: Get bot integration
 *     description: Gets a single bot integration
 *     tags:
 *       - Integrations
 *     security:
 *       - bearerAuth: []
 */
export const registerGetWorkspaceIntegration = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/integrations/:integrationId",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.READ),
    async (req, res, next) => {
      try {
        const { workspaceId, integrationId } = req.params;
        const db = await database();

        const integrationPk = `bot-integrations/${workspaceId}/${integrationId}`;
        const integration = await db["bot-integration"].get(integrationPk, "integration");

        if (!integration) {
          throw notFound("Integration not found");
        }

        res.json({
          id: integrationId,
          platform: integration.platform,
          name: integration.name,
          agentId: integration.agentId,
          webhookUrl: integration.webhookUrl,
          status: integration.status,
          lastUsedAt: integration.lastUsedAt || null,
          createdAt: integration.createdAt,
        });
      } catch (error) {
        handleError(error, next, "GET /api/workspaces/:workspaceId/integrations/:integrationId");
      }
    }
  );
};

