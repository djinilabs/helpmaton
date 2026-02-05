import { randomUUID } from "crypto";

import { badRequest, unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import {
  buildEvalJudgeRecordForCreate,
} from "../../../utils/agentEvalJudge";
import {
  ensureAgentEvalJudgeCreationAllowed,
} from "../../../utils/subscriptionUtils";
import { validateBody } from "../../utils/bodyValidation";
import { createEvalJudgeSchema } from "../../utils/schemas/workspaceSchemas";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/eval-judges:
 *   post:
 *     summary: Create an eval judge for an agent
 *     description: Creates a new evaluation judge configuration for an agent
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - modelName
 *               - evalPrompt
 *             properties:
 *               name:
 *                 type: string
 *                 description: Judge name
 *               enabled:
 *                 type: boolean
 *                 default: true
 *                 description: Whether the judge is enabled
 *               samplingProbability:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 100
 *                 default: 100
 *                 description: Probability percent for evaluating conversations
 *               provider:
 *                 type: string
 *                 enum: [google, openai, anthropic, openrouter]
 *                 default: openrouter
 *                 description: LLM provider for the judge
 *               modelName:
 *                 type: string
 *                 description: Model name for the judge
 *               evalPrompt:
 *                 type: string
 *                 description: Evaluation prompt template
 *     responses:
 *       201:
 *         description: Eval judge created successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPostAgentEvalJudges = (app: express.Application) => {
  app.post(
    "/api/workspaces/:workspaceId/agents/:agentId/eval-judges",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const body = validateBody(req.body, createEvalJudgeSchema);
        const {
          name,
          enabled,
          samplingProbability,
          provider,
          modelName,
          evalPrompt,
        } = body;

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

        // Verify agent exists and belongs to workspace
        const agentPk = `agents/${workspaceId}/${agentId}`;
        const agent = await db.agent.get(agentPk, "agent");
        if (!agent) {
          throw badRequest("Agent not found");
        }
        if (agent.workspaceId !== workspaceId) {
          throw badRequest("Agent does not belong to this workspace");
        }

        const userId = currentUserRef.replace("users/", "");
        await ensureAgentEvalJudgeCreationAllowed(
          workspaceId,
          userId,
          agentId
        );

        const judgeId = randomUUID();
        const judgeRecord = buildEvalJudgeRecordForCreate(
          workspaceId,
          agentId,
          judgeId,
          {
            name,
            enabled,
            samplingProbability,
            provider,
            modelName,
            evalPrompt,
          }
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any)["agent-eval-judge"].create(judgeRecord);

        const created = judgeRecord as { createdAt: string };
        res.status(201).json({
          id: judgeId,
          name,
          enabled: enabled ?? true,
          samplingProbability: samplingProbability ?? 100,
          provider: provider ?? "openrouter",
          modelName,
          evalPrompt,
          createdAt: created.createdAt,
        });
      } catch (error) {
        handleError(error, next);
      }
    }
  );
};
