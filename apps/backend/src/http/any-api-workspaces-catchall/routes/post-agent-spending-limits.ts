import { badRequest } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import type { AgentRecord } from "../../../tables/schema";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { addSpendingLimit } from "../../../utils/spendingLimitsManagement";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/spending-limits:
 *   post:
 *     summary: Create agent spending limit
 *     description: Creates a spending limit for a specific agent to control costs over a specific time period (daily, weekly, or monthly). Agent-level limits work in addition to workspace-level limits. When either limit is reached, operations will be blocked. Requires WRITE permission or higher.
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
 *       - name: agentId
 *         in: path
 *         required: true
 *         description: Agent ID
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
 *         description: Agent with updated spending limits
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 name:
 *                   type: string
 *                 systemPrompt:
 *                   type: string
 *                 notificationChannelId:
 *                   type: string
 *                   nullable: true
 *                 spendingLimits:
 *                   type: array
 *                   items:
 *                     type: object
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *                 updatedAt:
 *                   type: string
 *                   format: date-time
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPostAgentSpendingLimits = (app: express.Application) => {
  app.post(
    "/api/workspaces/:workspaceId/agents/:agentId/spending-limits",
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
        const agentId = req.params.agentId;

        const updated = (await addSpendingLimit(
          db,
          workspaceId,
          { timeFrame, amount },
          agentId
        )) as AgentRecord;

        res.json({
          id: agentId,
          name: updated.name,
          systemPrompt: updated.systemPrompt,
          notificationChannelId: updated.notificationChannelId,
          spendingLimits: updated.spendingLimits ?? [],
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        });
      } catch (error) {
        handleError(
          error,
          next,
          "POST /api/workspaces/:workspaceId/agents/:agentId/spending-limits"
        );
      }
    }
  );
};
