import { badRequest } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/api-key:
 *   delete:
 *     summary: Delete workspace API key
 *     description: Permanently deletes the Google API key for a workspace. After deletion, Google services integration will no longer work until a new key is configured. This action cannot be undone. Requires WRITE permission or higher.
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
 *       204:
 *         description: API key deleted successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerDeleteWorkspaceApiKey = (app: express.Application) => {
  app.delete(
    "/api/workspaces/:workspaceId/api-key",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
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

        await db["workspace-api-key"].delete(pk, sk);

        res.status(204).send();
      } catch (error) {
        handleError(error, next, "DELETE /api/workspaces/:workspaceId/api-key");
      }
    }
  );
};
