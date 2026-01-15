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
import { requireSession, userRef } from "../utils/session";

/**
 * @openapi
 * /api/usage/daily:
 *   get:
 *     summary: Get user daily usage statistics
 *     description: Returns daily breakdown of usage statistics across all workspaces the authenticated user has access to
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
 *           enum: [usd]
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
 *         description: Daily usage statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userId:
 *                   type: string
 *                 currency:
 *                   type: string
 *                 startDate:
 *                   type: string
 *                   format: date
 *                 endDate:
 *                   type: string
 *                   format: date
 *                 daily:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       date:
 *                         type: string
 *                         format: date
 *                       inputTokens:
 *                         type: integer
 *                       outputTokens:
 *                         type: integer
 *                       totalTokens:
 *                         type: integer
 *                       cost:
 *                         type: number
 *                       conversationCount:
 *                         type: integer
 *                       messagesIn:
 *                         type: integer
 *                       messagesOut:
 *                         type: integer
 *                       totalMessages:
 *                         type: integer
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

        console.log("[GET /api/usage/daily] User workspaces:", {
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

        console.log("[GET /api/usage/daily] Query parameters:", {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        });

        // Get daily breakdown
        const current = new Date(startDate);
        const end = new Date(endDate);

        const dailyStats = [];

        while (current <= end) {
          const dateStr = current.toISOString().split("T")[0];
          const dayStart = new Date(current);
          dayStart.setHours(0, 0, 0, 0);
          const dayEnd = new Date(current);
          dayEnd.setHours(23, 59, 59, 999);

          // Query stats for all workspaces for this day
          const allStats = await Promise.all(
            workspaceIds.map((workspaceId) =>
              queryUsageStats(db, {
                workspaceId,
                startDate: dayStart,
                endDate: dayEnd,
              })
            )
          );

          // Merge stats from all workspaces
          const mergedStats = mergeUsageStats(...allStats);

          const cost = mergedStats.costUsd;

          dailyStats.push({
            date: dateStr,
            inputTokens: mergedStats.inputTokens,
            outputTokens: mergedStats.outputTokens,
            totalTokens: mergedStats.totalTokens,
            cost,
            conversationCount: mergedStats.conversationCount,
            messagesIn: mergedStats.messagesIn,
            messagesOut: mergedStats.messagesOut,
            totalMessages: mergedStats.totalMessages,
          });

          current.setDate(current.getDate() + 1);
        }

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
            daily: dailyStats,
          }),
        };
      } catch (error) {
        console.error("[GET /api/usage/daily] Error:", {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        throw error;
      }
    }
  )
);
