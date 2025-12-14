import { randomUUID } from "crypto";

import { badRequest, unauthorized } from "@hapi/boom";
import express from "express";
import multer from "multer";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import {
  uploadDocument,
  generateUniqueFilename,
  normalizeFolderPath,
} from "../../../utils/s3";
import {
  checkSubscriptionLimits,
  ensureWorkspaceSubscription,
} from "../../../utils/subscriptionUtils";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";
import { calculateDocumentMetrics } from "../utils";

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
});

/**
 * @openapi
 * /api/workspaces/{workspaceId}/documents:
 *   post:
 *     summary: Upload workspace documents
 *     description: Uploads one or more documents (files or text) to a workspace. Supports up to 50 files. Allowed types are md, txt, and markdown.
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
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               files:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: Files to upload (max 10MB each, up to 50 files)
 *               folderPath:
 *                 type: string
 *                 description: Optional folder path
 *               textDocuments:
 *                 type: string
 *                 description: JSON array of text documents with name and content
 *     responses:
 *       201:
 *         description: Documents uploaded successfully
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
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPostWorkspaceDocuments = (app: express.Application) => {
  app.post(
    "/api/workspaces/:workspaceId/documents",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    upload.array("files", 50), // Support up to 50 files
    asyncHandler(async (req, res) => {
      const db = await database();
      const workspaceId = req.params.workspaceId;
      const folderPath = normalizeFolderPath(
        (req.body.folderPath as string) || ""
      );
      const files = req.files as Express.Multer.File[];
      const textDocuments = req.body.textDocuments
        ? JSON.parse(req.body.textDocuments as string)
        : [];

      // Ensure workspace has a subscription and check limits before uploading
      const userRef = req.userRef;
      if (!userRef) {
        throw unauthorized();
      }
      const userId = userRef.replace("users/", "");
      const subscriptionId = await ensureWorkspaceSubscription(
        workspaceId,
        userId
      );

      // Calculate total size and count of documents being uploaded
      const { totalSize, documentCount } = calculateDocumentMetrics(
        files,
        textDocuments
      );

      // Check limits
      await checkSubscriptionLimits(
        subscriptionId,
        "document",
        documentCount,
        totalSize
      );

      const uploadedDocuments = [];

      // Handle file uploads
      if (files && files.length > 0) {
        for (const file of files) {
          const documentId = randomUUID();
          const originalFilename = file.originalname;

          // Validate file type
          const allowedTypes = [
            "text/markdown",
            "text/plain",
            "text/x-markdown",
          ];
          const allowedExtensions = [".md", ".txt", ".markdown"];
          const fileExt = originalFilename
            .substring(originalFilename.lastIndexOf("."))
            .toLowerCase();

          if (
            !allowedTypes.includes(file.mimetype) &&
            !allowedExtensions.includes(fileExt)
          ) {
            throw badRequest(
              `Invalid file type. Allowed: ${allowedExtensions.join(", ")}`
            );
          }

          // Generate unique filename if conflict exists
          const uniqueFilename = await generateUniqueFilename(
            workspaceId,
            originalFilename,
            folderPath
          );

          // Upload to S3
          const s3Key = await uploadDocument(
            workspaceId,
            documentId,
            file.buffer,
            uniqueFilename,
            file.mimetype || "text/plain",
            folderPath
          );

          // Create database record
          const documentPk = `workspace-documents/${workspaceId}/${documentId}`;
          const document = await db["workspace-document"].create({
            pk: documentPk,
            sk: "document",
            workspaceId,
            name: originalFilename, // Use original filename as display name
            filename: uniqueFilename,
            folderPath,
            s3Key,
            contentType: file.mimetype || "text/plain",
            size: file.size,
          });

          uploadedDocuments.push({
            id: documentId,
            name: document.name,
            filename: document.filename,
            folderPath: document.folderPath,
            contentType: document.contentType,
            size: document.size,
            createdAt: document.createdAt,
          });
        }
      }

      // Handle text document uploads
      if (Array.isArray(textDocuments)) {
        for (const textDoc of textDocuments) {
          if (!textDoc.name || !textDoc.content) {
            continue;
          }

          const documentId = randomUUID();
          const originalFilename =
            textDoc.name.endsWith(".md") ||
            textDoc.name.endsWith(".txt") ||
            textDoc.name.endsWith(".markdown")
              ? textDoc.name
              : `${textDoc.name}.md`;

          // Generate unique filename if conflict exists
          const uniqueFilename = await generateUniqueFilename(
            workspaceId,
            originalFilename,
            folderPath
          );

          // Upload to S3
          const s3Key = await uploadDocument(
            workspaceId,
            documentId,
            textDoc.content,
            uniqueFilename,
            "text/markdown",
            folderPath
          );

          // Create database record
          const documentPk = `workspace-documents/${workspaceId}/${documentId}`;
          const document = await db["workspace-document"].create({
            pk: documentPk,
            sk: "document",
            workspaceId,
            name: textDoc.name,
            filename: uniqueFilename,
            folderPath,
            s3Key,
            contentType: "text/markdown",
            size: Buffer.byteLength(textDoc.content, "utf-8"),
          });

          uploadedDocuments.push({
            id: documentId,
            name: document.name,
            filename: document.filename,
            folderPath: document.folderPath,
            contentType: document.contentType,
            size: document.size,
            createdAt: document.createdAt,
          });
        }
      }

      res.status(201).json({ documents: uploadedDocuments });
    })
  );
};
