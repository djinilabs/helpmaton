import { badRequest, forbidden, resourceGone, unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import {
  ensureExactAuthorization,
  getUserAuthorizationLevelForResource,
} from "../../../tables/permissions";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { userRef } from "../../utils/session";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/members/{userId}:
 *   put:
 *     summary: Update workspace member permission
 *     description: Updates a member's permission level (1=READ, 2=WRITE, 3=OWNER). You cannot grant a permission level higher than your own. For example, a WRITE user cannot grant OWNER permissions. Requires WRITE permission or higher.
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
 *         description: User ID
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - permissionLevel
 *             properties:
 *               permissionLevel:
 *                 type: integer
 *                 enum: [1, 2, 3]
 *                 description: Permission level (1=READ, 2=WRITE, 3=OWNER)
 *     responses:
 *       200:
 *         description: Member permission updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userId:
 *                   type: string
 *                 userRef:
 *                   type: string
 *                 permissionLevel:
 *                   type: integer
 *                 updatedAt:
 *                   type: string
 *                   format: date-time
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
export const registerPutWorkspaceMember = (app: express.Application) => {
  app.put(
    "/api/workspaces/:workspaceId/members/:userId",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const { permissionLevel } = req.body;
        const { userId } = req.params;

        if (
          !permissionLevel ||
          typeof permissionLevel !== "number" ||
          (permissionLevel !== PERMISSION_LEVELS.READ &&
            permissionLevel !== PERMISSION_LEVELS.WRITE &&
            permissionLevel !== PERMISSION_LEVELS.OWNER)
        ) {
          throw badRequest(
            "permissionLevel is required and must be 1 (READ), 2 (WRITE), or 3 (OWNER)"
          );
        }

        const db = await database();
        const workspaceResource = req.workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const currentUserRef = req.userRef;
        if (!currentUserRef) {
          throw unauthorized();
        }
        const memberUserRef = userRef(userId);
        const level = permissionLevel as 1 | 2 | 3;

        // Check if workspace exists
        const workspace = await db.workspace.get(
          workspaceResource,
          "workspace"
        );
        if (!workspace) {
          throw resourceGone("Workspace not found");
        }

        // Check if granter has sufficient permission level
        const granterLevel = await getUserAuthorizationLevelForResource(
          workspaceResource,
          currentUserRef
        );
        if (!granterLevel || granterLevel < level) {
          throw forbidden(
            "Cannot grant permission level higher than your own permission level"
          );
        }

        // Update permission
        await ensureExactAuthorization(
          workspaceResource,
          memberUserRef,
          level,
          currentUserRef
        );

        // Get the updated permission
        const permission = await db.permission.get(
          workspaceResource,
          memberUserRef
        );

        res.json({
          userId,
          userRef: memberUserRef,
          permissionLevel: permission?.type || level,
          updatedAt: permission?.updatedAt || new Date().toISOString(),
        });
      } catch (error) {
        handleError(
          error,
          next,
          "PUT /api/workspaces/:workspaceId/members/:userId"
        );
      }
    }
  );
};
