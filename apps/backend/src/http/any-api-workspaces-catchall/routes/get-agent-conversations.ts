import { badRequest, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/conversations:
 *   get:
 *     summary: List agent conversations
 *     description: Returns paginated list of conversations for an agent, sorted by most recent first
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
 *       - name: limit
 *         in: query
 *         description: Maximum number of conversations to return (1-100, default 50)
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *       - name: cursor
 *         in: query
 *         description: Pagination cursor from previous response
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of conversations
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 conversations:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       conversationType:
 *                         type: string
 *                       startedAt:
 *                         type: string
 *                         format: date-time
 *                       lastMessageAt:
 *                         type: string
 *                         format: date-time
 *                       messageCount:
 *                         type: integer
 *                       tokenUsage:
 *                         type: object
 *                         nullable: true
 *                 nextCursor:
 *                   type: string
 *                   nullable: true
 *                   description: Cursor for next page of results
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
export const registerGetAgentConversations = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/agents/:agentId/conversations",
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
      const agentPk = `agents/${workspaceId}/${agentId}`;

      // Verify agent exists
      const agent = await db.agent.get(agentPk, "agent");
      if (!agent) {
        throw resourceGone("Agent not found");
      }

      // Parse pagination parameters
      const limit = req.query.limit
        ? Math.min(Math.max(parseInt(req.query.limit as string, 10), 1), 100)
        : 50; // Default 50, max 100
      const cursor = req.query.cursor as string | undefined;

      // Query conversations by agentId using the byAgentIdAndLastMessageAt GSI with pagination
      // This GSI sorts by lastMessageAt at the database level, so no in-memory sorting is needed
      // Note: We add a FilterExpression to ensure only conversations for this workspace
      // are returned (security check). This filtering happens at the database level.
      const query: Parameters<
        (typeof db)["agent-conversations"]["queryPaginated"]
      >[0] = {
        IndexName: "byAgentIdAndLastMessageAt",
        KeyConditionExpression: "agentId = :agentId",
        FilterExpression: "workspaceId = :workspaceId",
        ExpressionAttributeValues: {
          ":agentId": agentId,
          ":workspaceId": workspaceId,
        },
        ScanIndexForward: false, // Sort descending (most recent first by lastMessageAt)
      };

      // Query with database-level pagination (only fetches requested page)
      // Results are already sorted by lastMessageAt descending at the database level
      const result = await db["agent-conversations"].queryPaginated(query, {
        limit,
        cursor: cursor || null,
      });

      // Map conversations to response format (no sorting needed - already sorted by DB)
      const conversations = result.items.map((c) => {
          // Extract conversationId from pk: "conversations/{workspaceId}/{agentId}/{conversationId}"
          const pkParts = c.pk.split("/");
          const conversationId = pkParts[3];

          return {
            id: conversationId,
            conversationType: c.conversationType,
            startedAt: c.startedAt,
            lastMessageAt: c.lastMessageAt,
            messageCount: Array.isArray(c.messages) ? c.messages.length : 0,
            tokenUsage: c.tokenUsage || null,
            costUsd: c.costUsd,
            rerankingCostUsd: c.rerankingCostUsd,
            hasError: !!c.error,
            totalGenerationTimeMs: c.totalGenerationTimeMs || undefined,
          };
        });

      res.json({
        conversations,
        nextCursor: result.nextCursor || undefined,
      });
    })
  );
};
