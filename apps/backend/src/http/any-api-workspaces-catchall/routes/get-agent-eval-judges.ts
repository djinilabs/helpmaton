import { badRequest } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/eval-judges:
 *   get:
 *     summary: List eval judges for an agent
 *     description: Returns all evaluation judges configured for an agent
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
 *         description: List of eval judges
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   name:
 *                     type: string
 *                   enabled:
 *                     type: boolean
 *                   provider:
 *                     type: string
 *                   modelName:
 *                     type: string
 *                   evalPrompt:
 *                     type: string
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetAgentEvalJudges = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/agents/:agentId/eval-judges",
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

        // Verify agent exists and belongs to workspace
        const agentPk = `agents/${workspaceId}/${agentId}`;
        const agent = await db.agent.get(agentPk, "agent");
        if (!agent) {
          throw badRequest("Agent not found");
        }
        if (agent.workspaceId !== workspaceId) {
          throw badRequest("Agent does not belong to this workspace");
        }

        // Query all judges for this agent using GSI
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const queryResult = await (db as any)["agent-eval-judge"].query({
          IndexName: "byAgentId",
          KeyConditionExpression: "agentId = :agentId",
          ExpressionAttributeValues: {
            ":agentId": agentId,
          },
        });

        // Extract items from query result (query returns { items, areAnyUnpublished })
        const items = queryResult.items || [];

        const judgesList = items.map((judge: {
          judgeId: string;
          name: string;
          enabled: boolean;
          provider: string;
          modelName: string;
          evalPrompt: string;
          createdAt: string;
        }) => ({
          id: judge.judgeId,
          name: judge.name,
          enabled: judge.enabled,
          provider: judge.provider,
          modelName: judge.modelName,
          evalPrompt: judge.evalPrompt,
          createdAt: judge.createdAt,
        }));

        res.json(judgesList);
      } catch (error) {
        handleError(error, next);
      }
    }
  );
};
