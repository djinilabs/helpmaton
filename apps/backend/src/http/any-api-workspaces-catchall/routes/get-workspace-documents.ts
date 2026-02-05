import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { normalizeFolderPath } from "../../../utils/s3";
import { parseLimitParam } from "../../utils/paginationParams";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/documents:
 *   get:
 *     summary: List workspace documents
 *     description: Returns all documents in a workspace, optionally filtered by folder
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
 *       - name: folder
 *         in: query
 *         description: Optional folder path to filter documents
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of documents
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 documents:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       filename:
 *                         type: string
 *                       folderPath:
 *                         type: string
 *                       contentType:
 *                         type: string
 *                       size:
 *                         type: integer
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                       updatedAt:
 *                         type: string
 *                         format: date-time
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetWorkspaceDocuments = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/documents",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.READ),
    asyncHandler(async (req, res) => {
      const db = await database();
      const workspaceId = req.params.workspaceId;
      const folderPath = req.query.folder as string | undefined;
      const limit = parseLimitParam(req.query.limit);
      const cursor = req.query.cursor as string | undefined;

      const query: Parameters<
        (typeof db)["workspace-document"]["queryPaginated"]
      >[0] = {
        IndexName: "byWorkspaceId",
        KeyConditionExpression: "workspaceId = :workspaceId",
        ExpressionAttributeValues: {
          ":workspaceId": workspaceId,
        },
      };

      const result = await db["workspace-document"].queryPaginated(query, {
        limit,
        cursor: cursor ?? null,
      });

      let filteredDocuments = result.items;
      if (folderPath !== undefined) {
        const normalizedPath = normalizeFolderPath(folderPath || "");
        filteredDocuments = result.items.filter(
          (doc) => doc.folderPath === normalizedPath
        );
      }

      const documentsList = filteredDocuments.map((doc) => ({
        id: doc.pk.replace(`workspace-documents/${workspaceId}/`, ""),
        name: doc.name,
        filename: doc.filename,
        folderPath: doc.folderPath,
        contentType: doc.contentType,
        size: doc.size,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      }));

      res.json({
        documents: documentsList,
        nextCursor: result.nextCursor ?? undefined,
      });
    })
  );
};
