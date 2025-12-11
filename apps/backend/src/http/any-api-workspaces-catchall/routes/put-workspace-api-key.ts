import { badRequest, unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/api-key:
 *   put:
 *     summary: Update workspace API key
 *     description: Creates or updates a Google API key for a workspace. The API key is used for Google services integration. Pass an empty string to delete the key. The key value is stored securely and never returned in API responses. Requires WRITE permission or higher.
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
 *             properties:
 *               key:
 *                 type: string
 *                 description: Google API key. Pass empty string to delete.
 *               provider:
 *                 type: string
 *                 description: Provider name
 *                 default: google
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

        const currentUserRef = req.userRef;
        if (!currentUserRef) {
          throw unauthorized();
        }

        const pk = `workspace-api-keys/${workspaceId}`;
        const sk = "key";

        if (!key || key === "") {
          // Delete the key if it exists
          try {
            await db["workspace-api-key"].delete(pk, sk);
          } catch {
            // Key doesn't exist, that's fine
          }
          res.status(204).send();
          return;
        }

        // Check if key already exists
        const existing = await db["workspace-api-key"].get(pk, sk);

        if (existing) {
          // Update existing key
          await db["workspace-api-key"].update({
            pk,
            sk,
            key,
            provider: provider || "google",
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
            provider: provider || "google",
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
