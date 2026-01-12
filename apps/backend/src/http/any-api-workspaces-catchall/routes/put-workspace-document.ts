import { forbidden, resourceGone } from "@hapi/boom";
import express from "express";
import multer from "multer";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { updateDocument } from "../../../utils/documentIndexing";
import {
  getDocument,
  generateUniqueFilename,
  normalizeFolderPath,
  renameDocument,
  uploadDocument,
} from "../../../utils/s3";
import { Sentry, ensureError } from "../../../utils/sentry";
import { validateBody } from "../../utils/bodyValidation";
import { updateDocumentSchema } from "../../utils/schemas/workspaceSchemas";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
});

/**
 * @openapi
 * /api/workspaces/{workspaceId}/documents/{documentId}:
 *   put:
 *     summary: Update workspace document
 *     description: Updates document content, name, or folder location. Supports both JSON content and file uploads.
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
 *       required: false
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: File to upload (max 10MB)
 *               name:
 *                 type: string
 *                 description: New document name
 *               folderPath:
 *                 type: string
 *                 description: New folder path
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               content:
 *                 type: string
 *                 description: New document content (text)
 *               name:
 *                 type: string
 *                 description: New document name
 *               folderPath:
 *                 type: string
 *                 description: New folder path
 *     responses:
 *       200:
 *         description: Document updated successfully
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
export const registerPutWorkspaceDocument = (app: express.Application) => {
  app.put(
    "/api/workspaces/:workspaceId/documents/:documentId",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    upload.single("file"),
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

      let newS3Key = document.s3Key;
      let newFilename = document.filename;
      let newFolderPath = document.folderPath;
      let newContent: Buffer | string | undefined;
      let newSize = document.size;
      let newContentType = document.contentType;
      let newName = document.name;

      // Validate JSON fields in req.body (multipart/form-data may have file fields)
      // Extract only the JSON fields we care about for validation
      const jsonFields: { name?: string; content?: string; folderPath?: string } = {};
      if (req.body.name !== undefined) jsonFields.name = req.body.name as string;
      if (req.body.content !== undefined) jsonFields.content = req.body.content as string;
      if (req.body.folderPath !== undefined) jsonFields.folderPath = req.body.folderPath as string;
      
      // Validate JSON fields if any are present
      if (Object.keys(jsonFields).length > 0) {
        const validated = validateBody(jsonFields, updateDocumentSchema);
        if (validated.name !== undefined) newName = validated.name;
        if (validated.content !== undefined) {
          newContent = validated.content;
          newSize = Buffer.byteLength(newContent, "utf-8");
        }
        if (validated.folderPath !== undefined) {
          newFolderPath = normalizeFolderPath(validated.folderPath);
        }
      }

      // Handle file upload (takes precedence over content if both are provided)
      if (req.file) {
        newContent = req.file.buffer;
        newSize = req.file.size;
        newContentType = req.file.mimetype || "text/plain";
      }

      // Handle name update (already validated above)
      if (newName !== document.name) {
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
          newFolderPath
        );

        newFilename = uniqueFilename;
        newS3Key = await renameDocument(
          workspaceId,
          document.s3Key,
          uniqueFilename,
          newFolderPath
        );
      }

      // Handle folder move (already validated and set above)
      if (newFolderPath !== document.folderPath) {
        // Move file in S3
        newS3Key = await renameDocument(
          workspaceId,
          document.s3Key,
          newFilename,
          newFolderPath
        );
      }

      // Update content in S3 if provided
      if (newContent !== undefined) {
        newS3Key = await uploadDocument(
          workspaceId,
          documentId,
          newContent,
          newFilename,
          newContentType,
          newFolderPath
        );
      }

      // Update database record
      const updated = await db["workspace-document"].update(
        {
          ...document,
          name: newName,
          filename: newFilename,
          folderPath: newFolderPath,
          s3Key: newS3Key,
          contentType: newContentType,
          size: newSize,
          updatedAt: new Date().toISOString(),
        },
        null
      );

      // Re-index document if content, name, or folder changed
      // (async, errors are logged but don't block update)
      const contentChanged = newContent !== undefined;
      const metadataChanged =
        newName !== document.name || newFolderPath !== document.folderPath;

      if (contentChanged || metadataChanged) {
        // Get document content for indexing
        let contentToIndex: string;
        if (newContent !== undefined) {
          contentToIndex =
            typeof newContent === "string"
              ? newContent
              : newContent.toString("utf-8");
        } else {
          // Fetch from S3 if content wasn't updated
          try {
            const contentBuffer = await getDocument(
              workspaceId,
              documentId,
              newS3Key
            );
            contentToIndex = contentBuffer.toString("utf-8");
          } catch (error) {
            console.error(
              `[Document Update] Failed to fetch document content for indexing:`,
              error
            );
            contentToIndex = ""; // Will result in no snippets, but won't fail
          }
        }

        // Always call updateDocument to delete old snippets, even if content is empty
        // This ensures stale snippets are removed when content is cleared or S3 fetch fails
        await updateDocument(workspaceId, documentId, contentToIndex, {
          documentName: updated.name,
          folderPath: updated.folderPath,
        }).catch((error) => {
          console.error(
            `[Document Update] Failed to re-index document ${documentId}:`,
            error
          );
          // Report to Sentry (without flushing - flushing is done unconditionally at end of request)
          Sentry.captureException(ensureError(error), {
            tags: {
              operation: "document_indexing",
              action: "update",
              workspaceId,
              documentId,
            },
            contexts: {
              document: {
                documentId,
                documentName: updated.name,
                folderPath: updated.folderPath,
                workspaceId,
                contentChanged,
                metadataChanged,
              },
            },
          });
        });
      }

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
