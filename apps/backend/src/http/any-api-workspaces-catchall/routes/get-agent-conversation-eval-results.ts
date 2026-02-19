import { badRequest } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { getRecord } from "../../../utils/conversationRecords";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/conversations/{conversationId}/eval-results:
 *   get:
 *     summary: Get evaluation results for a conversation
 *     description: Returns all evaluation results for a specific conversation
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
 *       - name: conversationId
 *         in: path
 *         required: true
 *         description: Conversation ID
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of evaluation results
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   judgeId:
 *                     type: string
 *                   judgeName:
 *                     type: string
 *                   status:
 *                     type: string
 *                     enum: ["completed", "failed"]
 *                   summary:
 *                     type: string
 *                   scoreGoalCompletion:
 *                     type: integer
 *                     minimum: 0
 *                     maximum: 100
 *                   scoreToolEfficiency:
 *                     type: integer
 *                     minimum: 0
 *                     maximum: 100
 *                   scoreFaithfulness:
 *                     type: integer
 *                     minimum: 0
 *                     maximum: 100
 *                   criticalFailureDetected:
 *                     type: boolean
 *                   reasoningTrace:
 *                     type: string
 *                   errorMessage:
 *                     type: string
 *                     nullable: true
 *                   errorDetails:
 *                     type: string
 *                     nullable: true
 *                   costUsd:
 *                     type: number
 *                     nullable: true
 *                   evaluatedAt:
 *                     type: string
 *                     format: date-time
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetAgentConversationEvalResults = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/agents/:agentId/conversations/:conversationId/eval-results",
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
        const conversationId = req.params.conversationId;

        // Verify conversation exists and belongs to workspace/agent
        const conversationPk = `conversations/${workspaceId}/${agentId}/${conversationId}`;
        const conversation = await getRecord(db, conversationPk);
        if (!conversation) {
          throw badRequest("Conversation not found");
        }
        if (conversation.workspaceId !== workspaceId || conversation.agentId !== agentId) {
          throw badRequest("Conversation does not belong to this agent");
        }

        // Query all eval results for this conversation using GSI with queryAsync for memory efficiency
        const items: Array<{
          judgeId: string;
          summary: string;
          scoreGoalCompletion?: number | null;
          scoreToolEfficiency?: number | null;
          scoreFaithfulness?: number | null;
          criticalFailureDetected?: boolean;
          reasoningTrace: string;
          costUsd?: number;
          evaluatedAt: string;
          status?: "completed" | "failed";
          errorMessage?: string;
          errorDetails?: string;
        }> = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for await (const result of (db as any)["agent-eval-result"].queryAsync({
          IndexName: "byConversationId",
          KeyConditionExpression: "conversationId = :conversationId",
          ExpressionAttributeValues: {
            ":conversationId": conversationId,
          },
        })) {
          items.push(result);
        }

        // Get judge names for each result
        const resultsWithJudges = await Promise.all(
          items.map(async (result: {
            judgeId: string;
            summary: string;
            scoreGoalCompletion?: number | null;
            scoreToolEfficiency?: number | null;
            scoreFaithfulness?: number | null;
            criticalFailureDetected?: boolean;
            reasoningTrace: string;
            costUsd?: number;
            evaluatedAt: string;
            status?: "completed" | "failed";
            errorMessage?: string;
            errorDetails?: string;
          }) => {
            const judgePk = `agent-eval-judges/${workspaceId}/${agentId}/${result.judgeId}`;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const judge = await (db as any)["agent-eval-judge"].get(judgePk, "judge");

            return {
              judgeId: result.judgeId,
              judgeName: judge?.name || "Unknown Judge",
              status: result.status ?? "completed",
              summary: result.summary,
              scoreGoalCompletion:
                typeof result.scoreGoalCompletion === "number"
                  ? result.scoreGoalCompletion
                  : null,
              scoreToolEfficiency:
                typeof result.scoreToolEfficiency === "number"
                  ? result.scoreToolEfficiency
                  : null,
              scoreFaithfulness:
                typeof result.scoreFaithfulness === "number"
                  ? result.scoreFaithfulness
                  : null,
              criticalFailureDetected: !!result.criticalFailureDetected,
              reasoningTrace: result.reasoningTrace,
              errorMessage: result.errorMessage,
              errorDetails: result.errorDetails,
              costUsd:
                typeof result.costUsd === "number"
                  ? result.costUsd / 1_000_000_000
                  : null,
              evaluatedAt: result.evaluatedAt,
            };
          })
        );

        res.json(resultsWithJudges);
      } catch (error) {
        handleError(error, next);
      }
    }
  );
};
