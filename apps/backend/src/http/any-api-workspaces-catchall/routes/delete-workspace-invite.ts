import express from "express";

import { PERMISSION_LEVELS } from "../../../tables/schema";
import { deleteWorkspaceInvite } from "../../../utils/workspaceInvites";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/invites/{inviteId}:
 *   delete:
 *     summary: Delete workspace invite
 *     description: Permanently deletes a workspace invite, preventing it from being accepted. This is useful for revoking invites that are no longer needed. The invite cannot be recovered after deletion. Requires OWNER permission.
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
 *       - name: inviteId
 *         in: path
 *         required: true
 *         description: Invite ID
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Invite deleted successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerDeleteWorkspaceInvite = (app: express.Application) => {
  app.delete(
    "/api/workspaces/:workspaceId/invites/:inviteId",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.OWNER),
    asyncHandler(async (req, res) => {
      const { workspaceId, inviteId } = req.params;
      await deleteWorkspaceInvite(workspaceId, inviteId);
      res.status(204).send();
    })
  );
};
