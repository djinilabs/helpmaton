import { badRequest, unauthorized } from "@hapi/boom";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";

import { database } from "../../tables";
import {
  queryUsageStats,
  mergeUsageStats,
} from "../../utils/aggregation";
import { handlingErrors } from "../../utils/handlingErrors";
import { adaptHttpHandler } from "../../utils/httpEventAdapter";
import { initSentry } from "../../utils/sentry";
import { requireSession, userRef } from "../utils/session";

initSentry();

/**
 * @openapi
 * /api/usage:
 *   get:
 *     summary: Get usage statistics
 *     description: Returns aggregated usage statistics across all workspaces the authenticated user has access to
 *     tags:
 *       - Usage
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: currency
 *         in: query
 *         description: Currency for cost calculations
 *         schema:
 *           type: string
 *           enum: [usd, eur, gbp]
 *           default: usd
 *       - name: startDate
 *         in: query
 *         description: Start date for usage statistics (YYYY-MM-DD format)
 *         schema:
 *           type: string
 *           format: date
 *       - name: endDate
 *         in: query
 *         description: End date for usage statistics (YYYY-MM-DD format). Defaults to today.
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Usage statistics
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UsageResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const handler = adaptHttpHandler(
  handlingErrors(
    async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
      try {
        // Authenticate user
        const session = await requireSession(event);
        if (!session.user?.id) {
          throw unauthorized();
        }

        const userId = session.user.id;
        const userRefStr = userRef(userId);

        // Get all workspaces user has access to
        const db = await database();
        const permissionsQuery = await db.permission.query({
          IndexName: "byResourceTypeAndEntityId",
          KeyConditionExpression:
            "resourceType = :resourceType AND sk = :userRef",
          ExpressionAttributeValues: {
            ":resourceType": "workspaces",
            ":userRef": userRefStr,
          },
        });

        const workspaceIds = permissionsQuery.items.map((perm) =>
          perm.pk.replace("workspaces/", "")
        );

        console.log("[GET /api/usage] User workspaces:", {
          userId,
          workspaceCount: workspaceIds.length,
          workspaceIds,
        });

        // Parse query parameters
        const startDateStr = event.queryStringParameters?.startDate;
        const endDateStr = event.queryStringParameters?.endDate;

        const endDate = endDateStr ? new Date(endDateStr) : new Date();
        const startDate = startDateStr
          ? new Date(startDateStr)
          : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000); // Default to last 30 days

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          throw badRequest(
            "Invalid date format. Use ISO 8601 format (YYYY-MM-DD)"
          );
        }

        console.log("[GET /api/usage] Query parameters:", {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        });

        // Aggregate usage from all workspaces
        const allStats = await Promise.all(
          workspaceIds.map((workspaceId) =>
            queryUsageStats(db, {
              workspaceId,
              startDate,
              endDate,
            })
          )
        );

        console.log("[GET /api/usage] Stats from workspaces:", {
          workspaceCount: allStats.length,
          stats: allStats.map((s, i) => ({
            workspaceId: workspaceIds[i],
            inputTokens: s.inputTokens,
            outputTokens: s.outputTokens,
            totalTokens: s.totalTokens,
            costUsd: s.costUsd,
            modelCount: Object.keys(s.byModel).length,
            providerCount: Object.keys(s.byProvider).length,
          })),
        });

        // Merge all stats
        const mergedStats = mergeUsageStats(...allStats);

        console.log("[GET /api/usage] Merged stats:", {
          inputTokens: mergedStats.inputTokens,
          outputTokens: mergedStats.outputTokens,
          totalTokens: mergedStats.totalTokens,
          costUsd: mergedStats.costUsd,
          byModel: Object.keys(mergedStats.byModel),
          byProvider: Object.keys(mergedStats.byProvider),
        });

        // Always use USD
        // Total cost includes token costs, tool costs, reranking costs, and eval costs
        const cost = (mergedStats.costUsd || 0) + (mergedStats.rerankingCostUsd || 0) + (mergedStats.evalCostUsd || 0);

        return {
          statusCode: 200,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userId,
            currency: "usd",
            startDate: startDate.toISOString().split("T")[0],
            endDate: endDate.toISOString().split("T")[0],
            workspaceCount: workspaceIds.length,
            stats: {
              inputTokens: mergedStats.inputTokens,
              outputTokens: mergedStats.outputTokens,
              totalTokens: mergedStats.totalTokens,
              cost,
              rerankingCostUsd: mergedStats.rerankingCostUsd,
              evalCostUsd: mergedStats.evalCostUsd,
              conversationCount: mergedStats.conversationCount,
              messagesIn: mergedStats.messagesIn,
              messagesOut: mergedStats.messagesOut,
              totalMessages: mergedStats.totalMessages,
              byModel: Object.entries(mergedStats.byModel).map(
                ([model, modelStats]) => ({
                  model,
                  inputTokens: modelStats.inputTokens,
                  outputTokens: modelStats.outputTokens,
                  totalTokens: modelStats.totalTokens,
                  cost: modelStats.costUsd,
                })
              ),
              byProvider: Object.entries(mergedStats.byProvider).map(
                ([provider, providerStats]) => ({
                  provider,
                  inputTokens: providerStats.inputTokens,
                  outputTokens: providerStats.outputTokens,
                  totalTokens: providerStats.totalTokens,
                  cost: providerStats.costUsd,
                })
              ),
              byByok: {
                byok: {
                  inputTokens: mergedStats.byByok.byok.inputTokens,
                  outputTokens: mergedStats.byByok.byok.outputTokens,
                  totalTokens: mergedStats.byByok.byok.totalTokens,
                  cost: mergedStats.byByok.byok.costUsd,
                },
                platform: {
                  inputTokens: mergedStats.byByok.platform.inputTokens,
                  outputTokens: mergedStats.byByok.platform.outputTokens,
                  totalTokens: mergedStats.byByok.platform.totalTokens,
                  cost: mergedStats.byByok.platform.costUsd,
                },
              },
            },
          }),
        };
      } catch (error) {
        console.error("[GET /api/usage] Error:", {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        throw error;
      }
    }
  )
);
