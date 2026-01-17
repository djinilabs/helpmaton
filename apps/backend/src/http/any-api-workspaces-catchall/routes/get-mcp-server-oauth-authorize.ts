import { badRequest } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/mcp-servers/{serverId}/oauth/authorize:
 *   get:
 *     summary: Get MCP server OAuth authorization URL
 *     description: Returns the OAuth authorization URL for connecting an OAuth-based MCP server
 *     tags:
 *       - MCP Servers
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: workspaceId
 *         in: path
 *         required: true
 *         description: Workspace ID
 *         schema:
 *           type: string
 *       - name: serverId
 *         in: path
 *         required: true
 *         description: MCP server ID
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: OAuth authorization URL
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 authUrl:
 *                   type: string
 *                   format: uri
 *                   description: OAuth authorization URL to redirect user to
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetMcpServerOauthAuthorize = (
  app: express.Application
) => {
  app.get(
    "/api/workspaces/:workspaceId/mcp-servers/:serverId/oauth/authorize",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const workspaceId = req.params.workspaceId;
        const serverId = req.params.serverId;

        const db = await database();
        const pk = `mcp-servers/${workspaceId}/${serverId}`;
        const server = await db["mcp-server"].get(pk, "server");

        if (!server) {
          throw badRequest(`MCP server ${serverId} not found`);
        }

        if (server.workspaceId !== workspaceId) {
          throw badRequest(
            `MCP server ${serverId} does not belong to this workspace`
          );
        }

        if (server.authType !== "oauth") {
          throw badRequest(
            `MCP server ${serverId} is not an OAuth-based server`
          );
        }

        // Generate authorization URL based on service type
        let authUrl: string;
        if (server.serviceType === "google-drive") {
          const { generateGoogleDriveAuthUrl } = await import(
            "../../../utils/oauth/mcp/google-drive"
          );
          authUrl = generateGoogleDriveAuthUrl(workspaceId, serverId);
        } else if (server.serviceType === "gmail") {
          const { generateGmailAuthUrl } = await import(
            "../../../utils/oauth/mcp/gmail"
          );
          authUrl = generateGmailAuthUrl(workspaceId, serverId);
        } else if (server.serviceType === "google-calendar") {
          const { generateGoogleCalendarAuthUrl } = await import(
            "../../../utils/oauth/mcp/google-calendar"
          );
          authUrl = generateGoogleCalendarAuthUrl(workspaceId, serverId);
        } else if (server.serviceType === "notion") {
          const { generateNotionAuthUrl } = await import(
            "../../../utils/oauth/mcp/notion"
          );
          authUrl = generateNotionAuthUrl(workspaceId, serverId);
        } else if (server.serviceType === "github") {
          const { generateGithubAuthUrl } = await import(
            "../../../utils/oauth/mcp/github"
          );
          authUrl = generateGithubAuthUrl(workspaceId, serverId);
        } else if (server.serviceType === "linear") {
          const { generateLinearAuthUrl } = await import(
            "../../../utils/oauth/mcp/linear"
          );
          authUrl = generateLinearAuthUrl(workspaceId, serverId);
        } else if (server.serviceType === "hubspot") {
          const { generateHubspotAuthUrl } = await import(
            "../../../utils/oauth/mcp/hubspot"
          );
          authUrl = generateHubspotAuthUrl(workspaceId, serverId);
        } else if (server.serviceType === "stripe") {
          const { generateStripeAuthUrl } = await import(
            "../../../utils/oauth/mcp/stripe"
          );
          authUrl = generateStripeAuthUrl(workspaceId, serverId);
        } else {
          throw badRequest(
            `Unsupported service type: ${server.serviceType || "unknown"}`
          );
        }

        res.json({ authUrl });
      } catch (error) {
        handleError(
          error,
          next,
          "GET /api/workspaces/:workspaceId/mcp-servers/:serverId/oauth/authorize"
        );
      }
    }
  );
};
