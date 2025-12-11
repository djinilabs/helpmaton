import { badRequest, unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/email/oauth/{provider}/callback:
 *   get:
 *     summary: Handle email OAuth callback
 *     description: Handles OAuth callback from email provider and creates/updates email connection. Redirects to frontend on success.
 *     tags:
 *       - Email
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
 *         in: path
 *         required: true
 *         description: Email provider
 *         schema:
 *           type: string
 *           enum: [gmail, outlook]
 *       - name: code
 *         in: query
 *         description: OAuth authorization code
 *         schema:
 *           type: string
 *       - name: state
 *         in: query
 *         description: OAuth state token
 *         schema:
 *           type: string
 *       - name: error
 *         in: query
 *         description: OAuth error (if authorization failed)
 *         schema:
 *           type: string
 *     responses:
 *       302:
 *         description: Redirects to frontend success page
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetWorkspaceEmailOauthCallback = (
  app: express.Application
) => {
  app.get(
    "/api/workspaces/:workspaceId/email/oauth/:provider/callback",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const workspaceId = req.params.workspaceId;
        const provider = req.params.provider as "gmail" | "outlook";
        const code = req.query.code as string | undefined;
        const state = req.query.state as string | undefined;
        const error = req.query.error as string | undefined;

        if (error) {
          const errorDescription = req.query.error_description as
            | string
            | undefined;
          throw badRequest(
            `OAuth error: ${error}${
              errorDescription ? ` - ${errorDescription}` : ""
            }`
          );
        }

        if (!code) {
          throw badRequest("Authorization code is missing");
        }

        if (!state) {
          throw badRequest("State parameter is missing");
        }

        // Validate state token (includes workspaceId)
        const { validateStateToken } = await import(
          "../../../utils/oauth/common"
        );
        if (!validateStateToken(state, workspaceId)) {
          throw badRequest("Invalid or expired state token");
        }

        if (!["gmail", "outlook"].includes(provider)) {
          throw badRequest('provider must be "gmail" or "outlook"');
        }

        const db = await database();
        const currentUserRef = req.userRef;
        if (!currentUserRef) {
          throw unauthorized();
        }

        // Exchange code for tokens
        let tokenInfo: {
          accessToken: string;
          refreshToken: string;
          expiresAt: string;
          email?: string;
        };
        if (provider === "gmail") {
          const { exchangeGmailCode } = await import(
            "../../../utils/oauth/gmail"
          );
          tokenInfo = await exchangeGmailCode(code);
        } else {
          const { exchangeOutlookCode } = await import(
            "../../../utils/oauth/outlook"
          );
          tokenInfo = await exchangeOutlookCode(code);
        }

        // Create or update email connection
        const pk = `email-connections/${workspaceId}`;
        const sk = "connection";
        const existing = await db["email-connection"].get(pk, sk);

        const connectionName = `${
          provider.charAt(0).toUpperCase() + provider.slice(1)
        } Connection`;
        // Remove undefined values from config to avoid DynamoDB errors
        const config: Record<string, unknown> = {
          accessToken: tokenInfo.accessToken,
          refreshToken: tokenInfo.refreshToken,
          expiresAt: tokenInfo.expiresAt,
        };
        if (tokenInfo.email !== undefined) {
          config.email = tokenInfo.email;
        }

        if (existing) {
          // Update existing connection
          await db["email-connection"].update({
            pk,
            sk,
            workspaceId,
            type: provider,
            name: connectionName,
            config,
            updatedBy: currentUserRef,
            updatedAt: new Date().toISOString(),
          });
        } else {
          // Create new connection
          await db["email-connection"].create({
            pk,
            sk,
            workspaceId,
            type: provider,
            name: connectionName,
            config,
            createdBy: currentUserRef,
          });
        }

        // Redirect to frontend success page
        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
        res.redirect(
          `${frontendUrl}/workspaces/${workspaceId}/email-oauth-callback?success=true&provider=${provider}`
        );
      } catch (error) {
        handleError(
          error,
          next,
          "GET /api/workspaces/:workspaceId/email/oauth/:provider/callback"
        );
      }
    }
  );
};
