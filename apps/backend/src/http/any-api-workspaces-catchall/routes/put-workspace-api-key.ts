import { badRequest, unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { handleError, requireAuth, requirePermission } from "../middleware";

import { isValidProvider, VALID_PROVIDERS } from "./workspaceApiKeyUtils";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/api-key:
 *   put:
 *     summary: Update workspace API key
 *     description: Creates or updates an API key for a workspace for the specified provider. The API key is used for LLM provider integration. Pass an empty string to delete the key. The key value is stored securely and never returned in API responses. Requires WRITE permission or higher.
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - key
 *               - provider
 *             properties:
 *               key:
 *                 type: string
 *                 description: API key for the specified provider. Pass empty string to delete.
 *               provider:
 *                 type: string
 *                 enum: [google, openai, anthropic]
 *                 description: LLM provider name
 *     responses:
 *       200:
 *         description: API key updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       204:
 *         description: API key deleted successfully (when key is empty string)
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPutWorkspaceApiKey = (app: express.Application) => {
  app.put(
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
        const { key, provider } = req.body;

        if (key === undefined) {
          throw badRequest("key is required");
        }

        if (!provider || typeof provider !== "string") {
          throw badRequest("provider is required");
        }

        // Validate provider is one of the supported values
        if (!isValidProvider(provider)) {
          throw badRequest(
            `provider must be one of: ${VALID_PROVIDERS.join(", ")}`
          );
        }

        const currentUserRef = req.userRef;
        if (!currentUserRef) {
          throw unauthorized();
        }

        const pk = `workspace-api-keys/${workspaceId}/${provider}`;
        const sk = "key";

        if (!key || key === "") {
          // Delete the key if it exists (new format)
          try {
            await db["workspace-api-key"].delete(pk, sk);
          } catch {
            // Key doesn't exist, that's fine
          }

          // Also try to delete old format key for backward compatibility (Google only)
          if (provider === "google") {
            const oldPk = `workspace-api-keys/${workspaceId}`;
            try {
              await db["workspace-api-key"].delete(oldPk, sk);
            } catch {
              // Old key doesn't exist, that's fine
            }
          }

          res.status(204).send();
          return;
        }

        // Check if key already exists in new format
        let existing;
        try {
          existing = await db["workspace-api-key"].get(pk, sk);
        } catch {
          // Key doesn't exist in new format
        }

        // For Google provider, also check old format for backward compatibility
        if (!existing && provider === "google") {
          const oldPk = `workspace-api-keys/${workspaceId}`;
          try {
            const oldKey = await db["workspace-api-key"].get(oldPk, sk);
            if (oldKey) {
              // Migrate old key to new format
              try {
                await db["workspace-api-key"].create({
                  pk,
                  sk,
                  workspaceId,
                  key: oldKey.key,
                  provider: "google",
                  createdBy: oldKey.createdBy || currentUserRef,
                  // Note: createdAt is auto-generated by the create method
                  // During migration, the new key will have a new timestamp
                });
                // Delete old key after migration
                try {
                  await db["workspace-api-key"].delete(oldPk, sk);
                } catch {
                  // Ignore deletion errors
                }
                existing = await db["workspace-api-key"].get(pk, sk);
              } catch {
                // Migration failed, continue with update
              }
            }
          } catch {
            // Old key doesn't exist
          }
        }

        if (existing) {
          // Update existing key
          await db["workspace-api-key"].update({
            pk,
            sk,
            key,
            provider: provider as "google" | "openai" | "anthropic",
            updatedBy: currentUserRef,
            updatedAt: new Date().toISOString(),
          });
        } else {
          // Create new key
          await db["workspace-api-key"].create({
            pk,
            sk,
            workspaceId,
            key,
            provider: provider as "google" | "openai" | "anthropic",
            createdBy: currentUserRef,
          });
        }

        res.status(200).json({ success: true });
      } catch (error) {
        handleError(error, next, "PUT /api/workspaces/:workspaceId/api-key");
      }
    }
  );
};
