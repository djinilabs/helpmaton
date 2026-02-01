import { badRequest, resourceGone, unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { getUserAuthorizationLevelForResource } from "../../../tables/permissions";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import {
  buildWorkspaceSuggestionContext,
  resolveAgentSuggestions,
} from "../../utils/suggestions";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/suggestions:
 *   get:
 *     summary: Get agent suggestions
 *     description: Returns LLM-generated suggestions for the agent. May take a few seconds on first load. Does not block the main agent response.
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
 *         description: Suggestions (or null if none)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuggestionsResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       410:
 *         description: Workspace or agent not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetAgentSuggestions = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/agents/:agentId/suggestions",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.READ),
    async (req, res, next) => {
      try {
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
        const agentPk = `agents/${workspaceId}/${agentId}`;

        const agent = await db.agent.get(agentPk, "agent");
        if (!agent) {
          throw resourceGone("Agent not found");
        }

        const workspacePk = `workspaces/${workspaceId}`;
        const workspace = await db.workspace.get(workspacePk, "workspace");
        if (!workspace) {
          throw resourceGone("Workspace not found");
        }

        await getUserAuthorizationLevelForResource(
          workspaceResource,
          currentUserRef
        );

        let evalJudgeCount = 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
        for await (const _ of (db as any)["agent-eval-judge"].queryAsync({
          IndexName: "byAgentId",
          KeyConditionExpression: "agentId = :agentId",
          ExpressionAttributeValues: {
            ":agentId": agentId,
          },
        })) {
          evalJudgeCount += 1;
        }

        let scheduleCount = 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
        for await (const _ of (db as any)["agent-schedule"].queryAsync({
          IndexName: "byAgentId",
          KeyConditionExpression: "agentId = :agentId",
          ExpressionAttributeValues: {
            ":agentId": agentId,
          },
        })) {
          scheduleCount += 1;
        }

        const workspaceContext = await buildWorkspaceSuggestionContext({
          db,
          workspaceId,
          workspace,
        });

        const suggestions = await resolveAgentSuggestions({
          db,
          workspaceId,
          agentId,
          agentPk,
          workspaceContext,
          agent: {
            ...agent,
            evalJudgeCount,
            scheduleCount,
            delegatableAgentIds: agent.delegatableAgentIds ?? [],
          },
        });

        res.json({
          suggestions: suggestions
            ? {
                items: suggestions.items,
                generatedAt: suggestions.generatedAt,
              }
            : null,
        });
      } catch (error) {
        handleError(
          error,
          next,
          "GET /api/workspaces/:workspaceId/agents/:agentId/suggestions",
        );
      }
    },
  );
};
