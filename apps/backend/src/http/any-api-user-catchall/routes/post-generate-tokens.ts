import { randomUUID } from "crypto";

import { unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import {
  generateAccessToken,
  generateRefreshToken,
  hashRefreshToken,
} from "../../../utils/tokenUtils";
import {
  handleError,
  requireAuthOrSession,
} from "../../any-api-workspaces-catchall/middleware";

const REFRESH_TOKEN_EXPIRY_DAYS = 30;

/**
 * @openapi
 * /api/user/generate-tokens:
 *   post:
 *     summary: Generate access and refresh tokens
 *     description: Generates new access and refresh tokens for the authenticated user. Requires either a valid Bearer token or cookie-based session. This is typically called after initial login to get Bearer tokens.
 *     tags:
 *       - User
 *     security:
 *       - bearerAuth: []
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Tokens generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken:
 *                   type: string
 *                   description: JWT access token (1 hour expiry)
 *                 refreshToken:
 *                   type: string
 *                   description: Refresh token (30 days expiry, save securely)
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPostGenerateTokens = (app: express.Application) => {
  app.post(
    "/api/user/generate-tokens",
    requireAuthOrSession,
    async (req, res, next) => {
      try {
        const db = await database();
        const userRef = req.userRef;
        if (!userRef) {
          throw unauthorized();
        }

        // Get user info from the Bearer token (already validated by requireAuth)
        const session = req.session;
        if (!session?.user?.id || !session?.user?.email) {
          throw unauthorized("User authentication required");
        }

        const userId = session.user.id;
        const email = session.user.email;

        // Generate tokens
        const accessToken = await generateAccessToken(userId, email);
        const refreshToken = generateRefreshToken();

        // Hash the refresh token
        const {
          hash: tokenHash,
          salt: tokenSalt,
          lookupHash: tokenLookupHash,
        } = await hashRefreshToken(refreshToken);

        // Calculate expiration (30 days from now)
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

        // Generate tokenId
        const tokenId = randomUUID();
        const pk = `user-refresh-tokens/${userId}`;
        const sk = tokenId;

        // Create refresh token record
        await db["user-refresh-token"].create({
          pk,
          sk,
          userId,
          tokenHash,
          tokenSalt,
          tokenLookupHash,
          expiresAt: expiresAt.toISOString(),
          createdBy: userRef,
        });

        res.json({
          accessToken,
          refreshToken, // Only returned once - client must save this
        });
      } catch (error) {
        handleError(error, next, "POST /api/user/generate-tokens");
      }
    }
  );
};
