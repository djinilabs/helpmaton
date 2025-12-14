import { badRequest } from "@hapi/boom";
import express from "express";

import { PERMISSION_LEVELS } from "../../../tables/schema";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/stream-servers:
 *   delete:
 *     summary: Delete agent stream server configuration
 *     description: Deletes stream server configuration for an agent
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
 *       204:
 *         description: Stream server configuration deleted successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerDeleteStreamServers = (app: express.Application) => {
  app.delete(
    "/api/workspaces/:workspaceId/agents/:agentId/stream-servers",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    asyncHandler(async (req, res) => {
      const { workspaceId, agentId } = req.params;

      if (!workspaceId || !agentId) {
        throw badRequest("workspaceId and agentId are required");
      }

      const { deleteStreamServerConfig } = await import(
        "../../../utils/streamServerUtils"
      );

      await deleteStreamServerConfig(workspaceId, agentId);

      res.status(204).send();
    })
  );
};
