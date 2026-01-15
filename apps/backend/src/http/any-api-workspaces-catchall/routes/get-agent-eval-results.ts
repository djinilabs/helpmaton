import { badRequest } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/eval-results:
 *   get:
 *     summary: Get aggregated evaluation results for an agent
 *     description: Returns aggregated evaluation results for an agent, optionally filtered by time span
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
 *       - name: startDate
 *         in: query
 *         required: false
 *         description: Start date for filtering (ISO 8601)
 *         schema:
 *           type: string
 *           format: date-time
 *       - name: endDate
 *         in: query
 *         required: false
 *         description: End date for filtering (ISO 8601)
 *         schema:
 *           type: string
 *           format: date-time
 *       - name: judgeId
 *         in: query
 *         required: false
 *         description: Filter by specific judge ID
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Aggregated evaluation results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalEvaluations:
 *                   type: integer
 *                 averageScores:
 *                   type: object
 *                   properties:
 *                     goalCompletion:
 *                       type: number
 *                     toolEfficiency:
 *                       type: number
 *                     faithfulness:
 *                       type: number
 *                 criticalFailures:
 *                   type: integer
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetAgentEvalResults = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/agents/:agentId/eval-results",
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
        const startDate = req.query.startDate as string | undefined;
        const endDate = req.query.endDate as string | undefined;
        const judgeId = req.query.judgeId as string | undefined;

        // Verify agent exists and belongs to workspace
        const agentPk = `agents/${workspaceId}/${agentId}`;
        const agent = await db.agent.get(agentPk, "agent");
        if (!agent) {
          throw badRequest("Agent not found");
        }
        if (agent.workspaceId !== workspaceId) {
          throw badRequest("Agent does not belong to this workspace");
        }

        // Query all eval results for this agent using GSI
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const results = await (db as any)["agent-eval-result"].query({
          IndexName: "byAgentId",
          KeyConditionExpression: "agentId = :agentId",
          ExpressionAttributeValues: {
            ":agentId": agentId,
          },
        });

        // Filter by judgeId if provided
        if (judgeId) {
          results.Items = results.Items.filter((r: { judgeId: string }) => r.judgeId === judgeId);
        }

        // Filter by date range if provided
        if (startDate || endDate) {
          const start = startDate ? new Date(startDate).getTime() : 0;
          const end = endDate ? new Date(endDate).getTime() : Date.now();

          results.Items = results.Items.filter((r: { evaluatedAt: string }) => {
            const evaluatedAt = new Date(r.evaluatedAt).getTime();
            return evaluatedAt >= start && evaluatedAt <= end;
          });
        }

        // Calculate aggregates
        const totalEvaluations = results.Items.length;
        let sumGoalCompletion = 0;
        let sumToolEfficiency = 0;
        let sumFaithfulness = 0;
        let criticalFailures = 0;

        for (const result of results.Items as Array<{
          scoreGoalCompletion: number;
          scoreToolEfficiency: number;
          scoreFaithfulness: number;
          criticalFailureDetected: boolean;
        }>) {
          sumGoalCompletion += result.scoreGoalCompletion;
          sumToolEfficiency += result.scoreToolEfficiency;
          sumFaithfulness += result.scoreFaithfulness;
          if (result.criticalFailureDetected) {
            criticalFailures++;
          }
        }

        const averageScores = {
          goalCompletion: totalEvaluations > 0 ? sumGoalCompletion / totalEvaluations : 0,
          toolEfficiency: totalEvaluations > 0 ? sumToolEfficiency / totalEvaluations : 0,
          faithfulness: totalEvaluations > 0 ? sumFaithfulness / totalEvaluations : 0,
        };

        // Get judge names for each result
        const resultsWithJudges = await Promise.all(
          results.Items.map(async (result: {
            conversationId: string;
            judgeId: string;
            summary: string;
            scoreGoalCompletion: number;
            scoreToolEfficiency: number;
            scoreFaithfulness: number;
            criticalFailureDetected: boolean;
            reasoningTrace: string;
            costUsd?: number;
            evaluatedAt: string;
          }) => {
            const judgePk = `agent-eval-judges/${workspaceId}/${agentId}/${result.judgeId}`;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const judge = await (db as any)["agent-eval-judge"].get(judgePk, "judge");

            return {
              conversationId: result.conversationId,
              judgeId: result.judgeId,
              judgeName: judge?.name || "Unknown Judge",
              summary: result.summary,
              scoreGoalCompletion: result.scoreGoalCompletion,
              scoreToolEfficiency: result.scoreToolEfficiency,
              scoreFaithfulness: result.scoreFaithfulness,
              criticalFailureDetected: result.criticalFailureDetected,
              reasoningTrace: result.reasoningTrace,
              costUsd: result.costUsd ? result.costUsd / 1_000_000 : null,
              evaluatedAt: result.evaluatedAt,
            };
          })
        );

        res.json({
          totalEvaluations,
          averageScores,
          criticalFailures,
          results: resultsWithJudges,
        });
      } catch (error) {
        handleError(error, next);
      }
    }
  );
};
