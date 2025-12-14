import { badRequest } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { handleError, requireAuth, requirePermission } from "../middleware";

import { VALID_PROVIDERS } from "./workspaceApiKeyUtils";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/api-keys:
 *   get:
 *     summary: Get all workspace API key statuses
 *     description: Returns the API key status for all supported providers for a workspace. This is a boolean status check - the actual key values are never returned for security reasons. Requires READ permission or higher.
 *     tags:
 *       - Workspace Settings
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
 *         description: API key statuses for all providers
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 keys:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       provider:
 *                         type: string
 *                         enum: [google, openai, anthropic]
 *                         description: LLM provider name
 *                       hasKey:
 *                         type: boolean
 *                         description: Whether workspace has an API key configured for this provider
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetWorkspaceApiKeys = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/api-keys",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.READ),
    async (req, res, next) => {
      try {
        const db = await database();
        const workspaceResource = req.workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const workspaceId = req.params.workspaceId;

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
        const sk = "key";
        try {
          const oldKey = await db["workspace-api-key"].get(oldPk, sk);
          if (oldKey) {
            providersWithKeys.add("google");
          }
        } catch {
          // Old key doesn't exist
        }

        // Return status for all supported providers
        const keys = VALID_PROVIDERS.map((provider) => ({
          provider,
          hasKey: providersWithKeys.has(provider),
        }));

        res.json({ keys });
      } catch (error) {
        handleError(error, next, "GET /api/workspaces/:workspaceId/api-keys");
      }
    }
  );
};

