import { badRequest, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { validateBody } from "../../utils/bodyValidation";
import { dismissSuggestionRequestSchema } from "../../utils/schemas/requestSchemas";
import { dismissSuggestion } from "../../utils/suggestions";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/suggestions/dismiss:
 *   post:
 *     summary: Dismiss an agent suggestion
 *     description: Dismisses a single suggestion for the agent.
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
 *             $ref: '#/components/schemas/DismissSuggestionRequest'
 *     responses:
 *       200:
 *         description: Updated suggestions
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuggestionsResponse'
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
export const registerPostAgentSuggestionsDismiss = (
  app: express.Application,
) => {
  app.post(
    "/api/workspaces/:workspaceId/agents/:agentId/suggestions/dismiss",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const body = validateBody(req.body, dismissSuggestionRequestSchema);
        const workspaceResource = req.workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }

        const db = await database();
        const workspaceId = req.params.workspaceId;
        const agentId = req.params.agentId;
        const agentPk = `agents/${workspaceId}/${agentId}`;
        const agent = await db.agent.get(agentPk, "agent");
        if (!agent) {
          throw resourceGone("Agent not found");
        }

        const updatedCache = dismissSuggestion(
          agent.suggestions ?? null,
          body.suggestionId,
        );

        if (updatedCache) {
          await db.agent.update({
            pk: agentPk,
            sk: "agent",
            suggestions: updatedCache,
            updatedBy: req.userRef || "",
          });
        }

        res.json({
          suggestions: updatedCache
            ? {
                items: updatedCache.items,
                generatedAt: updatedCache.generatedAt,
              }
            : null,
        });
      } catch (error) {
        handleError(
          error,
          next,
          "POST /api/workspaces/:workspaceId/agents/:agentId/suggestions/dismiss",
        );
      }
    },
  );
};
