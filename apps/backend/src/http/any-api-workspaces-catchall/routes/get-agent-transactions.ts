import { badRequest, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/transactions:
 *   get:
 *     summary: List agent transactions
 *     description: Returns paginated list of credit transactions for an agent, sorted by most recent first
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
 *         description: Maximum number of transactions to return (1-100, default 50)
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
 *         description: List of transactions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 transactions:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       workspaceId:
 *                         type: string
 *                       agentId:
 *                         type: string
 *                         nullable: true
 *                       conversationId:
 *                         type: string
 *                         nullable: true
 *                       source:
 *                         type: string
 *                         enum: [embedding-generation, text-generation, tool-execution]
 *                       supplier:
 *                         type: string
 *                         enum: [openrouter, tavily]
 *                       model:
 *                         type: string
 *                         nullable: true
 *                       tool_call:
 *                         type: string
 *                         nullable: true
 *                       description:
 *                         type: string
 *                       amountMillionthUsd:
 *                         type: integer
 *                       workspaceCreditsBeforeMillionthUsd:
 *                         type: integer
 *                       workspaceCreditsAfterMillionthUsd:
 *                         type: integer
 *                       createdAt:
 *                         type: string
 *                         format: date-time
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
export const registerGetAgentTransactions = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/agents/:agentId/transactions",
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

      // Query transactions by agentId using the byAgentId GSI with pagination
      // Note: We add a FilterExpression to ensure only transactions for this workspace
      // are returned (security check). This filtering happens at the database level.
      const query: Parameters<
        (typeof db)["workspace-credit-transactions"]["queryPaginated"]
      >[0] = {
        IndexName: "byAgentId",
        KeyConditionExpression: "agentId = :agentId",
        FilterExpression: "workspaceId = :workspaceId",
        ExpressionAttributeValues: {
          ":agentId": agentId,
          ":workspaceId": workspaceId,
        },
        ScanIndexForward: false, // Sort descending (most recent first)
      };

      // Query with database-level pagination (only fetches requested page)
      const result = await db["workspace-credit-transactions"].queryPaginated(
        query,
        {
          limit,
          cursor: cursor || null,
        }
      );

      // Map transactions to response format
      const transactions = result.items.map((t) => {
        // Extract transaction ID from sk (format: `${timestamp}-${uuid}`)
        // For display, we'll use the full sk as the ID
        const transactionId = t.sk;

        return {
          id: transactionId,
          workspaceId: t.workspaceId,
          agentId: t.agentId || null,
          conversationId: t.conversationId || null,
          source: t.source,
          supplier: t.supplier,
          model: t.model || null,
          tool_call: t.tool_call || null,
          description: t.description,
          amountMillionthUsd: t.amountMillionthUsd,
          workspaceCreditsBeforeMillionthUsd:
            t.workspaceCreditsBeforeMillionthUsd,
          workspaceCreditsAfterMillionthUsd: t.workspaceCreditsAfterMillionthUsd,
          createdAt: t.createdAt,
        };
      });

      res.json({
        transactions,
        nextCursor: result.nextCursor || undefined,
      });
    })
  );
};

