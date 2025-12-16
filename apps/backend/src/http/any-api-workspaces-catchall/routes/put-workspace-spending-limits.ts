import { badRequest } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import type { WorkspaceRecord } from "../../../tables/schema";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { updateSpendingLimit } from "../../../utils/spendingLimitsManagement";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/spending-limits/{timeFrame}:
 *   put:
 *     summary: Update workspace spending limit
 *     description: Updates the amount for an existing spending limit for a specific time frame (daily, weekly, or monthly). The time frame must already exist. Requires WRITE permission or higher.
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
 *       - name: timeFrame
 *         in: path
 *         required: true
 *         description: Time frame for the spending limit
 *         schema:
 *           type: string
 *           enum: [daily, weekly, monthly]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *             properties:
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
export const registerPutWorkspaceSpendingLimits = (
  app: express.Application
) => {
  app.put(
    "/api/workspaces/:workspaceId/spending-limits/:timeFrame",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const { amount } = req.body;
        if (typeof amount !== "number" || amount < 0 || !Number.isInteger(amount)) {
          throw badRequest(
            "amount is required and must be a non-negative integer (millionths)"
          );
        }

        const timeFrame = req.params.timeFrame;
        if (!["daily", "weekly", "monthly"].includes(timeFrame)) {
          throw badRequest("timeFrame must be 'daily', 'weekly', or 'monthly'");
        }

        const db = await database();
        const workspaceResource = req.workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const workspaceId = req.params.workspaceId;

        const updated = (await updateSpendingLimit(
          db,
          workspaceId,
          timeFrame as "daily" | "weekly" | "monthly",
          amount
        )) as WorkspaceRecord;

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
          "PUT /api/workspaces/:workspaceId/spending-limits/:timeFrame"
        );
      }
    }
  );
};
