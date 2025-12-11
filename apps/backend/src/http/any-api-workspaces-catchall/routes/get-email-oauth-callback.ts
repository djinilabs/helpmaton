import express from "express";

import { database } from "../../../tables";
import { isUserAuthorized } from "../../../tables/permissions";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { requireSessionFromRequest, userRef } from "../../utils/session";
import { handleError } from "../middleware";

/**
 * @openapi
 * /api/email/oauth/{provider}/callback:
 *   get:
 *     summary: Handle email OAuth callback (workspace-agnostic)
 *     description: Handles OAuth callback from email provider. Extracts workspaceId from state token and creates/updates email connection. Redirects to frontend on success or error. Works for both authenticated and unauthenticated users (redirects to login if needed).
 *     tags:
 *       - Email
 *     parameters:
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
 *         description: OAuth state token (contains workspaceId)
 *         schema:
 *           type: string
 *       - name: error
 *         in: query
 *         description: OAuth error (if authorization failed)
 *         schema:
 *           type: string
 *     responses:
 *       302:
 *         description: Redirects to frontend success/error page or login page
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetEmailOauthCallback = (app: express.Application) => {
  app.get("/api/email/oauth/:provider/callback", async (req, res, next) => {
    try {
      const provider = req.params.provider as "gmail" | "outlook";
      const code = req.query.code as string | undefined;
      const state = req.query.state as string | undefined;
      const error = req.query.error as string | undefined;

      const redirectBaseUrl =
        process.env.FRONTEND_URL || "http://localhost:5173";

      // Handle OAuth errors from provider
      if (error) {
        const errorDescription = req.query.error_description as
          | string
          | undefined;
        // Try to extract workspaceId from state for redirect
        let workspaceId = "";
        if (state) {
          const { validateAndExtractStateToken } = await import(
            "../../../utils/oauth/common"
          );
          const stateData = validateAndExtractStateToken(state);
          if (stateData) {
            workspaceId = stateData.workspaceId;
          }
        }
        const errorMsg = encodeURIComponent(
          `OAuth error: ${error}${
            errorDescription ? ` - ${errorDescription}` : ""
          }`
        );
        if (workspaceId) {
          return res.redirect(
            `${redirectBaseUrl}/workspaces/${workspaceId}/email-oauth-callback?success=false&error=${errorMsg}&provider=${provider}`
          );
        }
        return res.redirect(`${redirectBaseUrl}/?oauth_error=${errorMsg}`);
      }

      if (!code) {
        let workspaceId = "";
        if (state) {
          const { validateAndExtractStateToken } = await import(
            "../../../utils/oauth/common"
          );
          const stateData = validateAndExtractStateToken(state);
          if (stateData) {
            workspaceId = stateData.workspaceId;
          }
        }
        const errorMsg = encodeURIComponent("Authorization code is missing");
        if (workspaceId) {
          return res.redirect(
            `${redirectBaseUrl}/workspaces/${workspaceId}/email-oauth-callback?success=false&error=${errorMsg}&provider=${provider}`
          );
        }
        return res.redirect(`${redirectBaseUrl}/?oauth_error=${errorMsg}`);
      }

      if (!state) {
        const errorMsg = encodeURIComponent("State parameter is missing");
        return res.redirect(`${redirectBaseUrl}/?oauth_error=${errorMsg}`);
      }

      // Extract workspaceId from state token
      const { validateAndExtractStateToken } = await import(
        "../../../utils/oauth/common"
      );
      const stateData = validateAndExtractStateToken(state);
      if (!stateData) {
        const errorMsg = encodeURIComponent("Invalid or expired state token");
        return res.redirect(`${redirectBaseUrl}/?oauth_error=${errorMsg}`);
      }
      const workspaceId = stateData.workspaceId;

      if (!["gmail", "outlook"].includes(provider)) {
        const errorMsg = encodeURIComponent(
          'provider must be "gmail" or "outlook"'
        );
        return res.redirect(
          `${redirectBaseUrl}/workspaces/${workspaceId}/email-oauth-callback?success=false&error=${errorMsg}&provider=${provider}`
        );
      }

      // Try to get session, but don't fail if not authenticated - we'll handle it gracefully
      let currentUserRef: string | undefined;
      try {
        const session = await requireSessionFromRequest(req);
        if (session.user?.id) {
          currentUserRef = userRef(session.user.id);
        }
      } catch {
        // Session not available - redirect to login with return URL
        const returnUrl = encodeURIComponent(
          `/workspaces/${workspaceId}/email-oauth-callback?code=${code}&state=${state}&provider=${provider}`
        );
        return res.redirect(
          `${redirectBaseUrl}/api/auth/signin?callbackUrl=${returnUrl}`
        );
      }

      if (!currentUserRef) {
        const returnUrl = encodeURIComponent(
          `/workspaces/${workspaceId}/email-oauth-callback?code=${code}&state=${state}&provider=${provider}`
        );
        return res.redirect(
          `${redirectBaseUrl}/api/auth/signin?callbackUrl=${returnUrl}`
        );
      }

      // Verify user has permission to modify this workspace
      try {
        const resource = `workspaces/${workspaceId}`;
        const [authorized] = await isUserAuthorized(
          currentUserRef,
          resource,
          PERMISSION_LEVELS.WRITE
        );
        if (!authorized) {
          const errorMsg = encodeURIComponent(
            "You don't have permission to modify this workspace"
          );
          return res.redirect(
            `${redirectBaseUrl}/workspaces/${workspaceId}/email-oauth-callback?success=false&error=${errorMsg}&provider=${provider}`
          );
        }
      } catch {
        const errorMsg = encodeURIComponent("Failed to verify permissions");
        return res.redirect(
          `${redirectBaseUrl}/workspaces/${workspaceId}/email-oauth-callback?success=false&error=${errorMsg}&provider=${provider}`
        );
      }

      const db = await database();

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
      handleError(error, next, "GET /api/email/oauth/:provider/callback");
    }
  });
};
