import express from "express";

import { PERMISSION_LEVELS } from "../../../tables/schema";
import { getWorkspaceInvites } from "../../../utils/workspaceInvites";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/invites:
 *   get:
 *     summary: List workspace invites
 *     description: Returns all pending (non-expired, non-accepted) invites for a workspace. Only shows invites that have not been accepted and have not expired. Includes invite ID, email, permission level, expiration date, and creation date. Requires OWNER permission.
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
 *     responses:
 *       200:
 *         description: List of pending invites
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 invites:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       inviteId:
 *                         type: string
 *                       email:
 *                         type: string
 *                       permissionLevel:
 *                         type: integer
 *                         description: Permission level (READ, WRITE, or OWNER)
 *                       expiresAt:
 *                         type: string
 *                         format: date-time
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetWorkspaceInvites = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/invites",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.OWNER),
    asyncHandler(async (req, res) => {
      const { workspaceId } = req.params;
      const invites = await getWorkspaceInvites(workspaceId);

      // Filter to only pending invites (not accepted and not expired)
      const now = new Date();
      const pendingInvites = invites
        .filter((inv) => !inv.acceptedAt)
        .filter((inv) => new Date(inv.expiresAt) > now)
        .map((inv) => {
          const inviteId = inv.pk.replace(
            `workspace-invites/${workspaceId}/`,
            ""
          );
          return {
            inviteId,
            email: inv.email,
            permissionLevel: inv.permissionLevel,
            expiresAt: inv.expiresAt,
            createdAt: inv.createdAt,
          };
        });

      res.json({ invites: pendingInvites });
    })
  );
};
