import { badRequest, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { searchMemory } from "../../../utils/memory/searchMemory";
import type { TemporalGrain } from "../../../utils/vectordb/types";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/memory:
 *   get:
 *     summary: Get agent memory records
 *     description: Returns memory records for a specific agent, with optional semantic search and temporal filtering
 *     tags:
 *       - Agents
 *       - Memory
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
 *       - name: grain
 *         in: query
 *         description: Temporal grain to search (working, daily, weekly, monthly, quarterly, yearly)
 *         schema:
 *           type: string
 *           enum: [working, daily, weekly, monthly, quarterly, yearly]
 *           default: working
 *       - name: queryText
 *         in: query
 *         description: Optional semantic search query. If empty, only temporal filtering is applied.
 *         schema:
 *           type: string
 *       - name: minimumDaysAgo
 *         in: query
 *         description: Minimum age of results in days (default: 0)
 *         schema:
 *           type: integer
 *           default: 0
 *       - name: maximumDaysAgo
 *         in: query
 *         description: Maximum age of results in days (default: 365)
 *         schema:
 *           type: integer
 *           default: 365
 *       - name: maxResults
 *         in: query
 *         description: Maximum number of results to return (default: 50)
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: Agent memory records
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 workspaceId:
 *                   type: string
 *                 agentId:
 *                   type: string
 *                 records:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       content:
 *                         type: string
 *                       date:
 *                         type: string
 *                       timestamp:
 *                         type: string
 *                       metadata:
 *                         type: object
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
export const registerGetAgentMemory = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/agents/:agentId/memory",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.READ),
    asyncHandler(async (req, res) => {
      const db = await database();
      const workspaceId = req.params.workspaceId;
      const agentId = req.params.agentId;

      // Verify agent belongs to workspace
      const agentPk = `agents/${workspaceId}/${agentId}`;
      const agent = await db.agent.get(agentPk, "agent");
      if (!agent) {
        throw resourceGone("Agent not found");
      }

      // Parse query parameters
      const grainStr = (req.query.grain as string) || "working";
      const queryText = req.query.queryText as string | undefined;
      const minimumDaysAgoStr = req.query.minimumDaysAgo as string | undefined;
      const maximumDaysAgoStr = req.query.maximumDaysAgo as string | undefined;
      const maxResultsStr = req.query.maxResults as string | undefined;

      // Validate grain
      const validGrains: TemporalGrain[] = [
        "working",
        "daily",
        "weekly",
        "monthly",
        "quarterly",
        "yearly",
      ];
      if (!validGrains.includes(grainStr as TemporalGrain)) {
        throw badRequest(
          `Invalid grain. Must be one of: ${validGrains.join(", ")}`
        );
      }
      const grain = grainStr as TemporalGrain;

      // Parse numeric parameters
      const minimumDaysAgo = minimumDaysAgoStr
        ? parseInt(minimumDaysAgoStr, 10)
        : 0;
      const maximumDaysAgo = maximumDaysAgoStr
        ? parseInt(maximumDaysAgoStr, 10)
        : 365;
      const maxResults = maxResultsStr ? parseInt(maxResultsStr, 10) : 50;

      // Validate numeric parameters
      if (isNaN(minimumDaysAgo) || isNaN(maximumDaysAgo) || isNaN(maxResults)) {
        throw badRequest(
          "Invalid numeric parameter. minimumDaysAgo, maximumDaysAgo, and maxResults must be valid numbers."
        );
      }

      if (minimumDaysAgo < 0 || maximumDaysAgo < 0 || maxResults < 1) {
        throw badRequest(
          "minimumDaysAgo and maximumDaysAgo must be non-negative, and maxResults must be at least 1."
        );
      }

      if (minimumDaysAgo > maximumDaysAgo) {
        throw badRequest(
          "minimumDaysAgo must be less than or equal to maximumDaysAgo."
        );
      }

      // Search memory
      // If queryText is empty/undefined, searchMemory will skip vector search and only apply temporal filtering
      const records = await searchMemory({
        agentId,
        workspaceId,
        grain,
        minimumDaysAgo,
        maximumDaysAgo,
        maxResults,
        queryText:
          queryText && queryText.trim().length > 0 ? queryText : undefined,
      });

      res.json({
        workspaceId,
        agentId,
        records,
      });
    })
  );
};


