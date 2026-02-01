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
 * /api/workspaces/{workspaceId}/suggestions/dismiss:
 *   post:
 *     summary: Dismiss a workspace suggestion
 *     description: Dismisses a single suggestion for the workspace.
 *     tags:
 *       - Workspaces
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
 *         description: Workspace not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPostWorkspaceSuggestionsDismiss = (
  app: express.Application,
) => {
  app.post(
    "/api/workspaces/:workspaceId/suggestions/dismiss",
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
        const workspace = await db.workspace.get(workspaceResource, "workspace");
        if (!workspace) {
          throw resourceGone("Workspace not found");
        }

        const updatedCache = dismissSuggestion(
          workspace.suggestions ?? null,
          body.suggestionId,
        );

        if (updatedCache) {
          await db.workspace.update({
            pk: workspaceResource,
            sk: "workspace",
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
          "POST /api/workspaces/:workspaceId/suggestions/dismiss",
        );
      }
    },
  );
};
