import { badRequest, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/schedules/{scheduleId}:
 *   get:
 *     summary: Get a schedule
 *     description: Returns a single schedule configuration for an agent
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
 *       - name: scheduleId
 *         in: path
 *         required: true
 *         description: Schedule ID
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Schedule details
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       410:
 *         description: Schedule not found
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetAgentSchedule = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/agents/:agentId/schedules/:scheduleId",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.READ),
    async (req, res, next) => {
      try {
        const db = await database();
        const workspaceResource = req.workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const workspaceId = req.params.workspaceId;
        const agentId = req.params.agentId;
        const scheduleId = req.params.scheduleId;
        const schedulePk = `agent-schedules/${workspaceId}/${agentId}/${scheduleId}`;

        const schedule = await db["agent-schedule"].get(
          schedulePk,
          "schedule"
        );
        if (!schedule) {
          throw resourceGone("Schedule not found");
        }
        if (
          schedule.workspaceId !== workspaceId ||
          schedule.agentId !== agentId
        ) {
          throw badRequest("Schedule does not belong to this agent");
        }

        res.json({
          id: schedule.scheduleId,
          name: schedule.name,
          cronExpression: schedule.cronExpression,
          prompt: schedule.prompt,
          enabled: schedule.enabled,
          nextRunAt: schedule.nextRunAt,
          lastRunAt: schedule.lastRunAt ?? null,
          createdAt: schedule.createdAt,
          updatedAt: schedule.updatedAt,
        });
      } catch (error) {
        handleError(error, next);
      }
    }
  );
};
