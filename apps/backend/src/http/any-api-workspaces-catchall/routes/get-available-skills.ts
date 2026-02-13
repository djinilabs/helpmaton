import { resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import {
  getAvailableSkills,
  groupSkillsByRole,
  type AgentSkill,
  type McpServerForSkills,
} from "../../../utils/agentSkills";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/available-skills:
 *   get:
 *     summary: Get available skills for agent
 *     description: Returns skills available for this agent (strict tool requirements must be met), grouped by role
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
 *         description: Available skills and grouped by role
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 skills:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       description:
 *                         type: string
 *                       role:
 *                         type: string
 *                       requiredTools:
 *                         type: array
 *                         items:
 *                           type: object
 *                 groupedByRole:
 *                   type: object
 *                   additionalProperties:
 *                     type: array
 *                     items:
 *                       type: object
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
export const registerGetAvailableSkills = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/agents/:agentId/available-skills",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.READ),
    async (req, res, next) => {
      try {
        const db = await database();
        const workspaceId = req.params.workspaceId;
        const agentId = req.params.agentId;
        const agentPk = `agents/${workspaceId}/${agentId}`;

        const agent = await db.agent.get(agentPk, "agent");
        if (!agent) {
          throw resourceGone("Agent not found");
        }

        const emailConnectionPk = `email-connections/${workspaceId}`;
        const emailConnection = await db["email-connection"].get(
          emailConnectionPk,
          "connection"
        );
        const hasEmailConnection = !!emailConnection;

        const enabledMcpServerIds = agent.enabledMcpServerIds || [];
        const enabledMcpServers: McpServerForSkills[] = [];
        for (const serverId of enabledMcpServerIds) {
          const serverPk = `mcp-servers/${workspaceId}/${serverId}`;
          const server = await db["mcp-server"].get(serverPk, "server");
          if (server) {
            const config = server.config as { accessToken?: string };
            enabledMcpServers.push({
              id: serverId,
              serviceType: server.serviceType,
              oauthConnected: !!config?.accessToken,
            });
          }
        }

        const skills: AgentSkill[] = await getAvailableSkills(
          {
            enableSearchDocuments: agent.enableSearchDocuments ?? false,
            enableMemorySearch: agent.enableMemorySearch ?? false,
            searchWebProvider: agent.searchWebProvider ?? null,
            fetchWebProvider: agent.fetchWebProvider ?? null,
            enableExaSearch: agent.enableExaSearch ?? false,
            enableSendEmail: agent.enableSendEmail ?? false,
            enableImageGeneration: agent.enableImageGeneration ?? false,
          },
          enabledMcpServers,
          { hasEmailConnection }
        );

        const groupedByRole = groupSkillsByRole(skills);

        res.json({ skills, groupedByRole });
      } catch (error) {
        handleError(
          error,
          next,
          "GET /api/workspaces/:workspaceId/agents/:agentId/available-skills"
        );
      }
    }
  );
};
