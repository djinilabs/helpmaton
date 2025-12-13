import { badRequest } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { handleError, requireAuth, requirePermission } from "../middleware";

import { isValidProvider, VALID_PROVIDERS } from "./workspaceApiKeyUtils";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/api-key:
 *   get:
 *     summary: Get workspace API key status
 *     description: Returns whether the workspace has an API key configured for the specified provider. This is a boolean status check - the actual key value is never returned for security reasons. Requires READ permission or higher.
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
 *       - name: provider
 *         in: query
 *         required: true
 *         description: LLM provider name
 *         schema:
 *           type: string
 *           enum: [google, openai, anthropic]
 *     responses:
 *       200:
 *         description: API key status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 hasKey:
 *                   type: boolean
 *                   description: Whether workspace has an API key configured for the specified provider
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetWorkspaceApiKey = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/api-key",
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
        const provider = req.query.provider as string;

        if (!provider || typeof provider !== "string") {
          throw badRequest("provider query parameter is required");
        }

        // Validate provider is one of the supported values
        if (!isValidProvider(provider)) {
          throw badRequest(
            `provider must be one of: ${VALID_PROVIDERS.join(", ")}`
          );
        }

        const pk = `workspace-api-keys/${workspaceId}/${provider}`;
        const sk = "key";

        let workspaceKey;
        try {
          workspaceKey = await db["workspace-api-key"].get(pk, sk);
        } catch {
          // Key doesn't exist in new format
        }

        // Backward compatibility: check old format for Google provider only
        if (!workspaceKey && provider === "google") {
          const oldPk = `workspace-api-keys/${workspaceId}`;
          try {
            workspaceKey = await db["workspace-api-key"].get(oldPk, sk);
          } catch {
            // Old key doesn't exist either
          }
        }

        res.json({ hasKey: !!workspaceKey });
      } catch (error) {
        handleError(error, next, "GET /api/workspaces/:workspaceId/api-key");
      }
    }
  );
};
