import { badRequest, unauthorized } from "@hapi/boom";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";

import { database } from "../../tables";
import {
  queryUsageStats,
  mergeUsageStats,
  type Currency,
} from "../../utils/aggregation";
import { handlingErrors } from "../../utils/handlingErrors";
import { adaptHttpHandler } from "../../utils/httpEventAdapter";
import { requireSession, userRef } from "../utils/session";

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
        const allowedCurrencies: Currency[] = ["usd", "eur", "gbp"];
        const currencyParam =
          event.queryStringParameters?.currency?.toLowerCase();
        const currency: Currency = allowedCurrencies.includes(
          currencyParam as Currency
        )
          ? (currencyParam as Currency)
          : currencyParam === undefined
          ? "usd"
          : (() => {
              throw badRequest(
                "Invalid currency. Allowed values are: usd, eur, gbp."
              );
            })();
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
          currency,
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
            costEur: s.costEur,
            costGbp: s.costGbp,
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
          costEur: mergedStats.costEur,
          costGbp: mergedStats.costGbp,
          byModel: Object.keys(mergedStats.byModel),
          byProvider: Object.keys(mergedStats.byProvider),
        });

        // Select cost based on currency
        const cost =
          currency === "usd"
            ? mergedStats.costUsd
            : currency === "eur"
            ? mergedStats.costEur
            : mergedStats.costGbp;

        return {
          statusCode: 200,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userId,
            currency,
            startDate: startDate.toISOString().split("T")[0],
            endDate: endDate.toISOString().split("T")[0],
            workspaceCount: workspaceIds.length,
            stats: {
              inputTokens: mergedStats.inputTokens,
              outputTokens: mergedStats.outputTokens,
              totalTokens: mergedStats.totalTokens,
              cost,
              byModel: Object.entries(mergedStats.byModel).map(
                ([model, modelStats]) => ({
                  model,
                  inputTokens: modelStats.inputTokens,
                  outputTokens: modelStats.outputTokens,
                  totalTokens: modelStats.totalTokens,
                  cost:
                    currency === "usd"
                      ? modelStats.costUsd
                      : currency === "eur"
                      ? modelStats.costEur
                      : modelStats.costGbp,
                })
              ),
              byProvider: Object.entries(mergedStats.byProvider).map(
                ([provider, providerStats]) => ({
                  provider,
                  inputTokens: providerStats.inputTokens,
                  outputTokens: providerStats.outputTokens,
                  totalTokens: providerStats.totalTokens,
                  cost:
                    currency === "usd"
                      ? providerStats.costUsd
                      : currency === "eur"
                      ? providerStats.costEur
                      : providerStats.costGbp,
                })
              ),
              byByok: {
                byok: {
                  inputTokens: mergedStats.byByok.byok.inputTokens,
                  outputTokens: mergedStats.byByok.byok.outputTokens,
                  totalTokens: mergedStats.byByok.byok.totalTokens,
                  cost:
                    currency === "usd"
                      ? mergedStats.byByok.byok.costUsd
                      : currency === "eur"
                      ? mergedStats.byByok.byok.costEur
                      : mergedStats.byByok.byok.costGbp,
                },
                platform: {
                  inputTokens: mergedStats.byByok.platform.inputTokens,
                  outputTokens: mergedStats.byByok.platform.outputTokens,
                  totalTokens: mergedStats.byByok.platform.totalTokens,
                  cost:
                    currency === "usd"
                      ? mergedStats.byByok.platform.costUsd
                      : currency === "eur"
                      ? mergedStats.byByok.platform.costEur
                      : mergedStats.byByok.platform.costGbp,
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
