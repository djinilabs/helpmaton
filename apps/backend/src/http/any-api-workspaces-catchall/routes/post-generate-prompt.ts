import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import {
  checkPromptGenerationLimit,
  incrementPromptGenerationBucketSafe,
} from "../../../utils/requestTracking";
import { trackBusinessEvent } from "../../../utils/tracking";
import { validateBody } from "../../utils/bodyValidation";
import { generatePromptForAgent } from "../../utils/promptGeneration";
import { generatePromptRequestSchema } from "../../utils/schemas/requestSchemas";
import { extractUserId } from "../../utils/session";
import { requireWorkspaceContext } from "../../utils/workspaceContext";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/generate-prompt:
 *   post:
 *     summary: Generate system prompt for an agent
 *     description: Generates a system prompt for an AI agent based on a user-provided goal and available tools
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GeneratePromptRequest'
 *     responses:
 *       200:
 *         description: Generated system prompt
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GeneratePromptResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       410:
 *         description: Agent not found (when agentId is provided)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPostGeneratePrompt = (app: express.Application) => {
  app.post(
    "/api/workspaces/:workspaceId/agents/generate-prompt",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const body = validateBody(req.body, generatePromptRequestSchema);
        const { goal, agentId } = body;

        const { workspaceId } = requireWorkspaceContext(req);

        const db = await database();

        await checkPromptGenerationLimit(workspaceId);

        const userId = extractUserId(req);
        const userRef = (req as express.Request & { userRef?: string }).userRef;

        const generatedPrompt = await generatePromptForAgent({
          db,
          workspaceId,
          agentId,
          goal,
          userRef: userId ? `users/${userId}` : userRef,
          referer: "http://localhost:3000/api/prompt-generation",
        });

        await incrementPromptGenerationBucketSafe(workspaceId);

        trackBusinessEvent(
          "agent",
          "prompt_generated",
          { workspace_id: workspaceId },
          req
        );

        res.json({ prompt: generatedPrompt });
      } catch (error) {
        handleError(
          error,
          next,
          "POST /api/workspaces/:workspaceId/agents/generate-prompt"
        );
      }
    }
  );
};
