import { badRequest, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}:
 *   get:
 *     summary: Get workspace agent
 *     description: Returns details for a specific agent
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
 *         description: Agent details
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
 *         description: Agent not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetWorkspaceAgent = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/agents/:agentId",
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
        const agentPk = `agents/${workspaceId}/${agentId}`;

        const agent = await db.agent.get(agentPk, "agent");
        if (!agent) {
          throw resourceGone("Agent not found");
        }

        // Migrate enableTavilyFetch to fetchWebProvider for backward compatibility
        const fetchWebProvider =
          agent.fetchWebProvider ??
          (agent.enableTavilyFetch === true ? "tavily" : undefined);

        // Migrate enableTavilySearch to searchWebProvider for backward compatibility
        const searchWebProvider =
          agent.searchWebProvider ??
          (agent.enableTavilySearch === true ? "tavily" : undefined);

        res.json({
          id: agentId,
          name: agent.name,
          systemPrompt: agent.systemPrompt,
          summarizationPrompts: agent.summarizationPrompts,
          memoryExtractionEnabled: agent.memoryExtractionEnabled ?? false,
          memoryExtractionModel: agent.memoryExtractionModel ?? null,
          memoryExtractionPrompt: agent.memoryExtractionPrompt ?? null,
          notificationChannelId: agent.notificationChannelId,
          delegatableAgentIds: agent.delegatableAgentIds ?? [],
          enabledMcpServerIds: agent.enabledMcpServerIds ?? [],
          enableMemorySearch: agent.enableMemorySearch ?? false,
          enableSearchDocuments: agent.enableSearchDocuments ?? false,
          enableKnowledgeInjection: agent.enableKnowledgeInjection ?? false,
          knowledgeInjectionSnippetCount:
            agent.knowledgeInjectionSnippetCount ?? undefined,
          knowledgeInjectionMinSimilarity:
            agent.knowledgeInjectionMinSimilarity ?? undefined,
          enableKnowledgeReranking: agent.enableKnowledgeReranking ?? false,
          knowledgeRerankingModel: agent.knowledgeRerankingModel ?? undefined,
          enableSendEmail: agent.enableSendEmail ?? false,
          enableTavilySearch: agent.enableTavilySearch ?? false,
          searchWebProvider: searchWebProvider ?? null,
          fetchWebProvider: fetchWebProvider ?? null,
          enableExaSearch: agent.enableExaSearch ?? false,
          enableImageGeneration: agent.enableImageGeneration ?? false,
          imageGenerationModel: agent.imageGenerationModel ?? null,
          clientTools: agent.clientTools ?? [],
          spendingLimits: agent.spendingLimits ?? [],
          temperature: agent.temperature ?? null,
          topP: agent.topP ?? null,
          topK: agent.topK ?? null,
          maxOutputTokens: agent.maxOutputTokens ?? null,
          stopSequences: agent.stopSequences ?? null,
          maxToolRoundtrips: agent.maxToolRoundtrips ?? null,
          provider: agent.provider,
          modelName: agent.modelName ?? null,
          avatar: agent.avatar ?? null,
          widgetConfig: agent.widgetConfig ?? undefined,
          createdAt: agent.createdAt,
          updatedAt: agent.updatedAt,
        });
      } catch (error) {
        handleError(
          error,
          next,
          "GET /api/workspaces/:workspaceId/agents/:agentId",
        );
      }
    },
  );
};
