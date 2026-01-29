import { badRequest, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { createGraphDb } from "../../../utils/duckdb/graphDb";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";

const DEFAULT_MAX_RESULTS = 200;
const MAX_ALLOWED_RESULTS = 500;

function escapeSqlLike(input: string): string {
  return input
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/'/g, "''");
}

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/knowledge-graph:
 *   get:
 *     summary: Get agent knowledge graph facts
 *     description: Returns knowledge graph facts for an agent with optional text filtering
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
 *       - name: queryText
 *         in: query
 *         description: Optional text filter for graph facts
 *         schema:
 *           type: string
 *       - name: maxResults
 *         in: query
 *         description: "Maximum number of facts to return (default: 200, max: 500)"
 *         schema:
 *           type: integer
 *           default: 200
 *     responses:
 *       200:
 *         description: Agent knowledge graph facts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 workspaceId:
 *                   type: string
 *                 agentId:
 *                   type: string
 *                 facts:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       source_id:
 *                         type: string
 *                       target_id:
 *                         type: string
 *                       label:
 *                         type: string
 *                       properties:
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
export const registerGetAgentKnowledgeGraph = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/agents/:agentId/knowledge-graph",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.READ),
    asyncHandler(async (req, res) => {
      const db = await database();
      const workspaceId = req.params.workspaceId;
      const agentId = req.params.agentId;

      const agentPk = `agents/${workspaceId}/${agentId}`;
      const agent = await db.agent.get(agentPk, "agent");
      if (!agent) {
        throw resourceGone("Agent not found");
      }

      const queryText = req.query.queryText as string | undefined;
      const maxResultsStr = req.query.maxResults as string | undefined;
      const maxResultsRaw = maxResultsStr
        ? parseInt(maxResultsStr, 10)
        : DEFAULT_MAX_RESULTS;

      if (isNaN(maxResultsRaw)) {
        throw badRequest("maxResults must be a valid number.");
      }
      if (maxResultsRaw < 1 || maxResultsRaw > MAX_ALLOWED_RESULTS) {
        throw badRequest(
          `maxResults must be between 1 and ${MAX_ALLOWED_RESULTS}.`,
        );
      }

      const maxResults = maxResultsRaw;
      const graphDb = await createGraphDb(workspaceId, agentId);
      try {
        let whereClause = "";
        if (queryText && queryText.trim().length > 0) {
          const escaped = escapeSqlLike(queryText.trim().toLowerCase());
          const pattern = `%${escaped}%`;
          whereClause = `
            WHERE lower(source_id) LIKE '${pattern}' ESCAPE '\\'
               OR lower(target_id) LIKE '${pattern}' ESCAPE '\\'
               OR lower(label) LIKE '${pattern}' ESCAPE '\\'
          `;
        }

        const facts = await graphDb.queryGraph<{
          id: string;
          source_id: string;
          target_id: string;
          label: string;
          properties?: Record<string, unknown> | null;
        }>(`
          SELECT id, source_id, target_id, label, properties
          FROM facts
          ${whereClause}
          ORDER BY id
          LIMIT ${maxResults};
        `);

        res.json({
          workspaceId,
          agentId,
          facts,
        });
      } finally {
        await graphDb.close();
      }
    }),
  );
};
