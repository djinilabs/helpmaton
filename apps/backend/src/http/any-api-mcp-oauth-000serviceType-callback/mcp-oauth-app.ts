import express from "express";

import { database } from "../../tables";
import { isUserAuthorized } from "../../tables/permissions";
import { PERMISSION_LEVELS } from "../../tables/schema";
import { expressErrorHandler } from "../utils/errorHandler";
import { requireSessionFromRequest, userRef } from "../utils/session";

export const createApp: () => express.Application = () => {
  const app = express();
  app.set("trust proxy", true);

  // GET /api/mcp/oauth/:serviceType/callback - OAuth callback handler for MCP servers
  app.get(
    "/api/mcp/oauth/:serviceType/callback",
    async (req, res, next) => {
      try {
        const serviceType = req.params.serviceType as string;
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
          // Try to extract workspaceId and serverId from state for redirect
          let workspaceId = "";
          let serverId = "";
          if (state) {
            const {
              validateAndExtractMcpOAuthStateToken,
            } = await import("../../utils/oauth/mcp/common");
            const stateData = validateAndExtractMcpOAuthStateToken(state);
            if (stateData) {
              workspaceId = stateData.workspaceId;
              serverId = stateData.serverId;
            }
          }
          const errorMsg = encodeURIComponent(
            `OAuth error: ${error}${
              errorDescription ? ` - ${errorDescription}` : ""
            }`
          );
          if (workspaceId && serverId) {
            return res.redirect(
              `${redirectBaseUrl}/workspaces/${workspaceId}/mcp-servers/${serverId}/oauth-callback?success=false&error=${errorMsg}&serviceType=${serviceType}`
            );
          }
          return res.redirect(`${redirectBaseUrl}/?oauth_error=${errorMsg}`);
        }

        if (!code) {
          let workspaceId = "";
          let serverId = "";
          if (state) {
            const {
              validateAndExtractMcpOAuthStateToken,
            } = await import("../../utils/oauth/mcp/common");
            const stateData = validateAndExtractMcpOAuthStateToken(state);
            if (stateData) {
              workspaceId = stateData.workspaceId;
              serverId = stateData.serverId;
            }
          }
          const errorMsg = encodeURIComponent("Authorization code is missing");
          if (workspaceId && serverId) {
            return res.redirect(
              `${redirectBaseUrl}/workspaces/${workspaceId}/mcp-servers/${serverId}/oauth-callback?success=false&error=${errorMsg}&serviceType=${serviceType}`
            );
          }
          return res.redirect(`${redirectBaseUrl}/?oauth_error=${errorMsg}`);
        }

        if (!state) {
          const errorMsg = encodeURIComponent("State parameter is missing");
          return res.redirect(`${redirectBaseUrl}/?oauth_error=${errorMsg}`);
        }

        // Extract workspaceId and serverId from state token
        const { validateAndExtractMcpOAuthStateToken } = await import(
          "../../utils/oauth/mcp/common"
        );
        const stateData = validateAndExtractMcpOAuthStateToken(state);
        if (!stateData) {
          const errorMsg = encodeURIComponent(
            "Invalid or expired state token"
          );
          return res.redirect(`${redirectBaseUrl}/?oauth_error=${errorMsg}`);
        }
        const { workspaceId, serverId } = stateData;

        if (serviceType !== "google-drive" && serviceType !== "gmail") {
          const errorMsg = encodeURIComponent(
            `Unsupported service type: ${serviceType}`
          );
          return res.redirect(
            `${redirectBaseUrl}/workspaces/${workspaceId}/mcp-servers/${serverId}/oauth-callback?success=false&error=${errorMsg}&serviceType=${serviceType}`
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
            `/workspaces/${workspaceId}/mcp-servers/${serverId}/oauth-callback?code=${code}&state=${state}&serviceType=${serviceType}`
          );
          return res.redirect(
            `${redirectBaseUrl}/api/auth/signin?callbackUrl=${returnUrl}`
          );
        }

        if (!currentUserRef) {
          const returnUrl = encodeURIComponent(
            `/workspaces/${workspaceId}/mcp-servers/${serverId}/oauth-callback?code=${code}&state=${state}&serviceType=${serviceType}`
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
              `${redirectBaseUrl}/workspaces/${workspaceId}/mcp-servers/${serverId}/oauth-callback?success=false&error=${errorMsg}&serviceType=${serviceType}`
            );
          }
        } catch {
          const errorMsg = encodeURIComponent("Failed to verify permissions");
          return res.redirect(
            `${redirectBaseUrl}/workspaces/${workspaceId}/mcp-servers/${serverId}/oauth-callback?success=false&error=${errorMsg}&serviceType=${serviceType}`
          );
        }

        const db = await database();

        // Verify MCP server exists and is OAuth-based
        const pk = `mcp-servers/${workspaceId}/${serverId}`;
        const server = await db["mcp-server"].get(pk, "server");

        if (!server) {
          const errorMsg = encodeURIComponent(
            `MCP server ${serverId} not found`
          );
          return res.redirect(
            `${redirectBaseUrl}/workspaces/${workspaceId}/mcp-servers/${serverId}/oauth-callback?success=false&error=${errorMsg}&serviceType=${serviceType}`
          );
        }

        if (server.authType !== "oauth") {
          const errorMsg = encodeURIComponent(
            `MCP server ${serverId} is not an OAuth-based server`
          );
          return res.redirect(
            `${redirectBaseUrl}/workspaces/${workspaceId}/mcp-servers/${serverId}/oauth-callback?success=false&error=${errorMsg}&serviceType=${serviceType}`
          );
        }

        if (server.serviceType !== serviceType) {
          const errorMsg = encodeURIComponent(
            `Service type mismatch: expected ${server.serviceType}, got ${serviceType}`
          );
          return res.redirect(
            `${redirectBaseUrl}/workspaces/${workspaceId}/mcp-servers/${serverId}/oauth-callback?success=false&error=${errorMsg}&serviceType=${serviceType}`
          );
        }

        // Exchange code for tokens
        let tokenInfo: {
          accessToken: string;
          refreshToken: string;
          expiresAt: string;
          email?: string;
        };
        try {
          if (serviceType === "google-drive") {
            const { exchangeGoogleDriveCode } = await import(
              "../../utils/oauth/mcp/google-drive"
            );
            tokenInfo = await exchangeGoogleDriveCode(code);
          } else if (serviceType === "gmail") {
            const { exchangeGmailCode } = await import(
              "../../utils/oauth/mcp/gmail"
            );
            tokenInfo = await exchangeGmailCode(code);
          } else {
            throw new Error(`Unsupported service type: ${serviceType}`);
          }
          console.log(
            `[MCP OAuth Callback] Token exchange successful for ${serviceType}`,
            {
              hasAccessToken: !!tokenInfo.accessToken,
              hasRefreshToken: !!tokenInfo.refreshToken,
              hasExpiresAt: !!tokenInfo.expiresAt,
              hasEmail: !!tokenInfo.email,
            }
          );
        } catch (error) {
          console.error(
            `[MCP OAuth Callback] Token exchange failed for ${serviceType}:`,
            error
          );
          const errorMsg = encodeURIComponent(
            error instanceof Error
              ? error.message
              : "Failed to exchange OAuth code for tokens"
          );
          return res.redirect(
            `${redirectBaseUrl}/workspaces/${workspaceId}/mcp-servers/${serverId}/oauth-callback?success=false&error=${errorMsg}&serviceType=${serviceType}`
          );
        }

        // Validate required fields
        if (
          !tokenInfo.accessToken ||
          !tokenInfo.refreshToken ||
          !tokenInfo.expiresAt
        ) {
          console.error(
            `[MCP OAuth Callback] Missing required token fields for ${serviceType}:`,
            {
              hasAccessToken: !!tokenInfo.accessToken,
              hasRefreshToken: !!tokenInfo.refreshToken,
              hasExpiresAt: !!tokenInfo.expiresAt,
              tokenInfo,
            }
          );
          const errorMsg = encodeURIComponent(
            "Failed to obtain required OAuth tokens"
          );
          return res.redirect(
            `${redirectBaseUrl}/workspaces/${workspaceId}/mcp-servers/${serverId}/oauth-callback?success=false&error=${errorMsg}&serviceType=${serviceType}`
          );
        }

        // Build config object with OAuth tokens and serviceType
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

        // Update MCP server config with OAuth tokens
        await db["mcp-server"].update({
          pk,
          sk: "server",
          config,
          updatedBy: currentUserRef,
          updatedAt: new Date().toISOString(),
        });

        // Redirect to frontend success page
        res.redirect(
          `${redirectBaseUrl}/workspaces/${workspaceId}/mcp-servers/${serverId}/oauth-callback?success=true&serviceType=${serviceType}`
        );
      } catch (error) {
        next(error);
      }
    }
  );

  // Error handler must be last
  app.use(expressErrorHandler);
  return app;
};
