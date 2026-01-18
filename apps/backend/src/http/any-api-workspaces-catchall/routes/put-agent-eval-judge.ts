import { badRequest, resourceGone, unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { validateBody } from "../../utils/bodyValidation";
import { updateEvalJudgeSchema } from "../../utils/schemas/workspaceSchemas";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/eval-judges/{judgeId}:
 *   put:
 *     summary: Update an eval judge
 *     description: Updates an existing eval judge configuration
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               enabled:
 *                 type: boolean
 *               samplingProbability:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 100
 *                 description: Probability percent for evaluating conversations
 *               provider:
 *                 type: string
 *                 enum: [google, openai, anthropic, openrouter]
 *               modelName:
 *                 type: string
 *               evalPrompt:
 *                 type: string
 *     responses:
 *       200:
 *         description: Eval judge updated successfully
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
export const registerPutAgentEvalJudge = (app: express.Application) => {
  app.put(
    "/api/workspaces/:workspaceId/agents/:agentId/eval-judges/:judgeId",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const body = validateBody(req.body, updateEvalJudgeSchema);
        const { name, enabled, samplingProbability, provider, modelName, evalPrompt } =
          body;

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

        const updateData: Partial<typeof judge> = {
          updatedAt: new Date().toISOString(),
        };

        if (name !== undefined) updateData.name = name;
        if (enabled !== undefined) updateData.enabled = enabled;
        if (samplingProbability !== undefined) {
          updateData.samplingProbability = samplingProbability;
        }
        if (provider !== undefined) updateData.provider = provider;
        if (modelName !== undefined) updateData.modelName = modelName;
        if (evalPrompt !== undefined) updateData.evalPrompt = evalPrompt;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any)["agent-eval-judge"].update({
          ...judge,
          ...updateData,
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updatedJudge = await (db as any)["agent-eval-judge"].get(judgePk, "judge");
        if (!updatedJudge) {
          throw resourceGone("Eval judge not found after update");
        }

        res.json({
          id: updatedJudge.judgeId,
          name: updatedJudge.name,
          enabled: updatedJudge.enabled,
          samplingProbability: updatedJudge.samplingProbability ?? 100,
          provider: updatedJudge.provider,
          modelName: updatedJudge.modelName,
          evalPrompt: updatedJudge.evalPrompt,
          createdAt: updatedJudge.createdAt,
          updatedAt: updatedJudge.updatedAt,
        });
      } catch (error) {
        handleError(error, next);
      }
    }
  );
};
