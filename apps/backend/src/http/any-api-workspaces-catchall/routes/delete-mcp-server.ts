import { badRequest, forbidden, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/mcp-servers/{serverId}:
 *   delete:
 *     summary: Delete workspace MCP server
 *     description: Deletes an MCP server. Cannot delete if any agents are using it.
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
 *       204:
 *         description: MCP server deleted successfully
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
export const registerDeleteMcpServer = (app: express.Application) => {
  app.delete(
    "/api/workspaces/:workspaceId/mcp-servers/:serverId",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
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

        // Check if any agents are using this MCP server
        const agentsResult = await db.agent.query({
          IndexName: "byWorkspaceId",
          KeyConditionExpression: "workspaceId = :workspaceId",
          ExpressionAttributeValues: {
            ":workspaceId": workspaceId,
          },
        });

        // Early exit if we find any agent using the server
        for (const agent of agentsResult.items) {
          if (
            agent.enabledMcpServerIds &&
            agent.enabledMcpServerIds.includes(serverId)
          ) {
            throw badRequest(
              `Cannot delete MCP server: at least one agent is using it. Please disable it in those agents first.`
            );
          }
        }

        // Delete server
        await db["mcp-server"].delete(pk, "server");

        res.status(204).send();
      } catch (error) {
        handleError(
          error,
          next,
          "DELETE /api/workspaces/:workspaceId/mcp-servers/:serverId"
        );
      }
    }
  );
};
