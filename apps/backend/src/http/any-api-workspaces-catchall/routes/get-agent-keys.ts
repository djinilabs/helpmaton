import { badRequest, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/keys:
 *   get:
 *     summary: List agent keys
 *     description: Returns all API keys for an agent
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
 *       200:
 *         description: List of agent keys
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 keys:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       key:
 *                         type: string
 *                         description: The API key value (only shown when created)
 *                       name:
 *                         type: string
 *                         nullable: true
 *                       provider:
 *                         type: string
 *                         default: google
 *                       createdAt:
 *                         type: string
 *                         format: date-time
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
export const registerGetAgentKeys = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/agents/:agentId/keys",
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
        const agentId = req.params.agentId;
        const agentPk = `agents/${workspaceId}/${agentId}`;

        // Verify agent exists
        const agent = await db.agent.get(agentPk, "agent");
        if (!agent) {
          throw resourceGone("Agent not found");
        }

        // Query agent-key table by agentId using GSI
        const keysQuery = await db["agent-key"].query({
          IndexName: "byAgentId",
          KeyConditionExpression: "agentId = :agentId",
          ExpressionAttributeValues: {
            ":agentId": agentId,
          },
        });

        // Filter to only keys for this workspace and extract keyId from pk
        const keys = keysQuery.items
          .filter((k) => k.workspaceId === workspaceId)
          .map((k) => {
            // Extract keyId from pk: "agent-keys/{workspaceId}/{agentId}/{keyId}"
            const pkParts = k.pk.split("/");
            const keyId = pkParts[3];

            return {
              id: keyId,
              key: k.key,
              name: k.name,
              provider: k.provider || "google",
              createdAt: k.createdAt,
            };
          });

        res.json({ keys });
      } catch (error) {
        handleError(
          error,
          next,
          "GET /api/workspaces/:workspaceId/agents/:agentId/keys"
        );
      }
    }
  );
};
