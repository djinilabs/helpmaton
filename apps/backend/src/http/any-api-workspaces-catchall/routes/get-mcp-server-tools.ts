import { badRequest, forbidden, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { buildMcpServerToolList } from "../../../utils/toolMetadata";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/mcp-servers/{serverId}/tools:
 *   get:
 *     summary: Get MCP server tools
 *     description: Returns the tools provided by a single MCP server, including parameters and descriptions
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
 *         description: List of tools grouped by category
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   category:
 *                     type: string
 *                   tools:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         name:
 *                           type: string
 *                         description:
 *                           type: string
 *                         category:
 *                           type: string
 *                         alwaysAvailable:
 *                           type: boolean
 *                         condition:
 *                           type: string
 *                         parameters:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               name:
 *                                 type: string
 *                               type:
 *                                 type: string
 *                               required:
 *                                 type: boolean
 *                               description:
 *                                 type: string
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
export const registerGetMcpServerTools = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/mcp-servers/:serverId/tools",
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

        const config = server.config as { accessToken?: string };
        const oauthConnected =
          server.authType === "oauth" && !!config.accessToken;

        const toolList = buildMcpServerToolList({
          serverName: server.name,
          serviceType: server.serviceType,
          authType: server.authType,
          oauthConnected,
        });

        res.json(toolList);
      } catch (error) {
        handleError(
          error,
          next,
          "GET /api/workspaces/:workspaceId/mcp-servers/:serverId/tools"
        );
      }
    }
  );
};
