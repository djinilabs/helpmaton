import { badRequest } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import type { AgentRecord } from "../../../tables/schema";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { removeSpendingLimit } from "../../../utils/spendingLimitsManagement";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/spending-limits/{timeFrame}:
 *   delete:
 *     summary: Delete agent spending limit
 *     description: Removes a spending limit for a specific agent and time frame (daily, weekly, or monthly). After deletion, there will be no agent-level limit for that time frame, but workspace-level limits still apply. Requires WRITE permission or higher.
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
 *       - name: timeFrame
 *         in: path
 *         required: true
 *         description: Time frame for the spending limit
 *         schema:
 *           type: string
 *           enum: [daily, weekly, monthly]
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
export const registerDeleteAgentSpendingLimits = (app: express.Application) => {
  app.delete(
    "/api/workspaces/:workspaceId/agents/:agentId/spending-limits/:timeFrame",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
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
        const agentId = req.params.agentId;

        const updated = (await removeSpendingLimit(
          db,
          workspaceId,
          timeFrame as "daily" | "weekly" | "monthly",
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
          "DELETE /api/workspaces/:workspaceId/agents/:agentId/spending-limits/:timeFrame"
        );
      }
    }
  );
};
