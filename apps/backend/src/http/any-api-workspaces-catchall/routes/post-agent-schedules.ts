import { randomUUID } from "crypto";

import { badRequest, unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { buildScheduleRecordForCreate } from "../../../utils/agentSchedule";
import {
  ensureAgentScheduleCreationAllowed,
} from "../../../utils/subscriptionUtils";
import { trackBusinessEvent } from "../../../utils/tracking";
import { requireAgentInWorkspace } from "../../utils/agentScheduleAccess";
import { validateBody } from "../../utils/bodyValidation";
import { createAgentScheduleSchema } from "../../utils/schemas/workspaceSchemas";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/schedules:
 *   post:
 *     summary: Create a schedule for an agent
 *     description: Creates a new schedule configuration for an agent (UTC cron)
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - cronExpression
 *               - prompt
 *             properties:
 *               name:
 *                 type: string
 *                 description: Schedule name
 *               cronExpression:
 *                 type: string
 *                 description: Cron expression (UTC)
 *               prompt:
 *                 type: string
 *                 description: First user message for scheduled run
 *               enabled:
 *                 type: boolean
 *                 default: true
 *                 description: Whether the schedule is enabled
 *     responses:
 *       201:
 *         description: Schedule created successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPostAgentSchedules = (app: express.Application) => {
  app.post(
    "/api/workspaces/:workspaceId/agents/:agentId/schedules",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const body = validateBody(req.body, createAgentScheduleSchema);
        const { name, cronExpression, prompt } = body;
        const enabled = body.enabled ?? true;

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

        await requireAgentInWorkspace(db, workspaceId, agentId);

        const userId = currentUserRef.replace("users/", "");
        await ensureAgentScheduleCreationAllowed(workspaceId, userId, agentId);

        const scheduleId = randomUUID();
        const scheduleRecord = buildScheduleRecordForCreate(
          workspaceId,
          agentId,
          scheduleId,
          { name, cronExpression, prompt, enabled }
        );

        await db["agent-schedule"].create(
          scheduleRecord as Parameters<
            (typeof db)["agent-schedule"]["create"]
          >[0]
        );

        trackBusinessEvent(
          "agent_schedule",
          "created",
          {
            workspace_id: workspaceId,
            agent_id: agentId,
            schedule_id: scheduleId,
            enabled,
          },
          req
        );

        const created = scheduleRecord as {
          nextRunAt: number;
          createdAt: string;
        };
        res.status(201).json({
          id: scheduleId,
          name,
          cronExpression,
          prompt,
          enabled,
          nextRunAt: created.nextRunAt,
          lastRunAt: null,
          createdAt: created.createdAt,
        });
      } catch (error) {
        handleError(error, next);
      }
    }
  );
};
