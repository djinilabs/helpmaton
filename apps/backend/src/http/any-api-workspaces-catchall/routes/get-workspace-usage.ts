import { badRequest } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { queryUsageStats } from "../../../utils/aggregation";
import { trackBusinessEvent } from "../../../utils/tracking";
import { extractUserId } from "../../utils/session";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";

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
        byModel: Object.keys(stats.byModel),
        byProvider: Object.keys(stats.byProvider),
        toolExpenses: Object.keys(stats.toolExpenses),
      });

      // Track workspace usage viewing
      const userId = extractUserId(req);
      if (userId) {
        trackBusinessEvent("workspace", "usage_viewed", {
          workspace_id: workspaceId,
          start_date: startDate.toISOString().split("T")[0],
          end_date: endDate.toISOString().split("T")[0],
          user_id: userId,
        });
      }

      res.json({
        workspaceId,
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
