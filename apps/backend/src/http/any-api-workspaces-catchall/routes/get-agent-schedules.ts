import { badRequest } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/schedules:
 *   get:
 *     summary: List schedules for an agent
 *     description: Returns all schedules configured for an agent
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
 *     responses:
 *       200:
 *         description: List of schedules
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetAgentSchedules = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/agents/:agentId/schedules",
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

        // Verify agent exists and belongs to workspace
        const agentPk = `agents/${workspaceId}/${agentId}`;
        const agent = await db.agent.get(agentPk, "agent");
        if (!agent) {
          throw badRequest("Agent not found");
        }
        if (agent.workspaceId !== workspaceId) {
          throw badRequest("Agent does not belong to this workspace");
        }

        const schedules: Array<{
          id: string;
          name: string;
          cronExpression: string;
          prompt: string;
          enabled: boolean;
          nextRunAt: number;
          lastRunAt?: string | null;
          createdAt: string;
          updatedAt?: string;
        }> = [];

        for await (const schedule of db["agent-schedule"].queryAsync({
          IndexName: "byAgentId",
          KeyConditionExpression: "agentId = :agentId",
          ExpressionAttributeValues: {
            ":agentId": agentId,
          },
          ScanIndexForward: false,
        })) {
          schedules.push({
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
        }

        res.json(schedules);
      } catch (error) {
        handleError(error, next);
      }
    }
  );
};
