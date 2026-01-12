import { badRequest } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/mcp-servers:
 *   get:
 *     summary: List workspace MCP servers
 *     description: Returns all MCP (Model Context Protocol) servers in a workspace
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
 *     responses:
 *       200:
 *         description: List of MCP servers
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 servers:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       url:
 *                         type: string
 *                         description: MCP server URL
 *                       authType:
 *                         type: string
 *                         description: Authentication type
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                       updatedAt:
 *                         type: string
 *                         format: date-time
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetMcpServers = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/mcp-servers",
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

        // Query all MCP servers for this workspace
        const result = await db["mcp-server"].query({
          IndexName: "byWorkspaceId",
          KeyConditionExpression: "workspaceId = :workspaceId",
          ExpressionAttributeValues: {
            ":workspaceId": workspaceId,
          },
        });

        // Return servers without sensitive config data
        const servers = result.items.map((server) => {
          const serverId = server.pk.replace(`mcp-servers/${workspaceId}/`, "");
          const config = server.config as {
            accessToken?: string;
            email?: string;
          };
          const oauthConnected =
            server.authType === "oauth" && !!config.accessToken;

          return {
            id: serverId,
            name: server.name,
            url: server.url,
            authType: server.authType,
            serviceType: server.serviceType,
            oauthConnected:
              server.authType === "oauth" ? oauthConnected : undefined,
            createdAt: server.createdAt,
            updatedAt: server.updatedAt,
          };
        });

        res.json({ servers });
      } catch (error) {
        handleError(
          error,
          next,
          "GET /api/workspaces/:workspaceId/mcp-servers"
        );
      }
    }
  );
};
