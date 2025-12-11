import { badRequest, notFound } from "@hapi/boom";
import express from "express";

import {
  acceptWorkspaceInvite,
  getWorkspaceInviteByToken,
} from "../../../utils/workspaceInvites";
import { asyncHandler } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/invites/{token}/accept:
 *   post:
 *     summary: Accept workspace invite
 *     description: Accepts a workspace invite using the invite token. Works for both authenticated and unauthenticated users. For authenticated users, immediately grants access to the workspace. For unauthenticated users, creates a new account and returns a callback URL for email verification. The invite must be valid and not expired. After acceptance, the user gains the permission level specified in the invite.
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
 *         description: Invite accepted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 workspaceId:
 *                   type: string
 *                 permissionLevel:
 *                   type: integer
 *                 callbackUrl:
 *                   type: string
 *                   nullable: true
 *                   description: Email verification callback URL (only for unauthenticated users)
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       404:
 *         description: Invite not found or expired
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPostAcceptWorkspaceInvite = (app: express.Application) => {
  app.post(
    "/api/workspaces/:workspaceId/invites/:token/accept",
    asyncHandler(async (req, res) => {
      const { workspaceId, token } = req.params;
      const currentUserRef = req.userRef;

      // Get invite to verify it exists and get the email
      const invite = await getWorkspaceInviteByToken(workspaceId, token);
      if (!invite) {
        throw notFound("Invite not found or already accepted");
      }

      // Check if invite is expired
      const expiresAt = new Date(invite.expiresAt);
      if (expiresAt < new Date()) {
        throw badRequest("Invite has expired");
      }

      let acceptedInvite: Awaited<ReturnType<typeof acceptWorkspaceInvite>>;
      let callbackUrl: string | undefined;

      if (currentUserRef) {
        // Authenticated flow: accept invite directly
        const userId = currentUserRef.replace("users/", "");
        acceptedInvite = await acceptWorkspaceInvite(
          workspaceId,
          token,
          userId
        );
      } else {
        // Unauthenticated flow: create user if needed, accept invite, create verification token
        // First, create user to get userId
        const { createUserFromInvite } = await import(
          "../../../utils/workspaceInvites"
        );
        const userId = await createUserFromInvite(invite.email);

        // Accept the invite
        acceptedInvite = await acceptWorkspaceInvite(
          workspaceId,
          token,
          userId
        );

        // Create verification token and get callback URL
        const { createVerificationTokenAndGetCallbackUrl } = await import(
          "../../../utils/workspaceInvites"
        );
        callbackUrl = await createVerificationTokenAndGetCallbackUrl(
          invite.email,
          workspaceId,
          req
        );
      }

      // Return JSON response with callback URL if unauthenticated
      // Frontend will redirect to the callback URL
      res.json({
        success: true,
        workspaceId: acceptedInvite.workspaceId,
        permissionLevel: acceptedInvite.permissionLevel,
        callbackUrl,
      });
    })
  );
};
