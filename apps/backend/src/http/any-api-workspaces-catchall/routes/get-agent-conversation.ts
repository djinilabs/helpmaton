import { badRequest, forbidden, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/conversations/{conversationId}:
 *   get:
 *     summary: Get agent conversation
 *     description: Returns full details of a specific conversation including messages, tool calls, and results
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
 *       - name: conversationId
 *         in: path
 *         required: true
 *         description: Conversation ID
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Conversation details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 conversationType:
 *                   type: string
 *                 messages:
 *                   type: array
 *                   items:
 *                     type: object
 *                 tokenUsage:
 *                   type: object
 *                   nullable: true
 *                 startedAt:
 *                   type: string
 *                   format: date-time
 *                 lastMessageAt:
 *                   type: string
 *                   format: date-time
 *                 delegations:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       callingAgentId:
 *                         type: string
 *                       targetAgentId:
 *                         type: string
 *                       taskId:
 *                         type: string
 *                         nullable: true
 *                       timestamp:
 *                         type: string
 *                         format: date-time
 *                       status:
 *                         type: string
 *                         enum: [completed, failed, cancelled]
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       410:
 *         description: Agent or conversation not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetAgentConversation = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/agents/:agentId/conversations/:conversationId",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.READ),
    asyncHandler(async (req, res) => {
      const db = await database();
      const workspaceResource = req.workspaceResource;
      if (!workspaceResource) {
        throw badRequest("Workspace resource not found");
      }
      const workspaceId = req.params.workspaceId;
      const agentId = req.params.agentId;
      const conversationId = req.params.conversationId;
      const agentPk = `agents/${workspaceId}/${agentId}`;

      // Verify agent exists
      const agent = await db.agent.get(agentPk, "agent");
      if (!agent) {
        throw resourceGone("Agent not found");
      }

      const conversationPk = `conversations/${workspaceId}/${agentId}/${conversationId}`;
      const conversation = await db["agent-conversations"].get(conversationPk);

      if (!conversation) {
        throw resourceGone("Conversation not found");
      }

      if (
        conversation.workspaceId !== workspaceId ||
        conversation.agentId !== agentId
      ) {
        throw forbidden("Conversation does not belong to this agent");
      }

      res.json({
        id: conversationId,
        conversationType: conversation.conversationType,
        messages: conversation.messages || [],
        tokenUsage: conversation.tokenUsage || null,
        startedAt: conversation.startedAt,
        lastMessageAt: conversation.lastMessageAt,
        error: conversation.error || null,
        awsRequestIds: conversation.awsRequestIds ?? null,
        totalGenerationTimeMs: conversation.totalGenerationTimeMs ?? null,
        delegations: conversation.delegations || [],
        modelName: conversation.modelName ?? null,
        provider: conversation.provider ?? null,
        rerankingCostUsd: conversation.rerankingCostUsd ?? null,
      });
    })
  );
};
