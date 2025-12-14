import { badRequest, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { queryUsageStats, type Currency } from "../../../utils/aggregation";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";
import { ALLOWED_CURRENCIES } from "../utils";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/usage/daily:
 *   get:
 *     summary: Get agent daily usage statistics
 *     description: Returns daily breakdown of usage statistics for an agent
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
 *         description: Currency for cost calculations
 *         schema:
 *           type: string
 *           enum: [usd, eur, gbp]
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
 *                 agentId:
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
export const registerGetAgentUsageDaily = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/agents/:agentId/usage/daily",
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
      const currencyParam = req.query.currency as string | undefined;
      const currency: Currency = currencyParam
        ? ALLOWED_CURRENCIES.includes(currencyParam as Currency)
          ? (currencyParam as Currency)
          : (() => {
              throw badRequest(
                `Invalid currency. Allowed values: ${ALLOWED_CURRENCIES.join(
                  ", "
                )}`
              );
            })()
        : "usd";
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
          agentId,
          startDate: dayStart,
          endDate: dayEnd,
        });

        const cost =
          currency === "usd"
            ? stats.costUsd
            : currency === "eur"
            ? stats.costEur
            : stats.costGbp;

        dailyStats.push({
          date: dateStr,
          inputTokens: stats.inputTokens,
          outputTokens: stats.outputTokens,
          totalTokens: stats.totalTokens,
          cost,
        });

        current.setDate(current.getDate() + 1);
      }

      res.json({
        workspaceId,
        agentId,
        currency,
        startDate: startDate.toISOString().split("T")[0],
        endDate: endDate.toISOString().split("T")[0],
        daily: dailyStats,
      });
    })
  );
};
