import { unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { asyncHandler, requireAuth } from "../middleware";

/**
 * @openapi
 * /api/workspaces:
 *   get:
 *     summary: List all workspaces
 *     description: Returns all workspaces the authenticated user has access to
 *     tags:
 *       - Workspaces
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of workspaces
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WorkspacesResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetWorkspaces = (app: express.Application) => {
  app.get(
    "/api/workspaces",
    requireAuth,
    asyncHandler(async (req, res) => {
      const db = await database();
      const userRef = req.userRef;
      if (!userRef) {
        throw unauthorized();
      }

      // Debug logging to diagnose workspace access issues
      console.log(
        `[get-workspaces] Querying workspaces for userRef: ${userRef}`
      );

      // Query permission table for user's workspaces
      const permissions = await db.permission.query({
        IndexName: "byResourceTypeAndEntityId",
        KeyConditionExpression:
          "resourceType = :resourceType AND sk = :userRef",
        ExpressionAttributeValues: {
          ":resourceType": "workspaces",
          ":userRef": userRef,
        },
      });

      console.log(
        `[get-workspaces] Found ${permissions.items.length} permission records for userRef: ${userRef}`
      );

      if (permissions.items.length === 0) {
        return res.json({ workspaces: [] });
      }

      // Get workspace IDs from permissions
      const workspaceIds = permissions.items.map((p) => p.pk);

      // Get workspace entities (using individual gets since batchGet doesn't support sort keys)
      const workspaces = await Promise.all(
        workspaceIds.map((id) => db.workspace.get(id, "workspace"))
      );
      const validWorkspaces = workspaces.filter(
        (w): w is NonNullable<typeof w> => w !== undefined
      );

      // Combine with permission levels
      const workspacesWithPermissions = validWorkspaces.map((workspace) => {
        const permission = permissions.items.find((p) => p.pk === workspace.pk);
        return {
          id: workspace.pk.replace("workspaces/", ""),
          name: workspace.name,
          description: workspace.description,
          permissionLevel: permission?.type || null,
          creditBalance: workspace.creditBalance ?? 0,
          currency: workspace.currency ?? "usd",
          spendingLimits: workspace.spendingLimits ?? [],
          createdAt: workspace.createdAt,
        };
      });

      res.json({ workspaces: workspacesWithPermissions });
    })
  );
};
