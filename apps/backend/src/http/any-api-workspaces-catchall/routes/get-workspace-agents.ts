import { badRequest } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { computeContextStats } from "../../../utils/agentContextStats";
import { parseLimitParam } from "../../utils/paginationParams";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents:
 *   get:
 *     summary: List workspace agents
 *     description: Returns paginated list of agents in a workspace
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
 *       - name: limit
 *         in: query
 *         description: Maximum number of agents to return (1-100, default 50)
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *       - name: cursor
 *         in: query
 *         description: Pagination cursor from previous response
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of agents
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 agents:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Agent'
 *                 nextCursor:
 *                   type: string
 *                   nullable: true
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

        const limit = parseLimitParam(req.query.limit);
        const cursor = req.query.cursor as string | undefined;

        const query: Parameters<typeof db.agent.queryPaginated>[0] = {
          IndexName: "byWorkspaceId",
          KeyConditionExpression: "workspaceId = :workspaceId",
          ExpressionAttributeValues: {
            ":workspaceId": workspaceId,
          },
        };

        const result = await db.agent.queryPaginated(query, {
          limit,
          cursor: cursor ?? null,
        });

        const agentsList = await Promise.all(
          result.items.map(async (agent) => {
            const contextStats = await computeContextStats(agent, {
              includeSkills: true,
            });
            return {
              id: agent.pk.replace(`agents/${workspaceId}/`, ""),
              name: agent.name,
              systemPrompt: agent.systemPrompt,
              summarizationPrompts: agent.summarizationPrompts,
              memoryExtractionEnabled: agent.memoryExtractionEnabled ?? false,
              memoryExtractionModel: agent.memoryExtractionModel ?? null,
              memoryExtractionPrompt: agent.memoryExtractionPrompt ?? null,
              notificationChannelId: agent.notificationChannelId,
              delegatableAgentIds: agent.delegatableAgentIds ?? [],
              enabledMcpServerIds: agent.enabledMcpServerIds ?? [],
              enabledMcpServerToolNames:
                agent.enabledMcpServerToolNames ?? undefined,
              enableMemorySearch: agent.enableMemorySearch ?? false,
              enableSearchDocuments: agent.enableSearchDocuments ?? false,
              enableSendEmail: agent.enableSendEmail ?? false,
              clientTools: agent.clientTools ?? [],
              spendingLimits: agent.spendingLimits ?? [],
              provider: agent.provider,
              modelName: agent.modelName ?? null,
              avatar: agent.avatar ?? null,
              createdAt: agent.createdAt,
              updatedAt: agent.updatedAt,
              contextStats,
            };
          })
        );

        res.json({
          agents: agentsList,
          nextCursor: result.nextCursor ?? undefined,
        });
      } catch (error) {
        handleError(error, next, "GET /api/workspaces/:workspaceId/agents");
      }
    },
  );
};
