import { badRequest, resourceGone, unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { getUserAuthorizationLevelForResource } from "../../../tables/permissions";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { resolveWorkspaceSuggestions } from "../../utils/suggestions";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/suggestions:
 *   get:
 *     summary: Get workspace suggestions
 *     description: Returns LLM-generated suggestions for the workspace. May take a few seconds on first load. Does not block the main workspace response.
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
 *     responses:
 *       200:
 *         description: Suggestions (or null if none)
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
export const registerGetWorkspaceSuggestions = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/suggestions",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.READ),
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

        const workspace = await db.workspace.get(
          workspaceResource,
          "workspace"
        );
        if (!workspace) {
          throw resourceGone("Workspace not found");
        }

        await getUserAuthorizationLevelForResource(
          workspaceResource,
          currentUserRef
        );

        const workspaceId = workspace.pk.replace("workspaces/", "");

        const result = await db["workspace-api-key"].query({
          IndexName: "byWorkspaceId",
          KeyConditionExpression: "workspaceId = :workspaceId",
          ExpressionAttributeValues: {
            ":workspaceId": workspaceId,
          },
        });

        const providersWithKeys = new Set<string>();
        for (const item of result.items || []) {
          if (item.provider) {
            providersWithKeys.add(item.provider);
          }
        }

        const apiKeys: Record<string, boolean> = {
          openrouter: providersWithKeys.has("openrouter"),
        };

        const suggestions = await resolveWorkspaceSuggestions({
          db,
          workspaceId,
          workspacePk: workspace.pk,
          workspace,
          apiKeys,
        });

        res.json({
          suggestions: suggestions
            ? {
                items: suggestions.items,
                generatedAt: suggestions.generatedAt,
              }
            : null,
        });
      } catch (error) {
        handleError(
          error,
          next,
          "GET /api/workspaces/:workspaceId/suggestions",
        );
      }
    },
  );
};
