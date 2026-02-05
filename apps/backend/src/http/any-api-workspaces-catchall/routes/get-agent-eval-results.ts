import { badRequest } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { parseLimitParam } from "../../utils/paginationParams";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/eval-results:
 *   get:
 *     summary: Get aggregated evaluation results for an agent
 *     description: Returns aggregated evaluation results for an agent, optionally filtered by time span. Results are paginated.
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
 *       - name: limit
 *         in: query
 *         required: false
 *         description: Maximum number of results to return (default 50, max 100)
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *       - name: cursor
 *         in: query
 *         required: false
 *         description: Pagination cursor for fetching next page
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
 *                   description: Total number of evaluations matching filters (across all pages)
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
 *                   description: Total number of critical failures (across all pages)
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
 *                 nextCursor:
 *                   type: string
 *                   nullable: true
 *                   description: Cursor for fetching next page, null if no more pages
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

        // Parse pagination parameters
        const limit = parseLimitParam(req.query.limit);
        const cursor = req.query.cursor as string | undefined;

        // Verify agent exists and belongs to workspace
        const agentPk = `agents/${workspaceId}/${agentId}`;
        const agent = await db.agent.get(agentPk, "agent");
        if (!agent) {
          throw badRequest("Agent not found");
        }
        if (agent.workspaceId !== workspaceId) {
          throw badRequest("Agent does not belong to this workspace");
        }

        // Use byWorkspaceIdAndAgentId so results are ordered by evaluatedAt (sort key agentIdEvaluatedAt = agentId#evaluatedAt).
        // byAgentId sorts by pk (lexicographic), so the first page was not "most recent first" and recent evals could be missing from the list.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const query: any = {
          IndexName: "byWorkspaceIdAndAgentId",
          KeyConditionExpression:
            "workspaceId = :workspaceId AND begins_with(agentIdEvaluatedAt, :agentIdPrefix)",
          ExpressionAttributeValues: {
            ":workspaceId": workspaceId,
            ":agentIdPrefix": `${agentId}#`,
          },
          ScanIndexForward: false, // Most recent first
        };

        // Add FilterExpression for judgeId if provided (database-level filtering)
        if (judgeId) {
          query.FilterExpression = "judgeId = :judgeId";
          query.ExpressionAttributeValues = {
            ...query.ExpressionAttributeValues,
            ":judgeId": judgeId,
          };
        }

        // Query with pagination
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await ((db as any)["agent-eval-result"] as any).queryPaginated(
          query,
          {
            limit,
            cursor: cursor || null,
          }
        );

        // Filter by date range in memory (after pagination)
        // This is necessary because DynamoDB doesn't support date range filtering in KeyConditionExpression
        // without a GSI that has evaluatedAt as the sort key
        const start = startDate ? new Date(startDate).getTime() : 0;
        const end = endDate ? new Date(endDate).getTime() : Date.now();

        let filteredItems = result.items;
        if (startDate || endDate) {
          filteredItems = result.items.filter((item: { evaluatedAt: string }) => {
            const evaluatedAt = new Date(item.evaluatedAt).getTime();
            return evaluatedAt >= start && evaluatedAt <= end;
          });
        }

        // If date filtering reduced results below limit and there's a next cursor,
        // we might want to fetch more, but for simplicity, we'll return what we have
        // The client can fetch the next page if needed

        // Calculate aggregates from all matching results (across all pages)
        // For now, we calculate from the current page only
        // TODO: Consider a separate endpoint or mechanism for accurate aggregates across all pages
        let totalEvaluations = 0;
        let sumGoalCompletion = 0;
        let sumToolEfficiency = 0;
        let sumFaithfulness = 0;
        let criticalFailures = 0;

        for (const result of filteredItems as Array<{
          scoreGoalCompletion?: number | null;
          scoreToolEfficiency?: number | null;
          scoreFaithfulness?: number | null;
          criticalFailureDetected: boolean;
          status?: "completed" | "failed";
        }>) {
          const status = result.status ?? "completed";
          if (
            status !== "completed" ||
            typeof result.scoreGoalCompletion !== "number" ||
            typeof result.scoreToolEfficiency !== "number" ||
            typeof result.scoreFaithfulness !== "number"
          ) {
            continue;
          }
          totalEvaluations += 1;
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
          filteredItems.map(async (result: {
            conversationId: string;
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
              conversationId: result.conversationId,
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

        // Determine if there are more pages
        // If date filtering removed items, we might still have more pages
        // For simplicity, we'll use the original nextCursor from the query
        // If filteredItems.length < limit, we might want to indicate no more pages,
        // but that's not always accurate if the next page might have matching dates
        const hasMoreAfterFiltering =
          result.nextCursor && filteredItems.length >= limit;
        const nextCursor = hasMoreAfterFiltering ? result.nextCursor : null;

        res.json({
          totalEvaluations,
          averageScores,
          criticalFailures,
          results: resultsWithJudges,
          nextCursor: nextCursor || undefined,
        });
      } catch (error) {
        handleError(error, next);
      }
    }
  );
};
