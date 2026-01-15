import { badRequest, resourceGone, unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/eval-judges/{judgeId}:
 *   delete:
 *     summary: Delete an eval judge
 *     description: Deletes an eval judge configuration
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
 *       204:
 *         description: Eval judge deleted successfully
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
export const registerDeleteAgentEvalJudge = (app: express.Application) => {
  app.delete(
    "/api/workspaces/:workspaceId/agents/:agentId/eval-judges/:judgeId",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const db = await database();
        const workspaceResource = req.workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const currentUserRef = req.userRef;
        if (!currentUserRef) {
          throw unauthorized();
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

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any)["agent-eval-judge"].delete(judgePk, "judge");

        res.status(204).send();
      } catch (error) {
        handleError(error, next);
      }
    }
  );
};
