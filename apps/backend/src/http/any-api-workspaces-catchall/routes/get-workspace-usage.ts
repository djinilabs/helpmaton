import { badRequest } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { queryUsageStats, type Currency } from "../../../utils/aggregation";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";
import { ALLOWED_CURRENCIES } from "../utils";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/usage:
 *   get:
 *     summary: Get workspace usage statistics
 *     description: Returns usage statistics for a workspace
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
 *         description: Currency for cost calculations
 *         schema:
 *           type: string
 *           enum: [usd, eur, gbp]
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
 *         description: Workspace usage statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 workspaceId:
 *                   type: string
 *                 currency:
 *                   type: string
 *                   enum: [usd, eur, gbp]
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
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetWorkspaceUsage = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/usage",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.READ),
    asyncHandler(async (req, res) => {
      const db = await database();
      const workspaceId = req.params.workspaceId;

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

      console.log(
        "[GET /api/workspaces/:workspaceId/usage] Query parameters:",
        {
          workspaceId,
          currency,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        }
      );

      const stats = await queryUsageStats(db, {
        workspaceId,
        startDate,
        endDate,
      });

      console.log("[GET /api/workspaces/:workspaceId/usage] Stats:", {
        inputTokens: stats.inputTokens,
        outputTokens: stats.outputTokens,
        totalTokens: stats.totalTokens,
        costUsd: stats.costUsd,
        costEur: stats.costEur,
        costGbp: stats.costGbp,
        byModel: Object.keys(stats.byModel),
        byProvider: Object.keys(stats.byProvider),
      });

      // Select cost based on currency
      const cost =
        currency === "usd"
          ? stats.costUsd
          : currency === "eur"
          ? stats.costEur
          : stats.costGbp;

      res.json({
        workspaceId,
        currency,
        startDate: startDate.toISOString().split("T")[0],
        endDate: endDate.toISOString().split("T")[0],
        stats: {
          inputTokens: stats.inputTokens,
          outputTokens: stats.outputTokens,
          totalTokens: stats.totalTokens,
          cost,
          byModel: Object.entries(stats.byModel).map(([model, modelStats]) => ({
            model,
            inputTokens: modelStats.inputTokens,
            outputTokens: modelStats.outputTokens,
            totalTokens: modelStats.totalTokens,
            cost:
              currency === "usd"
                ? modelStats.costUsd
                : currency === "eur"
                ? modelStats.costEur
                : modelStats.costGbp,
          })),
          byProvider: Object.entries(stats.byProvider).map(
            ([provider, providerStats]) => ({
              provider,
              inputTokens: providerStats.inputTokens,
              outputTokens: providerStats.outputTokens,
              totalTokens: providerStats.totalTokens,
              cost:
                currency === "usd"
                  ? providerStats.costUsd
                  : currency === "eur"
                  ? providerStats.costEur
                  : providerStats.costGbp,
            })
          ),
          byByok: {
            byok: {
              inputTokens: stats.byByok.byok.inputTokens,
              outputTokens: stats.byByok.byok.outputTokens,
              totalTokens: stats.byByok.byok.totalTokens,
              cost:
                currency === "usd"
                  ? stats.byByok.byok.costUsd
                  : currency === "eur"
                  ? stats.byByok.byok.costEur
                  : stats.byByok.byok.costGbp,
            },
            platform: {
              inputTokens: stats.byByok.platform.inputTokens,
              outputTokens: stats.byByok.platform.outputTokens,
              totalTokens: stats.byByok.platform.totalTokens,
              cost:
                currency === "usd"
                  ? stats.byByok.platform.costUsd
                  : currency === "eur"
                  ? stats.byByok.platform.costEur
                  : stats.byByok.platform.costGbp,
            },
          },
        },
      });
    })
  );
};
