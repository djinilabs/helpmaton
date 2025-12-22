import { forbidden, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { deleteDocumentSnippets } from "../../../utils/documentIndexing";
import { deleteDocument } from "../../../utils/s3";
import { Sentry, ensureError } from "../../../utils/sentry";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/documents/{documentId}:
 *   delete:
 *     summary: Delete workspace document
 *     description: Deletes a document from the workspace and S3 storage
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
 *       204:
 *         description: Document deleted successfully
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
export const registerDeleteWorkspaceDocument = (app: express.Application) => {
  app.delete(
    "/api/workspaces/:workspaceId/documents/:documentId",
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

      // Delete document snippets from vector database (async, errors are logged but don't block deletion)
      await deleteDocumentSnippets(workspaceId, documentId).catch((error) => {
        console.error(
          `[Document Delete] Failed to delete snippets for document ${documentId}:`,
          error
        );
        // Report to Sentry (without flushing - flushing is done unconditionally at end of request)
        Sentry.captureException(ensureError(error), {
          tags: {
            operation: "document_indexing",
            action: "delete",
            workspaceId,
            documentId,
          },
          contexts: {
            document: {
              documentId,
              workspaceId,
            },
          },
        });
      });

      // Delete from S3
      await deleteDocument(workspaceId, documentId, document.s3Key);

      // Delete from database
      await db["workspace-document"].delete(documentPk, "document");

      res.status(204).send();
    })
  );
};
