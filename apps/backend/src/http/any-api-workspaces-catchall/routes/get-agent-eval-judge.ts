import { badRequest, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/eval-judges/{judgeId}:
 *   get:
 *     summary: Get an eval judge
 *     description: Returns details for a specific eval judge
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
 *       - name: judgeId
 *         in: path
 *         required: true
 *         description: Judge ID
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Eval judge details
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       410:
 *         description: Eval judge not found
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetAgentEvalJudge = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/agents/:agentId/eval-judges/:judgeId",
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
        const judgeId = req.params.judgeId;
        const judgePk = `agent-eval-judges/${workspaceId}/${agentId}/${judgeId}`;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const judge = await (db as any)["agent-eval-judge"].get(judgePk, "judge");
        if (!judge) {
          throw resourceGone("Eval judge not found");
        }
        if (judge.workspaceId !== workspaceId || judge.agentId !== agentId) {
          throw badRequest("Eval judge does not belong to this agent");
        }

        res.json({
          id: judge.judgeId,
          name: judge.name,
          enabled: judge.enabled,
          provider: judge.provider,
          modelName: judge.modelName,
          evalPrompt: judge.evalPrompt,
          createdAt: judge.createdAt,
        });
      } catch (error) {
        handleError(error, next);
      }
    }
  );
};
