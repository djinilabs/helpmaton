import { badRequest } from "@hapi/boom";
import express from "express";

import { PERMISSION_LEVELS } from "../../../tables/schema";
import { validateBody } from "../../utils/bodyValidation";
import { updateStreamServerSchema } from "../../utils/schemas/workspaceSchemas";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/stream-servers:
 *   put:
 *     summary: Update agent stream server configuration
 *     description: Updates allowed CORS origins for an agent's stream server
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - allowedOrigins
 *             properties:
 *               allowedOrigins:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Allowed CORS origins (use '*' for all or specific URLs)
 *     responses:
 *       200:
 *         description: Stream server configuration updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 allowedOrigins:
 *                   type: array
 *                   items:
 *                     type: string
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPutStreamServers = (app: express.Application) => {
  app.put(
    "/api/workspaces/:workspaceId/agents/:agentId/stream-servers",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    asyncHandler(async (req, res) => {
      const { workspaceId, agentId } = req.params;

      if (!workspaceId || !agentId) {
        throw badRequest("workspaceId and agentId are required");
      }

      const body = validateBody(req.body, updateStreamServerSchema);
      const { allowedOrigins } = body;

      const { updateStreamServerConfig } = await import(
        "../../../utils/streamServerUtils"
      );

      const config = await updateStreamServerConfig(
        workspaceId,
        agentId,
        allowedOrigins
      );

      res.status(200).json({
        allowedOrigins: config.allowedOrigins,
      });
    })
  );
};
