import { badRequest } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/mcp-servers/{serverId}/oauth/status:
 *   get:
 *     summary: Get MCP server OAuth connection status
 *     description: Returns the OAuth connection status for an OAuth-based MCP server
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
 *         description: OAuth connection status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 connected:
 *                   type: boolean
 *                   description: Whether OAuth is connected
 *                 email:
 *                   type: string
 *                   nullable: true
 *                   description: User email from OAuth provider (if available)
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetMcpServerOauthStatus = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/mcp-servers/:serverId/oauth/status",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.READ),
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

        const config = server.config as {
          accessToken?: string;
          email?: string;
        };

        const connected = !!config.accessToken;

        res.json({
          connected,
          email: config.email || null,
        });
      } catch (error) {
        handleError(
          error,
          next,
          "GET /api/workspaces/:workspaceId/mcp-servers/:serverId/oauth/status"
        );
      }
    }
  );
};
