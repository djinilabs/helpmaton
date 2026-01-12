import { badRequest, forbidden, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/mcp-servers/{serverId}:
 *   get:
 *     summary: Get workspace MCP server
 *     description: Returns details for a specific MCP server (without sensitive config)
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
 *         description: MCP server details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 name:
 *                   type: string
 *                 url:
 *                   type: string
 *                   description: MCP server URL
 *                 authType:
 *                   type: string
 *                   description: Authentication type
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *                 updatedAt:
 *                   type: string
 *                   format: date-time
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       410:
 *         description: MCP server not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetMcpServer = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/mcp-servers/:serverId",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.READ),
    async (req, res, next) => {
      try {
        const db = await database();
        const workspaceResource = req.workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const workspaceId = req.params.workspaceId;
        const serverId = req.params.serverId;
        const pk = `mcp-servers/${workspaceId}/${serverId}`;

        const server = await db["mcp-server"].get(pk, "server");
        if (!server) {
          throw resourceGone("MCP server not found");
        }

        if (server.workspaceId !== workspaceId) {
          throw forbidden("MCP server does not belong to this workspace");
        }

        // Return server without sensitive config data
        // For OAuth servers, check connection status
        const config = server.config as {
          accessToken?: string;
          email?: string;
        };
        const oauthConnected =
          server.authType === "oauth" && !!config.accessToken;

        res.json({
          id: serverId,
          name: server.name,
          url: server.url,
          authType: server.authType,
          serviceType: server.serviceType,
          oauthConnected: server.authType === "oauth" ? oauthConnected : undefined,
          createdAt: server.createdAt,
          updatedAt: server.updatedAt,
        });
      } catch (error) {
        handleError(
          error,
          next,
          "GET /api/workspaces/:workspaceId/mcp-servers/:serverId"
        );
      }
    }
  );
};
