import { badRequest } from "@hapi/boom";
import express from "express";

import { PERMISSION_LEVELS } from "../../../tables/schema";
import { searchDocuments } from "../../../utils/documentSearch";
import { trackBusinessEvent } from "../../../utils/tracking";
import { getContextFromRequestId } from "../../../utils/workspaceCreditContext";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/documents/search:
 *   get:
 *     summary: Search workspace documents
 *     description: Search documents in a workspace using semantic vector search. Returns the most relevant document snippets based on the query.
 *     tags:
 *       - Documents
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: workspaceId
 *         in: path
 *         required: true
 *         description: Workspace ID
 *         schema:
 *           type: string
 *       - name: q
 *         in: query
 *         required: true
 *         description: Search query text
 *         schema:
 *           type: string
 *       - name: limit
 *         in: query
 *         description: "Maximum number of results (default: 5)"
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 5
 *     responses:
 *       200:
 *         description: Search results
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   snippet:
 *                     type: string
 *                     description: Document snippet content
 *                   documentName:
 *                     type: string
 *                     description: Name of the document
 *                   documentId:
 *                     type: string
 *                     description: ID of the document
 *                   folderPath:
 *                     type: string
 *                     description: Folder path of the document
 *                   similarity:
 *                     type: number
 *                     description: Similarity score (0-1)
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetWorkspaceDocumentsSearch = (
  app: express.Application
) => {
  app.get(
    "/api/workspaces/:workspaceId/documents/search",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.READ),
    asyncHandler(async (req, res) => {
      const workspaceId = req.params.workspaceId;
      const query = req.query.q as string | undefined;
      const limitParam = req.query.limit as string | undefined;
      const awsRequestIdRaw =
        req.headers["x-amzn-requestid"] ||
        req.headers["X-Amzn-Requestid"] ||
        req.headers["x-request-id"] ||
        req.headers["X-Request-Id"] ||
        req.apiGateway?.event?.requestContext?.requestId;
      const awsRequestId = Array.isArray(awsRequestIdRaw)
        ? awsRequestIdRaw[0]
        : awsRequestIdRaw;
      const context = getContextFromRequestId(awsRequestId);
      if (
        !context ||
        typeof context.addWorkspaceCreditTransaction !== "function"
      ) {
        throw new Error("Context not properly configured for credits.");
      }

      if (!query || query.trim().length === 0) {
        throw badRequest("Query parameter 'q' is required");
      }

      let limit = 5;
      if (limitParam) {
        const parsedLimit = parseInt(limitParam, 10);
        if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
          throw badRequest("Limit parameter must be a number between 1 and 50");
        }
        limit = parsedLimit;
      }

      const results = await searchDocuments(workspaceId, query.trim(), limit, {
        context,
      });

      // Track document search
      trackBusinessEvent(
        "document",
        "search_performed",
        {
          workspace_id: workspaceId,
          query_length: query.trim().length,
          result_count: results.length,
          limit,
        },
        req
      );

      res.json({ results });
    })
  );
};
