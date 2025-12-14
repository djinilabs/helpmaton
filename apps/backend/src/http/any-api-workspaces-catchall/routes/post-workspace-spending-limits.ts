import { badRequest } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import type { WorkspaceRecord } from "../../../tables/schema";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { addSpendingLimit } from "../../../utils/spendingLimitsManagement";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/spending-limits:
 *   post:
 *     summary: Create workspace spending limit
 *     description: Creates a spending limit for a workspace to control costs over a specific time period (daily, weekly, or monthly). When the limit is reached, operations that would exceed it will be blocked. Multiple limits can be set for different time frames. Requires WRITE permission or higher.
 *     tags:
 *       - Spending Limits
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: workspaceId
 *         in: path
 *         required: true
 *         description: Workspace ID
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - timeFrame
 *               - amount
 *             properties:
 *               timeFrame:
 *                 type: string
 *                 enum: [daily, weekly, monthly]
 *                 description: Time period for the spending limit
 *               amount:
 *                 type: number
 *                 minimum: 0
 *                 description: Spending limit amount
 *     responses:
 *       200:
 *         description: Workspace with updated spending limits
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Workspace'
 *                 - type: object
 *                   properties:
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPostWorkspaceSpendingLimits = (
  app: express.Application
) => {
  app.post(
    "/api/workspaces/:workspaceId/spending-limits",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const { timeFrame, amount } = req.body;
        if (!timeFrame || !["daily", "weekly", "monthly"].includes(timeFrame)) {
          throw badRequest(
            "timeFrame is required and must be 'daily', 'weekly', or 'monthly'"
          );
        }
        if (typeof amount !== "number" || amount < 0) {
          throw badRequest(
            "amount is required and must be a non-negative number"
          );
        }

        const db = await database();
        const workspaceResource = req.workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const workspaceId = req.params.workspaceId;

        const updated = (await addSpendingLimit(db, workspaceId, {
          timeFrame,
          amount,
        })) as WorkspaceRecord;

        res.json({
          id: updated.pk.replace("workspaces/", ""),
          name: updated.name,
          description: updated.description,
          creditBalance: updated.creditBalance ?? 0,
          currency: updated.currency ?? "usd",
          spendingLimits: updated.spendingLimits ?? [],
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        });
      } catch (error) {
        handleError(
          error,
          next,
          "POST /api/workspaces/:workspaceId/spending-limits"
        );
      }
    }
  );
};
