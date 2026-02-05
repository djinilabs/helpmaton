import { badRequest } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { parseLimitParam } from "../../utils/paginationParams";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/channels:
 *   get:
 *     summary: List workspace channels
 *     description: Returns all notification channels in a workspace
 *     tags:
 *       - Channels
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
 *       200:
 *         description: List of channels
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 channels:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       type:
 *                         type: string
 *                         description: Channel type (e.g., discord, slack)
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                       updatedAt:
 *                         type: string
 *                         format: date-time
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetWorkspaceChannels = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/channels",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.READ),
    async (req, res, next) => {
      try {
        const db = await database();
        const workspaceResource = req.workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const workspaceId = req.params.workspaceId;

        const limit = parseLimitParam(req.query.limit);
        const cursor = req.query.cursor as string | undefined;

        const query: Parameters<
          (typeof db)["output_channel"]["queryPaginated"]
        >[0] = {
          IndexName: "byWorkspaceId",
          KeyConditionExpression: "workspaceId = :workspaceId",
          ExpressionAttributeValues: {
            ":workspaceId": workspaceId,
          },
        };

        const result = await db["output_channel"].queryPaginated(query, {
          limit,
          cursor: cursor ?? null,
        });

        const channels = result.items.map((channel) => ({
          id: channel.channelId,
          name: channel.name,
          type: channel.type,
          createdAt: channel.createdAt,
          updatedAt: channel.updatedAt,
        }));

        res.json({
          channels,
          nextCursor: result.nextCursor ?? undefined,
        });
      } catch (error) {
        handleError(error, next, "GET /api/workspaces/:workspaceId/channels");
      }
    }
  );
};
