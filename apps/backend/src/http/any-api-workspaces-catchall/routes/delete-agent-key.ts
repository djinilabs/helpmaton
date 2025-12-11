import { badRequest, forbidden, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/keys/{keyId}:
 *   delete:
 *     summary: Delete agent key
 *     description: Deletes an API key for an agent
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
 *       - name: keyId
 *         in: path
 *         required: true
 *         description: Key ID
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Agent key deleted successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       410:
 *         description: Agent or key not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerDeleteAgentKey = (app: express.Application) => {
  app.delete(
    "/api/workspaces/:workspaceId/agents/:agentId/keys/:keyId",
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
        const keyId = req.params.keyId;
        const agentPk = `agents/${workspaceId}/${agentId}`;

        // Verify agent exists
        const agent = await db.agent.get(agentPk, "agent");
        if (!agent) {
          throw resourceGone("Agent not found");
        }

        // Get the key to verify it exists and belongs to agent
        const agentKeyPk = `agent-keys/${workspaceId}/${agentId}/${keyId}`;
        const agentKeySk = "key";
        const agentKey = await db["agent-key"].get(agentKeyPk, agentKeySk);

        if (!agentKey) {
          throw resourceGone("Key not found");
        }

        if (
          agentKey.workspaceId !== workspaceId ||
          agentKey.agentId !== agentId
        ) {
          throw forbidden("Key does not belong to this agent");
        }

        // Delete key
        await db["agent-key"].delete(agentKeyPk, agentKeySk);

        res.status(204).send();
      } catch (error) {
        handleError(
          error,
          next,
          "DELETE /api/workspaces/:workspaceId/agents/:agentId/keys/:keyId"
        );
      }
    }
  );
};
