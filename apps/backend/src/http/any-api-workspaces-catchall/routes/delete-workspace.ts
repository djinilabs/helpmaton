import { badRequest, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}:
 *   delete:
 *     summary: Delete workspace
 *     description: Permanently deletes a workspace and all associated permissions, members, and resources. This action cannot be undone. Requires OWNER permission. All permission records for the workspace are also deleted.
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
 *       204:
 *         description: Workspace deleted successfully
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
export const registerDeleteWorkspace = (app: express.Application) => {
  app.delete(
    "/api/workspaces/:workspaceId",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.OWNER),
    async (req, res, next) => {
      try {
        const db = await database();
        const workspaceResource = req.workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }

        const workspace = await db.workspace.get(
          workspaceResource,
          "workspace"
        );
        if (!workspace) {
          throw resourceGone("Workspace not found");
        }

        // Delete all permissions for this workspace
        const permissions = await db.permission.query({
          KeyConditionExpression: "pk = :workspacePk",
          ExpressionAttributeValues: {
            ":workspacePk": workspaceResource,
          },
        });

        // Delete all permission records
        for (const permission of permissions.items) {
          await db.permission.delete(permission.pk, permission.sk);
        }

        // Delete workspace
        await db.workspace.delete(workspaceResource, "workspace");

        res.status(204).send();
      } catch (error) {
        handleError(error, next, "DELETE /api/workspaces/:workspaceId");
      }
    }
  );
};
