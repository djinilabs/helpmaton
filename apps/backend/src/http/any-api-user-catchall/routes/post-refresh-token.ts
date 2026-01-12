import { randomUUID } from "crypto";

import { unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import {
  generateAccessToken,
  generateRefreshToken,
  generateTokenLookupHash,
  hashRefreshToken,
  validateRefreshToken,
} from "../../../utils/tokenUtils";
import { handleError } from "../../any-api-workspaces-catchall/middleware";
import { validateBody } from "../../utils/bodyValidation";
import { refreshTokenSchema } from "../../utils/schemas/userSchemas";

const REFRESH_TOKEN_EXPIRY_DAYS = 30;

/**
 * @openapi
 * /api/user/refresh-token:
 *   post:
 *     summary: Refresh access and refresh tokens
 *     description: Validates a refresh token and returns new access and refresh tokens. The old refresh token is revoked. This endpoint does not require authentication as it uses the refresh token in the request body.
 *     tags:
 *       - User
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 description: The refresh token to validate
 *     responses:
 *       200:
 *         description: Tokens refreshed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken:
 *                   type: string
 *                   description: New JWT access token (24 hours expiry)
 *                 refreshToken:
 *                   type: string
 *                   description: New refresh token (30 days expiry, save securely)
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPostRefreshToken = (app: express.Application) => {
  app.post("/api/user/refresh-token", async (req, res, next) => {
    try {
      const body = validateBody(req.body || {}, refreshTokenSchema);
      const { refreshToken } = body;

      // Trim whitespace (in case of any encoding/parsing issues)
      const trimmedToken = refreshToken.trim();

      // Use trimmed token for the rest of the function
      const tokenToValidate = trimmedToken;

      // Query refresh token using GSI for fast O(1) lookup
      // We use a deterministic SHA256 hash of the token for the GSI partition key
      const db = await database();
      const tokenLookupHash = generateTokenLookupHash(tokenToValidate);

      // Query the GSI to find the token record
      const result = await db["user-refresh-token"].query({
        IndexName: "byTokenHash",
        KeyConditionExpression: "tokenLookupHash = :lookupHash",
        ExpressionAttributeValues: {
          ":lookupHash": tokenLookupHash,
        },
      });

      // Find and validate the matching token
      // There should be at most one match, but we check all results
      let matchedToken: (typeof result.items)[0] | null = null;
      const now = new Date();

      for (const tokenRecord of result.items) {
        // Skip revoked or expired tokens
        if (tokenRecord.revokedAt) {
          continue;
        }

        const expiresAt = new Date(tokenRecord.expiresAt);
        if (expiresAt < now) {
          continue;
        }

        // Validate the token using scrypt (the lookup hash is just for fast lookup)
        if (tokenRecord.tokenHash && tokenRecord.tokenSalt) {
          const isValid = await validateRefreshToken(
            tokenToValidate,
            tokenRecord.tokenHash,
            tokenRecord.tokenSalt
          );

          if (isValid) {
            matchedToken = tokenRecord;
            break;
          }
        }
      }

      if (!matchedToken) {
        throw unauthorized("Invalid or expired refresh token");
      }

      const userId = matchedToken.userId;

      // Get user email from database (we need it for the access token)
      // Query the next-auth table to get user email
      const userRecord = await db["next-auth"].get(
        `USER#${userId}`,
        `USER#${userId}`
      );

      if (!userRecord || !userRecord.email) {
        throw unauthorized("User account is no longer valid");
      }

      const email = userRecord.email;

      // Revoke the old refresh token
      // Note: tokenLookupHash must be included as it's the GSI partition key
      // DynamoDB requires all GSI keys to be included in update operations
      await db["user-refresh-token"].update({
        pk: matchedToken.pk,
        sk: matchedToken.sk,
        userId: matchedToken.userId,
        tokenHash: matchedToken.tokenHash,
        tokenSalt: matchedToken.tokenSalt,
        tokenLookupHash: matchedToken.tokenLookupHash,
        expiresAt: matchedToken.expiresAt,
        createdAt: matchedToken.createdAt,
        version: matchedToken.version,
        revokedAt: new Date().toISOString(),
      });

      // Generate new tokens
      const newAccessToken = await generateAccessToken(userId, email);
      const newRefreshToken = generateRefreshToken();

      // Hash the new refresh token
      const {
        hash: newTokenHash,
        salt: newTokenSalt,
        lookupHash: newTokenLookupHash,
      } = await hashRefreshToken(newRefreshToken);

      // Calculate expiration (30 days from now)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

      // Generate new tokenId
      const newTokenId = randomUUID();
      const pk = `user-refresh-tokens/${userId}`;
      const sk = newTokenId;

      // Create new refresh token record
      await db["user-refresh-token"].create({
        pk,
        sk,
        userId,
        tokenHash: newTokenHash,
        tokenSalt: newTokenSalt,
        tokenLookupHash: newTokenLookupHash,
        expiresAt: expiresAt.toISOString(),
        createdBy: `users/${userId}`,
      });

      res.json({
        accessToken: newAccessToken,
        refreshToken: newRefreshToken, // Only returned once - client must save this
      });
    } catch (error) {
      handleError(error, next, "POST /api/user/refresh-token");
    }
  });
};
