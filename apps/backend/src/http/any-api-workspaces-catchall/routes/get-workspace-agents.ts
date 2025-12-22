import { badRequest } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents:
 *   get:
 *     summary: List workspace agents
 *     description: Returns all agents in a workspace
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
 *     responses:
 *       200:
 *         description: List of agents
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AgentsResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetWorkspaceAgents = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/agents",
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

        // Query all agents for this workspace using GSI
        const agents = await db.agent.query({
          IndexName: "byWorkspaceId",
          KeyConditionExpression: "workspaceId = :workspaceId",
          ExpressionAttributeValues: {
            ":workspaceId": workspaceId,
          },
        });

        const agentsList = agents.items.map((agent) => ({
          id: agent.pk.replace(`agents/${workspaceId}/`, ""),
          name: agent.name,
          systemPrompt: agent.systemPrompt,
          notificationChannelId: agent.notificationChannelId,
          delegatableAgentIds: agent.delegatableAgentIds ?? [],
          enabledMcpServerIds: agent.enabledMcpServerIds ?? [],
          enableMemorySearch: agent.enableMemorySearch ?? false,
          enableSearchDocuments: agent.enableSearchDocuments ?? false,
          enableSendEmail: agent.enableSendEmail ?? false,
          clientTools: agent.clientTools ?? [],
          spendingLimits: agent.spendingLimits ?? [],
          provider: agent.provider,
          modelName: agent.modelName ?? null,
          createdAt: agent.createdAt,
          updatedAt: agent.updatedAt,
        }));

        res.json({ agents: agentsList });
      } catch (error) {
        handleError(error, next, "GET /api/workspaces/:workspaceId/agents");
      }
    }
  );
};
