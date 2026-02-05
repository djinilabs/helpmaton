import { badRequest } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { requireAgentInWorkspace } from "../../utils/agentScheduleAccess";
import { parseLimitParam } from "../../utils/paginationParams";
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

        await requireAgentInWorkspace(db, workspaceId, agentId);

        const limit = parseLimitParam(req.query.limit);
        const cursor = req.query.cursor as string | undefined;

        const query: Parameters<
          (typeof db)["agent-schedule"]["queryPaginated"]
        >[0] = {
          IndexName: "byAgentId",
          KeyConditionExpression: "agentId = :agentId",
          ExpressionAttributeValues: {
            ":agentId": agentId,
          },
          ScanIndexForward: false,
        };

        const result = await db["agent-schedule"].queryPaginated(query, {
          limit,
          cursor: cursor ?? null,
        });

        const schedules = result.items.map((schedule) => ({
          id: schedule.scheduleId,
          name: schedule.name,
          cronExpression: schedule.cronExpression,
          prompt: schedule.prompt,
          enabled: schedule.enabled,
          nextRunAt: schedule.nextRunAt,
          lastRunAt: schedule.lastRunAt ?? null,
          createdAt: schedule.createdAt,
          updatedAt: schedule.updatedAt,
        }));

        res.json({
          schedules,
          nextCursor: result.nextCursor ?? undefined,
        });
      } catch (error) {
        handleError(error, next);
      }
    }
  );
};
