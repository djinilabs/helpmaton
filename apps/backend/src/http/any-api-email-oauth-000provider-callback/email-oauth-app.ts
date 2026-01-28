import express from "express";

import { database } from "../../tables";
import { isUserAuthorized } from "../../tables/permissions";
import { PERMISSION_LEVELS } from "../../tables/schema";
import { expressErrorHandler } from "../utils/errorHandler";
import { requireSessionFromRequest, userRef } from "../utils/session";

export const createApp: () => express.Application = () => {
  const app = express();
  app.set("etag", false);
  app.set("trust proxy", true);

  // GET /api/email/oauth/:provider/callback - Fixed OAuth callback handler (workspaceId from state)
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
          const { validateAndExtractStateToken } =
            await import("../../utils/oauth/common");
          const stateData = validateAndExtractStateToken(state);
          if (stateData) {
            workspaceId = stateData.workspaceId;
          }
        }
        const errorMsg = encodeURIComponent(
          `OAuth error: ${error}${errorDescription ? ` - ${errorDescription}` : ""}`,
        );
        if (workspaceId) {
          return res.redirect(
            `${redirectBaseUrl}/workspaces/${workspaceId}/email-oauth-callback?success=false&error=${errorMsg}&provider=${provider}`,
          );
        }
        return res.redirect(`${redirectBaseUrl}/?oauth_error=${errorMsg}`);
      }

      if (!code) {
        let workspaceId = "";
        if (state) {
          const { validateAndExtractStateToken } =
            await import("../../utils/oauth/common");
          const stateData = validateAndExtractStateToken(state);
          if (stateData) {
            workspaceId = stateData.workspaceId;
          }
        }
        const errorMsg = encodeURIComponent("Authorization code is missing");
        if (workspaceId) {
          return res.redirect(
            `${redirectBaseUrl}/workspaces/${workspaceId}/email-oauth-callback?success=false&error=${errorMsg}&provider=${provider}`,
          );
        }
        return res.redirect(`${redirectBaseUrl}/?oauth_error=${errorMsg}`);
      }

      if (!state) {
        const errorMsg = encodeURIComponent("State parameter is missing");
        return res.redirect(`${redirectBaseUrl}/?oauth_error=${errorMsg}`);
      }

      // Extract workspaceId from state token
      const { validateAndExtractStateToken } =
        await import("../../utils/oauth/common");
      const stateData = validateAndExtractStateToken(state);
      if (!stateData) {
        const errorMsg = encodeURIComponent("Invalid or expired state token");
        return res.redirect(`${redirectBaseUrl}/?oauth_error=${errorMsg}`);
      }
      const workspaceId = stateData.workspaceId;

      if (!["gmail", "outlook"].includes(provider)) {
        const errorMsg = encodeURIComponent(
          'provider must be "gmail" or "outlook"',
        );
        return res.redirect(
          `${redirectBaseUrl}/workspaces/${workspaceId}/email-oauth-callback?success=false&error=${errorMsg}&provider=${provider}`,
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
          `/workspaces/${workspaceId}/email-oauth-callback?code=${code}&state=${state}&provider=${provider}`,
        );
        return res.redirect(
          `${redirectBaseUrl}/api/auth/signin?callbackUrl=${returnUrl}`,
        );
      }

      if (!currentUserRef) {
        const returnUrl = encodeURIComponent(
          `/workspaces/${workspaceId}/email-oauth-callback?code=${code}&state=${state}&provider=${provider}`,
        );
        return res.redirect(
          `${redirectBaseUrl}/api/auth/signin?callbackUrl=${returnUrl}`,
        );
      }

      // Verify user has permission to modify this workspace
      try {
        const resource = `workspaces/${workspaceId}`;
        const [authorized] = await isUserAuthorized(
          currentUserRef,
          resource,
          PERMISSION_LEVELS.WRITE,
        );
        if (!authorized) {
          const errorMsg = encodeURIComponent(
            "You don't have permission to modify this workspace",
          );
          return res.redirect(
            `${redirectBaseUrl}/workspaces/${workspaceId}/email-oauth-callback?success=false&error=${errorMsg}&provider=${provider}`,
          );
        }
      } catch {
        const errorMsg = encodeURIComponent("Failed to verify permissions");
        return res.redirect(
          `${redirectBaseUrl}/workspaces/${workspaceId}/email-oauth-callback?success=false&error=${errorMsg}&provider=${provider}`,
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
      try {
        if (provider === "gmail") {
          const { exchangeGmailCode } = await import("../../utils/oauth/gmail");
          tokenInfo = await exchangeGmailCode(code);
        } else {
          const { exchangeOutlookCode } =
            await import("../../utils/oauth/outlook");
          tokenInfo = await exchangeOutlookCode(code);
        }
        console.log(
          `[OAuth Callback] Token exchange successful for ${provider}`,
          {
            hasAccessToken: !!tokenInfo.accessToken,
            hasRefreshToken: !!tokenInfo.refreshToken,
            hasExpiresAt: !!tokenInfo.expiresAt,
            hasEmail: !!tokenInfo.email,
          },
        );
      } catch (error) {
        console.error(
          `[OAuth Callback] Token exchange failed for ${provider}:`,
          error,
        );
        const errorMsg = encodeURIComponent(
          error instanceof Error
            ? error.message
            : "Failed to exchange OAuth code for tokens",
        );
        return res.redirect(
          `${redirectBaseUrl}/workspaces/${workspaceId}/email-oauth-callback?success=false&error=${errorMsg}&provider=${provider}`,
        );
      }

      // Create or update email connection
      const pk = `email-connections/${workspaceId}`;
      const sk = "connection";
      const existing = await db["email-connection"].get(pk, sk);

      const connectionName = `${provider.charAt(0).toUpperCase() + provider.slice(1)} Connection`;
      // Validate required fields first
      if (
        !tokenInfo.accessToken ||
        !tokenInfo.refreshToken ||
        !tokenInfo.expiresAt
      ) {
        console.error(
          `[OAuth Callback] Missing required token fields for ${provider}:`,
          {
            hasAccessToken: !!tokenInfo.accessToken,
            hasRefreshToken: !!tokenInfo.refreshToken,
            hasExpiresAt: !!tokenInfo.expiresAt,
            hasEmail: !!tokenInfo.email,
            // Do not log tokenInfo object as it contains sensitive credentials
          },
        );
        const errorMsg = encodeURIComponent(
          "Failed to obtain required OAuth tokens",
        );
        return res.redirect(
          `${redirectBaseUrl}/workspaces/${workspaceId}/email-oauth-callback?success=false&error=${errorMsg}&provider=${provider}`,
        );
      }

      // Build config object with only defined values (no undefined allowed in DynamoDB)
      // DynamoDB doesn't accept undefined values, so we must filter them out
      const config: Record<string, unknown> = {
        accessToken: String(tokenInfo.accessToken),
        refreshToken: String(tokenInfo.refreshToken),
        expiresAt: String(tokenInfo.expiresAt),
      };
      // Only add email if it's defined and not null
      if (
        tokenInfo.email !== undefined &&
        tokenInfo.email !== null &&
        tokenInfo.email !== ""
      ) {
        config.email = String(tokenInfo.email);
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
      res.redirect(
        `${redirectBaseUrl}/workspaces/${workspaceId}/email-oauth-callback?success=true&provider=${provider}`,
      );
    } catch (error) {
      next(error);
    }
  });

  // Error handler must be last
  app.use(expressErrorHandler);
  return app;
};
