import { resourceGone, unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import {
  handleError,
  requireAuth,
} from "../../any-api-workspaces-catchall/middleware";

/**
 * @openapi
 * /api/user/api-keys/{keyId}:
 *   delete:
 *     summary: Delete user API key
 *     description: Deletes an API key for the authenticated user
 *     tags:
 *       - User
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: keyId
 *         in: path
 *         required: true
 *         description: API key ID
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: API key deleted successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       410:
 *         description: API key not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerDeleteUserApiKeys = (app: express.Application) => {
  app.delete(
    "/api/user/api-keys/:keyId",
    requireAuth,
    async (req, res, next) => {
      try {
        const db = await database();
        const userRef = req.userRef;
        if (!userRef) {
          throw unauthorized();
        }

        const userId = userRef.replace("users/", "");
        const keyId = req.params.keyId;
        const pk = `user-api-keys/${userId}`;
        const sk = keyId;

        // Get the key to verify it exists
        const apiKey = await db["user-api-key"].get(pk, sk);

        if (!apiKey) {
          throw resourceGone("API key not found");
        }

        // Delete key
        // Note: Ownership is guaranteed by the pk which includes userId
        await db["user-api-key"].delete(pk, sk);

        res.status(204).send();
      } catch (error) {
        handleError(error, next, "DELETE /api/user/api-keys/:keyId");
      }
    }
  );
};
