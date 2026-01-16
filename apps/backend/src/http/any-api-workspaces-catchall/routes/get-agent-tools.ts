import { resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { generateToolList } from "../../../utils/toolMetadata";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/tools:
 *   get:
 *     summary: Get agent tools
 *     description: Returns a list of all tools available to the agent, grouped by category
 *     tags:
 *       - Agents
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: workspaceId
 *         in: path
 *         required: true
 *         description: Workspace ID
 *         schema:
 *           type: string
 *       - name: agentId
 *         in: path
 *         required: true
 *         description: Agent ID
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
 *         description: Agent not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetAgentTools = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/agents/:agentId/tools",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.READ),
    async (req, res, next) => {
      try {
        const db = await database();
        const workspaceId = req.params.workspaceId;
        const agentId = req.params.agentId;
        const agentPk = `agents/${workspaceId}/${agentId}`;

        // Load agent
        const agent = await db.agent.get(agentPk, "agent");
        if (!agent) {
          throw resourceGone("Agent not found");
        }

        // Check email connection
        const emailConnectionPk = `email-connections/${workspaceId}`;
        const emailConnection = await db["email-connection"].get(
          emailConnectionPk,
          "connection"
        );
        const hasEmailConnection = !!emailConnection;

        // Load enabled MCP servers
        const enabledMcpServerIds = agent.enabledMcpServerIds || [];
        const enabledMcpServers = [];

        for (const serverId of enabledMcpServerIds) {
          const serverPk = `mcp-servers/${workspaceId}/${serverId}`;
          const server = await db["mcp-server"].get(serverPk, "server");
          if (server) {
            // Check for OAuth connection
            const config = server.config as { accessToken?: string };
            const hasOAuthConnection = !!config.accessToken;

            enabledMcpServers.push({
              id: serverId,
              name: server.name,
              serviceType: server.serviceType,
              authType: server.authType,
              oauthConnected: hasOAuthConnection,
            });
          }
        }

        // Generate tool list
        const toolList = generateToolList({
          agent: {
            enableSearchDocuments: agent.enableSearchDocuments ?? false,
            enableMemorySearch: agent.enableMemorySearch ?? false,
            notificationChannelId: agent.notificationChannelId,
            enableSendEmail: agent.enableSendEmail ?? false,
            searchWebProvider: agent.searchWebProvider ?? null,
            fetchWebProvider: agent.fetchWebProvider ?? null,
            enableExaSearch: agent.enableExaSearch ?? false,
            delegatableAgentIds: agent.delegatableAgentIds ?? [],
            enabledMcpServerIds: agent.enabledMcpServerIds ?? [],
            clientTools: agent.clientTools ?? [],
          },
          workspaceId,
          enabledMcpServers,
          emailConnection: hasEmailConnection,
        });

        res.json(toolList);
      } catch (error) {
        handleError(
          error,
          next,
          "GET /api/workspaces/:workspaceId/agents/:agentId/tools"
        );
      }
    }
  );
};
