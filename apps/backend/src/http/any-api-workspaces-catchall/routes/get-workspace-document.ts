import { forbidden, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { getDocument } from "../../../utils/s3";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/documents/{documentId}:
 *   get:
 *     summary: Get workspace document
 *     description: Returns document content and metadata
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
 *       - name: documentId
 *         in: path
 *         required: true
 *         description: Document ID
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Document content and metadata
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 name:
 *                   type: string
 *                 filename:
 *                   type: string
 *                 folderPath:
 *                   type: string
 *                 contentType:
 *                   type: string
 *                 size:
 *                   type: integer
 *                 content:
 *                   type: string
 *                   description: Document content as text
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *                 updatedAt:
 *                   type: string
 *                   format: date-time
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       410:
 *         description: Document not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetWorkspaceDocument = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/documents/:documentId",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.READ),
    asyncHandler(async (req, res) => {
      const db = await database();
      const workspaceId = req.params.workspaceId;
      const documentId = req.params.documentId;
      const documentPk = `workspace-documents/${workspaceId}/${documentId}`;

      const document = await db["workspace-document"].get(
        documentPk,
        "document"
      );
      if (!document) {
        throw resourceGone("Document not found");
      }

      if (document.workspaceId !== workspaceId) {
        throw forbidden("Document does not belong to this workspace");
      }

      // Get content from S3
      const content = await getDocument(
        workspaceId,
        documentId,
        document.s3Key
      );
      const contentText = content.toString("utf-8");

      res.json({
        id: documentId,
        name: document.name,
        filename: document.filename,
        folderPath: document.folderPath,
        contentType: document.contentType,
        size: document.size,
        content: contentText,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
      });
    })
  );
};
