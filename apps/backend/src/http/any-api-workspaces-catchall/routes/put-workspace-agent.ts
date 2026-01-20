import { badRequest } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { isValidAvatar } from "../../../utils/avatarUtils";
import { normalizeSummarizationPrompts } from "../../../utils/memory/summarizeMemory";
import { trackBusinessEvent } from "../../../utils/tracking";
import { validateBody } from "../../utils/bodyValidation";
import { updateAgentSchema } from "../../utils/schemas/workspaceSchemas";
import { handleError, requireAuth, requirePermission } from "../middleware";

import {
  buildAgentResponse,
  buildAgentUpdateParams,
  cleanEnabledMcpServerIds,
  getAgentOrThrow,
  resolveFetchWebProvider,
  resolveSearchWebProvider,
  validateClientTools,
  validateDelegatableAgentIds,
  validateKnowledgeConfig,
  validateModelName,
  validateModelTuning,
  validateNotificationChannelId,
  validateSpendingLimits,
  validateAvatar,
} from "./agentUpdate";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}:
 *   put:
 *     summary: Update workspace agent
 *     description: Updates agent configuration. Validates delegation chains to prevent circular references.
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
 *             $ref: '#/components/schemas/UpdateAgentRequest'
 *     responses:
 *       200:
 *         description: Agent updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Agent'
 *                 - type: object
 *                   properties:
 *                     spendingLimits:
 *                       type: array
 *                       items:
 *                         type: object
 *                     temperature:
 *                       type: number
 *                       nullable: true
 *                     topP:
 *                       type: number
 *                       nullable: true
 *                     topK:
 *                       type: integer
 *                       nullable: true
 *                     maxOutputTokens:
 *                       type: integer
 *                       nullable: true
 *                     stopSequences:
 *                       type: array
 *                       items:
 *                         type: string
 *                       nullable: true
 *                     maxToolRoundtrips:
 *                       type: integer
 *                       nullable: true
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       410:
 *         description: Agent or related resource not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPutWorkspaceAgent = (app: express.Application) => {
  app.put(
    "/api/workspaces/:workspaceId/agents/:agentId",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const body = validateBody(req.body, updateAgentSchema);
        const db = await database();
        const workspaceResource = req.workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }

        const normalizedSummarizationPrompts =
          normalizeSummarizationPrompts(body.summarizationPrompts);
        const workspaceId = req.params.workspaceId;
        const agentId = req.params.agentId;
        const agentPk = `agents/${workspaceId}/${agentId}`;

        const agent = await getAgentOrThrow({
          db,
          workspaceId,
          agentId,
        });

        await validateNotificationChannelId({
          db,
          workspaceId,
          notificationChannelId: body.notificationChannelId,
        });
        validateSpendingLimits(body.spendingLimits);
        await validateDelegatableAgentIds({
          db,
          workspaceId,
          agentId,
          delegatableAgentIds: body.delegatableAgentIds,
        });
        const cleanedEnabledMcpServerIds = await cleanEnabledMcpServerIds({
          db,
          workspaceId,
          enabledMcpServerIds: body.enabledMcpServerIds,
          existingEnabledMcpServerIds: agent.enabledMcpServerIds,
        });
        validateClientTools(body.clientTools);
        validateKnowledgeConfig({
          knowledgeInjectionMinSimilarity: body.knowledgeInjectionMinSimilarity,
        });
        validateModelTuning({
          temperature: body.temperature,
          topP: body.topP,
          topK: body.topK,
          maxOutputTokens: body.maxOutputTokens,
          stopSequences: body.stopSequences,
          maxToolRoundtrips: body.maxToolRoundtrips,
        });
        const resolvedModelName = await validateModelName({
          modelName: body.modelName,
        });
        validateAvatar({ avatar: body.avatar, isValidAvatar });

        const resolvedSearchWebProvider = resolveSearchWebProvider({
          searchWebProvider: body.searchWebProvider,
          enableTavilySearch: body.enableTavilySearch,
          currentProvider: agent.searchWebProvider,
        });
        const resolvedFetchWebProvider = resolveFetchWebProvider({
          fetchWebProvider: body.fetchWebProvider,
          enableTavilyFetch: body.enableTavilyFetch,
          currentProvider: agent.fetchWebProvider,
        });

        // Update agent
        // Convert null to undefined for optional fields to match schema
        const updated = await db.agent.update(
          buildAgentUpdateParams({
            body,
            agent,
            agentPk,
            workspaceId,
            normalizedSummarizationPrompts,
            cleanedEnabledMcpServerIds,
            resolvedSearchWebProvider,
            resolvedFetchWebProvider,
            resolvedModelName,
            updatedBy: req.userRef || "",
          })
        );

        const response = buildAgentResponse({ agentId, updated });

        // Track agent update
        trackBusinessEvent(
          "agent",
          "updated",
          {
            workspace_id: workspaceId,
            agent_id: agentId,
            provider: updated.provider,
            model_name: updated.modelName || undefined,
          },
          req
        );

        res.json(response);
      } catch (error) {
        handleError(
          error,
          next,
          "PUT /api/workspaces/:workspaceId/agents/:agentId"
        );
      }
    }
  );
};
