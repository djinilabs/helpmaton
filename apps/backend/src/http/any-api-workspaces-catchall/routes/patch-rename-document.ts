import { forbidden, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { renameDocument, generateUniqueFilename } from "../../../utils/s3";
import { trackBusinessEvent } from "../../../utils/tracking";
import { validateBody } from "../../utils/bodyValidation";
import { renameDocumentSchema } from "../../utils/schemas/workspaceSchemas";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/documents/{documentId}/rename:
 *   patch:
 *     summary: Rename workspace document
 *     description: Renames a document (updates filename in S3)
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 description: New document name
 *     responses:
 *       200:
 *         description: Document renamed successfully
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
export const registerPatchRenameDocument = (app: express.Application) => {
  app.patch(
    "/api/workspaces/:workspaceId/documents/:documentId/rename",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
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

      const body = validateBody(req.body, renameDocumentSchema);
      const newName = body.name;

      // Use name as new filename (with extension from original if not present)
      const originalExt = document.filename.substring(
        document.filename.lastIndexOf(".")
      );
      const nameWithExt = newName.includes(".")
        ? newName
        : `${newName}${originalExt}`;

      // Check for conflicts in current folder
      const uniqueFilename = await generateUniqueFilename(
        workspaceId,
        nameWithExt,
        document.folderPath
      );

      // Rename file in S3
      const newS3Key = await renameDocument(
        workspaceId,
        document.s3Key,
        uniqueFilename,
        document.folderPath
      );

      // Update database record
      const updated = await db["workspace-document"].update(
        {
          ...document,
          name: newName,
          filename: uniqueFilename,
          s3Key: newS3Key,
          updatedAt: new Date().toISOString(),
        },
        null
      );

      // Track document rename
      trackBusinessEvent(
        "document",
        "renamed",
        {
          workspace_id: workspaceId,
          document_id: documentId,
        },
        req
      );

      res.json({
        id: documentId,
        name: updated.name,
        filename: updated.filename,
        folderPath: updated.folderPath,
        contentType: updated.contentType,
        size: updated.size,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      });
    })
  );
};
