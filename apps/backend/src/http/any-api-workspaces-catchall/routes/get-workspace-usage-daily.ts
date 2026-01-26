import { badRequest } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { queryUsageStats } from "../../../utils/aggregation";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/usage/daily:
 *   get:
 *     summary: Get workspace daily usage statistics
 *     description: Returns daily breakdown of usage statistics for a workspace
 *     tags:
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
 *       - name: currency
 *         in: query
 *         description: Currency for cost calculations (always USD)
 *         schema:
 *           type: string
 *           enum: [usd]
 *           default: usd
 *       - name: startDate
 *         in: query
 *         description: Start date (YYYY-MM-DD format)
 *         schema:
 *           type: string
 *           format: date
 *       - name: endDate
 *         in: query
 *         description: End date (YYYY-MM-DD format). Defaults to today.
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Daily usage statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 workspaceId:
 *                   type: string
 *                 currency:
 *                   type: string
 *                 startDate:
 *                   type: string
 *                   format: date
 *                 endDate:
 *                   type: string
 *                   format: date
 *                 daily:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       date:
 *                         type: string
 *                         format: date
 *                       inputTokens:
 *                         type: integer
 *                       outputTokens:
 *                         type: integer
 *                       totalTokens:
 *                         type: integer
 *                       cost:
 *                         type: number
 *                       rerankingCostUsd:
 *                         type: number
 *                         description: Reranking costs in USD (nano-dollars)
 *                       evalCostUsd:
 *                         type: number
 *                         description: Eval judge costs in USD (nano-dollars)
 *                       conversationCount:
 *                         type: integer
 *                       messagesIn:
 *                         type: integer
 *                       messagesOut:
 *                         type: integer
 *                       totalMessages:
 *                         type: integer
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetWorkspaceUsageDaily = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/usage/daily",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.READ),
    asyncHandler(async (req, res) => {
      const db = await database();
      const workspaceId = req.params.workspaceId;

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

      // Get daily breakdown
      const current = new Date(startDate);
      const end = new Date(endDate);

      const dailyStats = [];

      while (current <= end) {
        const dateStr = current.toISOString().split("T")[0];
        const dayStart = new Date(current);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(current);
        dayEnd.setHours(23, 59, 59, 999);

        const stats = await queryUsageStats(db, {
          workspaceId,
          startDate: dayStart,
          endDate: dayEnd,
        });

        // Total cost includes token costs, tool costs, reranking costs, and eval costs
        const cost = (stats.costUsd || 0) + (stats.rerankingCostUsd || 0) + (stats.evalCostUsd || 0);

        dailyStats.push({
          date: dateStr,
          inputTokens: stats.inputTokens,
          outputTokens: stats.outputTokens,
          totalTokens: stats.totalTokens,
          cost,
          rerankingCostUsd: stats.rerankingCostUsd,
          evalCostUsd: stats.evalCostUsd,
          conversationCount: stats.conversationCount,
          messagesIn: stats.messagesIn,
          messagesOut: stats.messagesOut,
          totalMessages: stats.totalMessages,
        });

        current.setDate(current.getDate() + 1);
      }

      res.json({
        workspaceId,
        currency: "usd",
        startDate: startDate.toISOString().split("T")[0],
        endDate: endDate.toISOString().split("T")[0],
        daily: dailyStats,
      });
    })
  );
};
