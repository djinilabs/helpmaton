import { badRequest } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { getUserEmailById } from "../../../utils/subscriptionUtils";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/members:
 *   get:
 *     summary: List workspace members
 *     description: Returns all members of a workspace with their permission levels (READ, WRITE, or OWNER), user IDs, email addresses, and join dates. Requires READ permission or higher.
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
 *     responses:
 *       200:
 *         description: List of workspace members
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 members:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       userId:
 *                         type: string
 *                       userRef:
 *                         type: string
 *                       email:
 *                         type: string
 *                       permissionLevel:
 *                         type: integer
 *                         description: Permission level (READ, WRITE, or OWNER)
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
export const registerGetWorkspaceMembers = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/members",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.READ),
    async (req, res, next) => {
      try {
        const db = await database();
        const workspaceResource = req.workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }

        // Query permission table for workspace members
        const permissions = await db.permission.query({
          KeyConditionExpression: "pk = :workspacePk",
          ExpressionAttributeValues: {
            ":workspacePk": workspaceResource,
          },
        });

        // Get user emails for each member
        const members = await Promise.all(
          permissions.items.map(async (permission) => {
            const userId = permission.sk.replace("users/", "");
            const email = await getUserEmailById(userId);
            return {
              userId,
              userRef: permission.sk,
              email: email || undefined,
              permissionLevel: permission.type,
              createdAt: permission.createdAt,
            };
          })
        );

        res.json({ members });
      } catch (error) {
        handleError(error, next, "GET /api/workspaces/:workspaceId/members");
      }
    }
  );
};
