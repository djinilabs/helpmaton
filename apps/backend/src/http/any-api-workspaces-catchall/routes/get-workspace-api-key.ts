import { badRequest } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/api-key:
 *   get:
 *     summary: Get workspace API key status
 *     description: Returns whether the workspace has a Google API key configured. This is a boolean status check - the actual key value is never returned for security reasons. Requires READ permission or higher.
 *     tags:
 *       - Workspace Settings
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
 *         description: API key status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 hasKey:
 *                   type: boolean
 *                   description: Whether workspace has a Google API key configured
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetWorkspaceApiKey = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/api-key",
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

        const pk = `workspace-api-keys/${workspaceId}`;
        const sk = "key";

        const workspaceKey = await db["workspace-api-key"].get(pk, sk);

        res.json({ hasKey: !!workspaceKey });
      } catch (error) {
        handleError(error, next, "GET /api/workspaces/:workspaceId/api-key");
      }
    }
  );
};
