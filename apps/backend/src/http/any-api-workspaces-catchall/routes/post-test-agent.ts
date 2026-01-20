import express from "express";

import { PERMISSION_LEVELS } from "../../../tables/schema";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";

import { handlePostTestAgent } from "./post-test-agent-handler";

/**
 * Sets CORS headers for the test agent endpoint
 * Uses FRONTEND_URL as the allowed origin
 */
function setCorsHeaders(
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const frontendUrl = process.env.FRONTEND_URL;

  // Always set Access-Control-Allow-Origin to FRONTEND_URL
  if (frontendUrl) {
    res.setHeader("Access-Control-Allow-Origin", frontendUrl);
  }

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, PATCH, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, Origin, Accept, X-Conversation-Id"
  );
  next();
}

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/test:
 *   post:
 *     summary: Test agent with streaming response
 *     description: Tests an agent by sending messages and receiving a streaming AI response. Handles credit validation, spending limits, and conversation logging.
 *     tags:
 *       - Agents
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - messages
 *             properties:
 *               messages:
 *                 type: array
 *                 description: Array of messages in ai-sdk UIMessage format
 *                 items:
 *                   type: object
 *                   properties:
 *                     role:
 *                       type: string
 *                       enum: [user, assistant, system, tool]
 *                     content:
 *                       type: string
 *     responses:
 *       200:
 *         description: Streaming response (Server-Sent Events format)
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 *               description: SSE stream with UI message chunks
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       402:
 *         description: Insufficient credits
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 workspaceId:
 *                   type: string
 *                 required:
 *                   type: number
 *                 available:
 *                   type: number
 *                 currency:
 *                   type: string
 *       429:
 *         description: Spending limit exceeded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 failedLimits:
 *                   type: array
 *                   items:
 *                     type: object
 *       410:
 *         description: Agent not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPostTestAgent = (app: express.Application) => {
  app.options(
    "/api/workspaces/:workspaceId/agents/:agentId/test",
    setCorsHeaders,
    asyncHandler(async (_req, res) => {
      res.status(200).end();
    })
  );

  app.post(
    "/api/workspaces/:workspaceId/agents/:agentId/test",
    setCorsHeaders,
    requireAuth,
    requirePermission(PERMISSION_LEVELS.READ),
    asyncHandler(async (req, res) => handlePostTestAgent(req, res))
  );
};
