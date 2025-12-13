import { badRequest } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/api-key:
 *   delete:
 *     summary: Delete workspace API key
 *     description: Permanently deletes the API key for a workspace for the specified provider. After deletion, the provider's services integration will no longer work until a new key is configured. This action cannot be undone. Requires WRITE permission or higher.
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
 *       204:
 *         description: API key deleted successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerDeleteWorkspaceApiKey = (app: express.Application) => {
  app.delete(
    "/api/workspaces/:workspaceId/api-key",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
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
        const validProviders = ["google", "openai", "anthropic"];
        if (!validProviders.includes(provider)) {
          throw badRequest(
            `provider must be one of: ${validProviders.join(", ")}`
          );
        }

        const pk = `workspace-api-keys/${workspaceId}/${provider}`;
        const sk = "key";

        // Delete key in new format
        // Only catch "not found" errors, let other errors propagate
        try {
          await db["workspace-api-key"].delete(pk, sk);
        } catch (error) {
          // Check if it's a "not found" error - if so, continue
          // Otherwise, re-throw the error
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          if (
            !errorMessage.includes("not found") &&
            !errorMessage.includes("Not found") &&
            !errorMessage.includes("does not exist")
          ) {
            throw error;
          }
          // Key doesn't exist in new format, continue to check old format
        }

        // Backward compatibility: also delete old format key for Google provider
        if (provider === "google") {
          const oldPk = `workspace-api-keys/${workspaceId}`;
          try {
            await db["workspace-api-key"].delete(oldPk, sk);
          } catch (error) {
            // Check if it's a "not found" error - if so, continue
            // Otherwise, re-throw the error
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            if (
              !errorMessage.includes("not found") &&
              !errorMessage.includes("Not found") &&
              !errorMessage.includes("does not exist")
            ) {
              throw error;
            }
            // Old key doesn't exist, that's fine
          }
        }

        res.status(204).send();
      } catch (error) {
        handleError(error, next, "DELETE /api/workspaces/:workspaceId/api-key");
      }
    }
  );
};
