import { badRequest, unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { getWorkspaceSubscription } from "../../../utils/subscriptionUtils";
import { validateBody } from "../../utils/bodyValidation";
import { updateApiKeySchema } from "../../utils/schemas/workspaceSchemas";
import { handleError, requireAuth, requirePermission } from "../middleware";

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
 *                 description: OpenRouter API key. Pass empty string to delete.
 *               provider:
 *                 type: string
 *                 enum: [openrouter]
 *                 description: LLM provider name (only openrouter is supported for BYOK)
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
        const body = validateBody(req.body, updateApiKeySchema);
        const { key, provider } = body;

        const currentUserRef = req.userRef;
        if (!currentUserRef) {
          throw unauthorized();
        }

        const pk = `workspace-api-keys/${workspaceId}/${provider}`;
        const sk = "key";

        if (!key || key === "") {
          // Delete the key if it exists (allowed for all plans)
          try {
            await db["workspace-api-key"].delete(pk, sk);
          } catch {
            // Key doesn't exist, that's fine
          }

          res.status(204).send();
          return;
        }

        // Check subscription plan - BYOK is only available for paid plans
        const subscription = await getWorkspaceSubscription(workspaceId);
        if (!subscription || subscription.plan === "free") {
          throw badRequest(
            "Bring Your Own Key (BYOK) is only available for Starter and Pro plans. Please upgrade to use your own API keys."
          );
        }

        // Check if key already exists
        let existing;
        try {
          existing = await db["workspace-api-key"].get(pk, sk);
        } catch {
          // Key doesn't exist
        }

        if (existing) {
          // Update existing key
          await db["workspace-api-key"].update({
            pk,
            sk,
            key,
            provider: "openrouter",
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
            provider: "openrouter",
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
