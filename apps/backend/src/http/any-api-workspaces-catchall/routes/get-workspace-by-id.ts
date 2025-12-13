import { badRequest, resourceGone, unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { getUserAuthorizationLevelForResource } from "../../../tables/permissions";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}:
 *   get:
 *     summary: Get workspace by ID
 *     description: Returns detailed information for a specific workspace including name, description, credit balance, currency, spending limits, permission level, and Google API key status. Requires READ permission or higher.
 *     tags:
 *       - Workspaces
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
 *         description: Workspace details
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Workspace'
 *                 - type: object
 *                   properties:
 *                     hasGoogleApiKey:
 *                       type: boolean
 *                       description: Whether workspace has a Google API key configured
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
export const registerGetWorkspaceById = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.READ),
    async (req, res, next) => {
      try {
        const db = await database();
        const workspaceResource = req.workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const currentUserRef = req.userRef;
        if (!currentUserRef) {
          throw unauthorized();
        }
        const userRef = currentUserRef;

        const workspace = await db.workspace.get(
          workspaceResource,
          "workspace"
        );
        if (!workspace) {
          throw resourceGone("Workspace not found");
        }

        const permissionLevel = await getUserAuthorizationLevelForResource(
          workspaceResource,
          userRef
        );

        // Check API key status for all providers
        const workspaceId = workspace.pk.replace("workspaces/", "");
        const sk = "key";

        // Query all API keys for this workspace using GSI
        const result = await db["workspace-api-key"].query({
          IndexName: "byWorkspaceId",
          KeyConditionExpression: "workspaceId = :workspaceId",
          ExpressionAttributeValues: {
            ":workspaceId": workspaceId,
          },
        });

        // Extract providers from the keys
        const providersWithKeys = new Set<string>();
        for (const item of result.items || []) {
          if (item.provider) {
            providersWithKeys.add(item.provider);
          }
        }

        // Also check for old format key (Google only) for backward compatibility
        const oldPk = `workspace-api-keys/${workspaceId}`;
        try {
          const oldKey = await db["workspace-api-key"].get(oldPk, sk);
          if (oldKey) {
            providersWithKeys.add("google");
          }
        } catch {
          // Old key doesn't exist
        }

        // Build API keys object
        const apiKeys: Record<string, boolean> = {
          google: providersWithKeys.has("google"),
          openai: providersWithKeys.has("openai"),
          anthropic: providersWithKeys.has("anthropic"),
        };

        res.json({
          id: workspaceId,
          name: workspace.name,
          description: workspace.description,
          permissionLevel: permissionLevel || null,
          creditBalance: workspace.creditBalance ?? 0,
          currency: workspace.currency ?? "usd",
          spendingLimits: workspace.spendingLimits ?? [],
          hasGoogleApiKey: apiKeys.google, // Keep for backward compatibility
          apiKeys, // New field with all providers
          createdAt: workspace.createdAt,
        });
      } catch (error) {
        handleError(error, next, "GET /api/workspaces/:workspaceId");
      }
    }
  );
};
