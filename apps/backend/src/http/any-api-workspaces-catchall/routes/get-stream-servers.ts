import { badRequest } from "@hapi/boom";
import express from "express";

import { PERMISSION_LEVELS } from "../../../tables/schema";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/stream-servers:
 *   get:
 *     summary: Get agent stream server configuration
 *     description: Returns stream server configuration for an agent including secret and allowed origins
 *     tags:
 *       - Agents
 *       - Streams
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
 *       200:
 *         description: Stream server configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 secret:
 *                   type: string
 *                   description: Stream server secret for authentication
 *                 allowedOrigins:
 *                   type: array
 *                   items:
 *                     type: string
 *                   description: Allowed CORS origins
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         description: Stream server configuration not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetStreamServers = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/agents/:agentId/stream-servers",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.READ),
    asyncHandler(async (req, res) => {
      const { workspaceId, agentId } = req.params;

      if (!workspaceId || !agentId) {
        throw badRequest("workspaceId and agentId are required");
      }

      const { getStreamServerConfig } = await import(
        "../../../utils/streamServerUtils"
      );

      const config = await getStreamServerConfig(workspaceId, agentId);

      if (!config) {
        return res
          .status(404)
          .json({ error: "Stream server configuration not found" });
      }

      // Return config with secret so the full URL can be constructed
      res.status(200).json({
        secret: config.secret,
        allowedOrigins: config.allowedOrigins,
      });
    })
  );
};
