import { unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { maskApiKey } from "../../../utils/apiKeyUtils";
import { handleError, requireAuth } from "../middleware";

/**
 * @openapi
 * /api/user/api-keys:
 *   get:
 *     summary: List user API keys
 *     description: Returns all API keys for the authenticated user (masked)
 *     tags:
 *       - User
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of API keys
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     description: API key ID
 *                   name:
 *                     type: string
 *                     nullable: true
 *                     description: Optional name/label for the key
 *                   keyPrefix:
 *                     type: string
 *                     description: Masked key prefix for display
 *                   maskedKey:
 *                     type: string
 *                     description: Fully masked key for display
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 *                     description: When the key was created
 *                   lastUsedAt:
 *                     type: string
 *                     format: date-time
 *                     nullable: true
 *                     description: When the key was last used
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetUserApiKeys = (app: express.Application) => {
  app.get("/api/user/api-keys", requireAuth, async (req, res, next) => {
    try {
      const db = await database();
      const userRef = req.userRef;
      if (!userRef) {
        throw unauthorized();
      }

      const userId = userRef.replace("users/", "");
      const pk = `user-api-keys/${userId}`;

      // Query all API keys for this user by primary key
      // All keys for a user share the same pk, with different sk (keyId) values
      const result = await db["user-api-key"].query({
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: {
          ":pk": pk,
        },
      });

      const keys = result.items.map((key) => {
        // Create a mock key for masking (we only store the prefix)
        // API keys are: hmat_<64 hex chars> = 69 characters total
        const mockKey = key.keyPrefix + "x".repeat(69 - key.keyPrefix.length);
        const maskedKey = maskApiKey(mockKey);

        return {
          id: key.sk, // keyId is the sort key
          name: key.name || null,
          keyPrefix: key.keyPrefix,
          maskedKey: maskedKey,
          createdAt: key.createdAt,
          lastUsedAt: key.lastUsedAt || null,
        };
      });

      res.json(keys);
    } catch (error) {
      handleError(error, next, "GET /api/user/api-keys");
    }
  });
};
