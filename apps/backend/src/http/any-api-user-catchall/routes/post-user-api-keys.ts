import { randomUUID } from "crypto";

import { unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import {
  generateApiKey,
  getKeyPrefix,
  hashApiKey,
} from "../../../utils/apiKeyUtils";
import {
  handleError,
  requireAuth,
} from "../../any-api-workspaces-catchall/middleware";
import { validateBody } from "../../utils/bodyValidation";
import { createUserApiKeySchema } from "../../utils/schemas/userSchemas";

/**
 * @openapi
 * /api/user/api-keys:
 *   post:
 *     summary: Create user API key
 *     description: Creates a new API key for the authenticated user. The key value is only returned once upon creation.
 *     tags:
 *       - User
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: Optional name/label for the key
 *     responses:
 *       201:
 *         description: API key created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   description: API key ID
 *                 key:
 *                   type: string
 *                   description: The API key value (only shown once - save this securely)
 *                 name:
 *                   type: string
 *                   nullable: true
 *                   description: Optional name/label for the key
 *                 keyPrefix:
 *                   type: string
 *                   description: Key prefix for display
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *                   description: When the key was created
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPostUserApiKeys = (app: express.Application) => {
  app.post("/api/user/api-keys", requireAuth, async (req, res, next) => {
    try {
      const db = await database();
      const userRef = req.userRef;
      if (!userRef) {
        throw unauthorized();
      }

      const userId = userRef.replace("users/", "");
      const body = validateBody(req.body || {}, createUserApiKeySchema);
      const { name } = body;

      // Generate API key
      const apiKey = generateApiKey();
      const keyPrefix = getKeyPrefix(apiKey);

      // Hash the key
      const {
        hash: keyHash,
        salt: keySalt,
        lookupHash: keyLookupHash,
      } = await hashApiKey(apiKey);

      // Generate keyId
      const keyId = randomUUID();
      const pk = `user-api-keys/${userId}`;
      const sk = keyId;

      // Create API key record
      const apiKeyRecord = await db["user-api-key"].create({
        pk,
        sk,
        userId,
        keyHash,
        keySalt,
        keyLookupHash,
        keyPrefix,
        name: name || undefined,
        createdBy: userRef,
      });

      res.status(201).json({
        id: keyId,
        key: apiKey, // Only returned once
        name: apiKeyRecord.name || null,
        keyPrefix: apiKeyRecord.keyPrefix,
        createdAt: apiKeyRecord.createdAt,
      });
    } catch (error) {
      handleError(error, next, "POST /api/user/api-keys");
    }
  });
};
