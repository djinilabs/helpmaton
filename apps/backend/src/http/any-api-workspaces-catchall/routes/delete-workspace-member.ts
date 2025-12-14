import { badRequest, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { userRef } from "../../utils/session";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/members/{userId}:
 *   delete:
 *     summary: Remove workspace member
 *     description: Removes a user from a workspace, revoking all their permissions. Cannot remove the last owner - a workspace must have at least one owner. This action cannot be undone. Requires OWNER permission.
 *     tags:
 *       - Workspace Members
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: workspaceId
 *         in: path
 *         required: true
 *         description: Workspace ID
 *         schema:
 *           type: string
 *       - name: userId
 *         in: path
 *         required: true
 *         description: User ID to remove
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Member removed successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       410:
 *         description: Workspace or member not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerDeleteWorkspaceMember = (app: express.Application) => {
  app.delete(
    "/api/workspaces/:workspaceId/members/:userId",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.OWNER),
    async (req, res, next) => {
      try {
        const { userId } = req.params;
        const db = await database();
        const workspaceResource = req.workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const memberUserRef = userRef(userId);

        // Check if workspace exists
        const workspace = await db.workspace.get(
          workspaceResource,
          "workspace"
        );
        if (!workspace) {
          throw resourceGone("Workspace not found");
        }

        // Check if permission exists
        const permission = await db.permission.get(
          workspaceResource,
          memberUserRef
        );
        if (!permission) {
          throw resourceGone("Member not found in workspace");
        }

        // Check if user is the only OWNER
        if (permission.type === PERMISSION_LEVELS.OWNER) {
          const allPermissions = await db.permission.query({
            KeyConditionExpression: "pk = :workspacePk",
            ExpressionAttributeValues: {
              ":workspacePk": workspaceResource,
            },
          });
          const ownerCount = allPermissions.items.filter(
            (p) => p.type === PERMISSION_LEVELS.OWNER
          ).length;
          if (ownerCount <= 1) {
            throw badRequest(
              "Cannot remove the last owner. A workspace must have at least one owner."
            );
          }
        }

        // Delete permission
        await db.permission.delete(workspaceResource, memberUserRef);

        res.status(204).send();
      } catch (error) {
        handleError(
          error,
          next,
          "DELETE /api/workspaces/:workspaceId/members/:userId"
        );
      }
    }
  );
};
