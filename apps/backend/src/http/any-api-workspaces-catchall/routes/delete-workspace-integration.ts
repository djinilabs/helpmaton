import { notFound } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
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

        await db["bot-integration"].delete(integrationPk, "integration");

        res.status(204).send();
      } catch (error) {
        handleError(error, next, "DELETE /api/workspaces/:workspaceId/integrations/:integrationId");
      }
    }
  );
};

