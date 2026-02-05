import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { trackBusinessEvent } from "../../../utils/tracking";
import { parseLimitParam } from "../../utils/paginationParams";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/integrations:
 *   get:
 *     summary: List bot integrations
 *     description: Lists all bot integrations for a workspace
 *     tags:
 *       - Integrations
 *     security:
 *       - bearerAuth: []
 */
export const registerGetWorkspaceIntegrations = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/integrations",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.READ),
    async (req, res, next) => {
      try {
        const workspaceId = req.params.workspaceId;
        const db = await database();

        const limit = parseLimitParam(req.query.limit);
        const cursor = req.query.cursor as string | undefined;

        const query: Parameters<
          (typeof db)["bot-integration"]["queryPaginated"]
        >[0] = {
          IndexName: "byWorkspaceId",
          KeyConditionExpression: "workspaceId = :workspaceId",
          ExpressionAttributeValues: {
            ":workspaceId": workspaceId,
          },
        };

        const result = await db["bot-integration"].queryPaginated(query, {
          limit,
          cursor: cursor ?? null,
        });

        const integrations = result.items.map((integration) => {
          const config = (integration.config || {}) as {
            discordCommand?: {
              commandName: string;
              commandId: string;
            };
          };

          return {
            id: integration.pk.split("/").pop(),
            platform: integration.platform,
            name: integration.name,
            agentId: integration.agentId,
            webhookUrl: integration.webhookUrl,
            status: integration.status,
            lastUsedAt: integration.lastUsedAt || null,
            createdAt: integration.createdAt,
            discordCommand: config.discordCommand,
          };
        });

        trackBusinessEvent(
          "integrations",
          "listed",
          {
            workspace_id: workspaceId,
            integration_count: integrations.length,
          },
          req
        );

        res.json({
          integrations,
          nextCursor: result.nextCursor ?? undefined,
        });
      } catch (error) {
        handleError(error, next, "GET /api/workspaces/:workspaceId/integrations");
      }
    }
  );
};

