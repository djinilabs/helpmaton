import { badRequest, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { removeAgentResources } from "../../../utils/agentCleanup";
import { trackBusinessEvent } from "../../../utils/tracking";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}:
 *   delete:
 *     summary: Delete workspace agent
 *     description: Deletes an agent from the workspace
 *     tags:
 *       - Agents
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
 *         description: Agent deleted successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       410:
 *         description: Agent not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerDeleteWorkspaceAgent = (app: express.Application) => {
  app.delete(
    "/api/workspaces/:workspaceId/agents/:agentId",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const db = await database();
        const workspaceResource = req.workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const workspaceId = req.params.workspaceId;
        const agentId = req.params.agentId;
        const agentPk = `agents/${workspaceId}/${agentId}`;

        const agent = await db.agent.get(agentPk, "agent");
        if (!agent) {
          throw resourceGone("Agent not found");
        }

        const { cleanupErrors } = await removeAgentResources({
          db,
          workspaceId,
          agentId,
        });

        // Track agent deletion
        trackBusinessEvent(
          "agent",
          "deleted",
          {
            workspace_id: workspaceId,
            agent_id: agentId,
            cleanup_errors: cleanupErrors.length,
          },
          req,
        );

        res.status(204).send();
      } catch (error) {
        handleError(
          error,
          next,
          "DELETE /api/workspaces/:workspaceId/agents/:agentId",
        );
      }
    },
  );
};
