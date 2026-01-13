import { badRequest, unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/mcp-servers/{serverId}/oauth/disconnect:
 *   post:
 *     summary: Disconnect MCP server OAuth connection
 *     description: Disconnects the OAuth connection for an OAuth-based MCP server by clearing OAuth tokens
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
 *         description: OAuth connection disconnected successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPostMcpServerOauthDisconnect = (
  app: express.Application
) => {
  app.post(
    "/api/workspaces/:workspaceId/mcp-servers/:serverId/oauth/disconnect",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const workspaceId = req.params.workspaceId;
        const serverId = req.params.serverId;
        const currentUserRef = req.userRef;
        if (!currentUserRef) {
          throw unauthorized();
        }

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

        // Clear OAuth tokens from config, but keep serviceType
        const updatedConfig: Record<string, unknown> = {};
        if (server.serviceType) {
          updatedConfig.serviceType = server.serviceType;
        }

        await db["mcp-server"].update({
          pk,
          sk: "server",
          config: updatedConfig,
          updatedBy: currentUserRef,
          updatedAt: new Date().toISOString(),
        });

        res.json({ message: "OAuth connection disconnected successfully" });
      } catch (error) {
        handleError(
          error,
          next,
          "POST /api/workspaces/:workspaceId/mcp-servers/:serverId/oauth/disconnect"
        );
      }
    }
  );
};
