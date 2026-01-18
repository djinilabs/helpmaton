import { badRequest, resourceGone, unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import {
  DUE_PARTITION,
  DISABLED_PARTITION,
  buildAgentSchedulePk,
} from "../../../utils/agentSchedule";
import { getNextRunAtEpochSeconds } from "../../../utils/cron";
import { trackBusinessEvent } from "../../../utils/tracking";
import { validateBody } from "../../utils/bodyValidation";
import { updateAgentScheduleSchema } from "../../utils/schemas/workspaceSchemas";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/schedules/{scheduleId}:
 *   put:
 *     summary: Update a schedule
 *     description: Updates an existing schedule configuration
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               cronExpression:
 *                 type: string
 *               prompt:
 *                 type: string
 *               enabled:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Schedule updated successfully
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
export const registerPutAgentSchedule = (app: express.Application) => {
  app.put(
    "/api/workspaces/:workspaceId/agents/:agentId/schedules/:scheduleId",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const body = validateBody(req.body, updateAgentScheduleSchema);
        const { name, cronExpression, prompt, enabled } = body;

        const db = await database();
        const workspaceResource = req.workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const currentUserRef = req.userRef;
        if (!currentUserRef) {
          throw unauthorized();
        }
        const workspaceId = req.params.workspaceId;
        const agentId = req.params.agentId;
        const scheduleId = req.params.scheduleId;
        const schedulePk = buildAgentSchedulePk(
          workspaceId,
          agentId,
          scheduleId
        );

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

        const updateData: Partial<typeof schedule> = {
          updatedAt: new Date().toISOString(),
        };

        if (name !== undefined) updateData.name = name;
        if (prompt !== undefined) updateData.prompt = prompt;
        if (cronExpression !== undefined) {
          updateData.cronExpression = cronExpression;
        }
        if (enabled !== undefined) {
          updateData.enabled = enabled;
          updateData.duePartition = enabled ? DUE_PARTITION : DISABLED_PARTITION;
        }

        const shouldRecomputeNextRunAt =
          cronExpression !== undefined || (enabled === true && !schedule.enabled);
        if (shouldRecomputeNextRunAt) {
          const finalCronExpression =
            cronExpression ?? schedule.cronExpression;
          updateData.nextRunAt = getNextRunAtEpochSeconds(
            finalCronExpression,
            new Date()
          );
        }

        await db["agent-schedule"].update({
          ...schedule,
          ...updateData,
        });

        const updatedSchedule = await db["agent-schedule"].get(
          schedulePk,
          "schedule"
        );
        if (!updatedSchedule) {
          throw resourceGone("Schedule not found after update");
        }

        trackBusinessEvent(
          "agent_schedule",
          "updated",
          {
            workspace_id: workspaceId,
            agent_id: agentId,
            schedule_id: updatedSchedule.scheduleId,
            enabled: updatedSchedule.enabled,
            name_updated: name !== undefined,
            prompt_updated: prompt !== undefined,
            cron_expression_updated: cronExpression !== undefined,
            enabled_updated: enabled !== undefined,
          },
          req
        );

        res.json({
          id: updatedSchedule.scheduleId,
          name: updatedSchedule.name,
          cronExpression: updatedSchedule.cronExpression,
          prompt: updatedSchedule.prompt,
          enabled: updatedSchedule.enabled,
          nextRunAt: updatedSchedule.nextRunAt,
          lastRunAt: updatedSchedule.lastRunAt ?? null,
          createdAt: updatedSchedule.createdAt,
          updatedAt: updatedSchedule.updatedAt,
        });
      } catch (error) {
        handleError(error, next);
      }
    }
  );
};
