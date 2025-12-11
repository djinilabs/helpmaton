import { badRequest, notFound, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { getUserEmailById } from "../../../utils/subscriptionUtils";
import { getWorkspaceInviteByToken } from "../../../utils/workspaceInvites";
import { asyncHandler } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/invites/{token}:
 *   get:
 *     summary: Get workspace invite
 *     description: Returns invite details for a given token, including workspace name, email, permission level, inviter email, and expiration date. This endpoint does not require authentication and is typically used when a user clicks an invite link. Returns 404 if the invite is not found, expired, or already accepted.
 *     tags:
 *       - Workspace Invites
 *     parameters:
 *       - name: workspaceId
 *         in: path
 *         required: true
 *         description: Workspace ID
 *         schema:
 *           type: string
 *       - name: token
 *         in: path
 *         required: true
 *         description: Invite token
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Invite details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 workspaceId:
 *                   type: string
 *                 workspaceName:
 *                   type: string
 *                 email:
 *                   type: string
 *                 permissionLevel:
 *                   type: integer
 *                 inviterEmail:
 *                   type: string
 *                   nullable: true
 *                 expiresAt:
 *                   type: string
 *                   format: date-time
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       404:
 *         description: Invite not found or expired
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       410:
 *         description: Workspace not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetWorkspaceInvite = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/invites/:token",
    asyncHandler(async (req, res) => {
      const { workspaceId, token } = req.params;
      const db = await database();

      // Check if workspace exists
      const workspacePk = `workspaces/${workspaceId}`;
      const workspace = await db.workspace.get(workspacePk, "workspace");
      if (!workspace) {
        throw resourceGone("Workspace not found");
      }

      // Get invite
      const invite = await getWorkspaceInviteByToken(workspaceId, token);
      if (!invite) {
        throw notFound("Invite not found or already accepted");
      }

      // Check if expired
      const expiresAt = new Date(invite.expiresAt);
      if (expiresAt < new Date()) {
        throw badRequest("Invite has expired");
      }

      // Get inviter email
      const inviterUserId = invite.invitedBy.replace("users/", "");
      const inviterEmail = await getUserEmailById(inviterUserId);

      res.json({
        workspaceId: invite.workspaceId,
        workspaceName: workspace.name,
        email: invite.email,
        permissionLevel: invite.permissionLevel,
        inviterEmail: inviterEmail || undefined,
        expiresAt: invite.expiresAt,
      });
    })
  );
};
