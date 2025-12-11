import { badRequest, resourceGone, unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import {
  checkUserLimit,
  getUserEmailById,
} from "../../../utils/subscriptionUtils";
import {
  createWorkspaceInvite,
  sendInviteEmail,
} from "../../../utils/workspaceInvites";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/members/invite:
 *   post:
 *     summary: Create workspace invite
 *     description: Creates and sends an email invite to join a workspace. The invite includes a permission level (1=READ, 2=WRITE, 3=OWNER) and expires after a set period. The invite email is sent automatically. Requires OWNER permission. The invited user must be within the subscription's user limit.
 *     tags:
 *       - Workspace Invites
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
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Email address to invite
 *               permissionLevel:
 *                 type: integer
 *                 enum: [1, 2, 3]
 *                 description: Permission level (1=READ, 2=WRITE, 3=OWNER). Defaults to 1.
 *                 default: 1
 *     responses:
 *       201:
 *         description: Invite created and sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 inviteId:
 *                   type: string
 *                 email:
 *                   type: string
 *                 permissionLevel:
 *                   type: integer
 *                 expiresAt:
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
export const registerPostWorkspaceInvite = (app: express.Application) => {
  app.post(
    "/api/workspaces/:workspaceId/members/invite",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.OWNER),
    async (req, res, next) => {
      try {
        const { email, permissionLevel } = req.body;
        const { workspaceId } = req.params;

        if (!email || typeof email !== "string") {
          throw badRequest("email is required and must be a string");
        }

        if (
          permissionLevel !== undefined &&
          (typeof permissionLevel !== "number" ||
            (permissionLevel !== PERMISSION_LEVELS.READ &&
              permissionLevel !== PERMISSION_LEVELS.WRITE &&
              permissionLevel !== PERMISSION_LEVELS.OWNER))
        ) {
          throw badRequest(
            "permissionLevel must be 1 (READ), 2 (WRITE), or 3 (OWNER)"
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

        // Check if workspace exists
        const workspace = await db.workspace.get(
          workspaceResource,
          "workspace"
        );
        if (!workspace) {
          throw resourceGone("Workspace not found");
        }

        // Check user limit for subscription
        if (workspace.subscriptionId) {
          await checkUserLimit(workspace.subscriptionId, email);
        }

        // Determine permission level (default to READ)
        const level: 1 | 2 | 3 =
          permissionLevel === PERMISSION_LEVELS.READ ||
          permissionLevel === PERMISSION_LEVELS.WRITE ||
          permissionLevel === PERMISSION_LEVELS.OWNER
            ? permissionLevel
            : PERMISSION_LEVELS.READ;

        // Create invite
        const invite = await createWorkspaceInvite(
          workspaceId,
          email,
          level,
          currentUserRef
        );

        // Get inviter email for email template
        const inviterEmail = await getUserEmailById(
          currentUserRef.replace("users/", "")
        );

        // Send invite email
        if (inviterEmail) {
          await sendInviteEmail(invite, workspace, inviterEmail);
        }

        res.status(201).json({
          inviteId: invite.pk.replace(`workspace-invites/${workspaceId}/`, ""),
          email: invite.email,
          permissionLevel: invite.permissionLevel,
          expiresAt: invite.expiresAt,
        });
      } catch (error) {
        handleError(
          error,
          next,
          "POST /api/workspaces/:workspaceId/members/invite"
        );
      }
    }
  );
};
