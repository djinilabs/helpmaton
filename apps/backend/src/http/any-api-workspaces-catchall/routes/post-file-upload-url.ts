import { badRequest, unauthorized } from "@hapi/boom";
import express from "express";
import { z } from "zod";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { generatePresignedPostUrl } from "../../../utils/s3";
import { validateBody } from "../../utils/bodyValidation";
import {
  asyncHandler,
  handleError,
  requireAuth,
  requirePermission,
} from "../middleware";

/**
 * Sets CORS headers for the file upload URL endpoint
 * Supports cross-origin requests from embedded widgets
 */
function setCorsHeaders(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const frontendUrl = process.env.FRONTEND_URL;
  const origin = req.headers.origin;

  // Allow requests from frontend URL or any origin (for widget support)
  if (frontendUrl && origin === frontendUrl) {
    res.setHeader("Access-Control-Allow-Origin", frontendUrl);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  } else {
    // For widget support, allow all origins
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, Origin, Accept"
  );

  next();
}

/**
 * Schema for file upload URL request body
 * Accepts all file types (not just images)
 */
const fileUploadUrlRequestSchema = z
  .object({
    contentType: z.string().min(1, "contentType is required"),
    fileExtension: z.string().optional(),
  })
  .strict();

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/conversations/{conversationId}/files/upload-url:
 *   post:
 *     summary: Generate presigned S3 POST URL for file upload
 *     description: Generates a presigned POST URL that allows direct upload of files to S3. The URL expires after 5 minutes. Supports all file types.
 *     tags:
 *       - Files
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
 *       - name: conversationId
 *         in: path
 *         required: true
 *         description: Conversation ID
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - contentType
 *             properties:
 *               contentType:
 *                 type: string
 *                 description: File content type (e.g., image/jpeg, application/pdf, text/plain)
 *                 example: image/jpeg
 *               fileExtension:
 *                 type: string
 *                 description: Optional file extension (e.g., "jpg", "pdf", "txt")
 *                 example: jpg
 *     responses:
 *       200:
 *         description: Presigned URL generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 uploadUrl:
 *                   type: string
 *                   description: S3 endpoint URL for POST request
 *                 fields:
 *                   type: object
 *                   description: Form fields to include in multipart/form-data POST
 *                 finalUrl:
 *                   type: string
 *                   description: Final S3 URL after upload (use this in messages)
 *                 expiresIn:
 *                   type: number
 *                   description: URL expiration time in seconds
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 *   options:
 *     summary: CORS preflight for file upload URL endpoint
 *     description: Handles CORS preflight requests
 *     tags:
 *       - Files
 *     responses:
 *       200:
 *         description: CORS headers returned
 */
export const registerPostFileUploadUrl = (app: express.Application) => {
  // Register OPTIONS handler for CORS preflight requests
  app.options(
    "/api/workspaces/:workspaceId/agents/:agentId/conversations/:conversationId/files/upload-url",
    setCorsHeaders,
    asyncHandler(async (req, res) => {
      res.status(200).end();
    })
  );

  app.post(
    "/api/workspaces/:workspaceId/agents/:agentId/conversations/:conversationId/files/upload-url",
    setCorsHeaders, // Handle CORS before auth
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const body = validateBody(req.body, fileUploadUrlRequestSchema);
        const { contentType, fileExtension } = body;

        const workspaceResource = req.workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const currentUserRef = req.userRef;
        if (!currentUserRef) {
          throw unauthorized();
        }

        const workspaceId = req.params.workspaceId;
        const agentId = req.params.agentId;
        const conversationId = req.params.conversationId;

        // Validate workspaceId matches workspaceResource
        // workspaceResource is in format "workspaces/{workspaceId}"
        const expectedResource = `workspaces/${workspaceId}`;
        if (workspaceResource !== expectedResource) {
          throw badRequest("Workspace ID mismatch");
        }

        // Validate agent exists and belongs to workspace
        const db = await database();
        const agentPk = `agents/${workspaceId}/${agentId}`;
        const agent = await db.agent.get(agentPk, "agent");
        if (!agent) {
          throw badRequest("Agent not found");
        }
        if (agent.workspaceId !== workspaceId) {
          throw badRequest("Agent does not belong to this workspace");
        }

        // Generate presigned POST URL
        const presignedData = await generatePresignedPostUrl(
          workspaceId,
          agentId,
          conversationId,
          contentType,
          fileExtension
        );

        // CORS headers are already set by setCorsHeaders middleware
        res.json(presignedData);
      } catch (error) {
        handleError(
          error,
          next,
          "POST /api/workspaces/:workspaceId/agents/:agentId/conversations/:conversationId/files/upload-url"
        );
      }
    }
  );
};
