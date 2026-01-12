import { badRequest, resourceGone, unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { ensureAuthorization } from "../../../tables/permissions";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { validateBody } from "../../utils/bodyValidation";
import { createMemberSchema } from "../../utils/schemas/workspaceSchemas";
import { userRef } from "../../utils/session";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/members:
 *   post:
 *     summary: Add workspace member
 *     description: Adds an existing user to a workspace with the specified permission level (1=READ, 2=WRITE, 3=OWNER). Defaults to READ if not specified. Requires WRITE permission or higher. The user must already have an account in the system.
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *             properties:
 *               userId:
 *                 type: string
 *                 description: User ID to add to workspace
 *               permissionLevel:
 *                 type: integer
 *                 enum: [1, 2, 3]
 *                 description: Permission level (1=READ, 2=WRITE, 3=OWNER). Defaults to 1.
 *                 default: 1
 *     responses:
 *       201:
 *         description: Member added successfully
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
 *                 createdAt:
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
export const registerPostWorkspaceMembers = (app: express.Application) => {
  app.post(
    "/api/workspaces/:workspaceId/members",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const body = validateBody(req.body, createMemberSchema);
        const { userId, permissionLevel } = body;

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
        const level: 1 | 2 | 3 =
          permissionLevel === PERMISSION_LEVELS.READ ||
          permissionLevel === PERMISSION_LEVELS.WRITE ||
          permissionLevel === PERMISSION_LEVELS.OWNER
            ? permissionLevel
            : PERMISSION_LEVELS.READ;

        // Check if workspace exists
        const workspace = await db.workspace.get(
          workspaceResource,
          "workspace"
        );
        if (!workspace) {
          throw resourceGone("Workspace not found");
        }

        // Grant permission
        await ensureAuthorization(
          workspaceResource,
          memberUserRef,
          level,
          currentUserRef
        );

        // Get the created permission
        const permission = await db.permission.get(
          workspaceResource,
          memberUserRef
        );

        res.status(201).json({
          userId,
          userRef: memberUserRef,
          permissionLevel: permission?.type || level,
          createdAt: permission?.createdAt || new Date().toISOString(),
        });
      } catch (error) {
        handleError(error, next, "POST /api/workspaces/:workspaceId/members");
      }
    }
  );
};
