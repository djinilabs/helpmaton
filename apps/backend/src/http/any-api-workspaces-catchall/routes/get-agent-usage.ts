import { badRequest, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { queryUsageStats } from "../../../utils/aggregation";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/usage:
 *   get:
 *     summary: Get agent usage statistics
 *     description: Returns usage statistics for a specific agent
 *     tags:
 *       - Agents
 *       - Usage
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
 *       - name: currency
 *         in: query
 *         description: Currency for cost calculations (always USD)
 *         schema:
 *           type: string
 *           enum: [usd]
 *           default: usd
 *       - name: startDate
 *         in: query
 *         description: Start date for usage statistics (YYYY-MM-DD format)
 *         schema:
 *           type: string
 *           format: date
 *       - name: endDate
 *         in: query
 *         description: End date for usage statistics (YYYY-MM-DD format). Defaults to today.
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Agent usage statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 workspaceId:
 *                   type: string
 *                 agentId:
 *                   type: string
 *                 currency:
 *                   type: string
 *                   enum: [usd]
 *                 startDate:
 *                   type: string
 *                   format: date
 *                 endDate:
 *                   type: string
 *                   format: date
 *                 stats:
 *                   type: object
 *                   properties:
 *                     inputTokens:
 *                       type: integer
 *                     outputTokens:
 *                       type: integer
 *                     totalTokens:
 *                       type: integer
 *                     cost:
 *                       type: number
 *                     byModel:
 *                       type: array
 *                       items:
 *                         type: object
 *                     byProvider:
 *                       type: array
 *                       items:
 *                         type: object
 *                     byByok:
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
export const registerGetAgentUsage = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/agents/:agentId/usage",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.READ),
    asyncHandler(async (req, res) => {
      const db = await database();
      const workspaceId = req.params.workspaceId;
      const agentId = req.params.agentId;

      // Verify agent belongs to workspace
      const agentPk = `agents/${workspaceId}/${agentId}`;
      const agent = await db.agent.get(agentPk, "agent");
      if (!agent) {
        throw resourceGone("Agent not found");
      }

      // Parse query parameters
      const startDateStr = req.query.startDate as string;
      const endDateStr = req.query.endDate as string;

      const endDate = endDateStr ? new Date(endDateStr) : new Date();
      const startDate = startDateStr
        ? new Date(startDateStr)
        : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000); // Default to last 30 days

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw badRequest(
          "Invalid date format. Use ISO 8601 format (YYYY-MM-DD)"
        );
      }

      const stats = await queryUsageStats(db, {
        workspaceId,
        agentId,
        startDate,
        endDate,
      });

      res.json({
        workspaceId,
        agentId,
        currency: "usd",
        startDate: startDate.toISOString().split("T")[0],
        endDate: endDate.toISOString().split("T")[0],
        stats: {
          inputTokens: stats.inputTokens,
          outputTokens: stats.outputTokens,
          totalTokens: stats.totalTokens,
          cost: stats.costUsd,
          byModel: Object.entries(stats.byModel).map(([model, modelStats]) => ({
            model,
            inputTokens: modelStats.inputTokens,
            outputTokens: modelStats.outputTokens,
            totalTokens: modelStats.totalTokens,
            cost: modelStats.costUsd,
          })),
          byProvider: Object.entries(stats.byProvider).map(
            ([provider, providerStats]) => ({
              provider,
              inputTokens: providerStats.inputTokens,
              outputTokens: providerStats.outputTokens,
              totalTokens: providerStats.totalTokens,
              cost: providerStats.costUsd,
            })
          ),
          byByok: {
            byok: {
              inputTokens: stats.byByok.byok.inputTokens,
              outputTokens: stats.byByok.byok.outputTokens,
              totalTokens: stats.byByok.byok.totalTokens,
              cost: stats.byByok.byok.costUsd,
            },
            platform: {
              inputTokens: stats.byByok.platform.inputTokens,
              outputTokens: stats.byByok.platform.outputTokens,
              totalTokens: stats.byByok.platform.totalTokens,
              cost: stats.byByok.platform.costUsd,
            },
          },
          toolExpenses: Object.entries(stats.toolExpenses).map(
            ([key, toolStats]) => {
              const [toolCall, supplier] = key.split("-");
              return {
                toolCall,
                supplier,
                cost: toolStats.costUsd,
                callCount: toolStats.callCount,
              };
            }
          ),
        },
      });
    })
  );
};
