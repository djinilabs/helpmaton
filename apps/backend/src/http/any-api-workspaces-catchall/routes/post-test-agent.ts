import { badRequest } from "@hapi/boom";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import express from "express";

import { PERMISSION_LEVELS } from "../../../tables/schema";
import { trackBusinessEvent } from "../../../utils/tracking";
import { validateBody } from "../../utils/bodyValidation";
import {
  cleanupRequestTimeout,
  createRequestTimeout,
  createTimeoutError,
  isTimeoutError,
} from "../../utils/requestTimeout";
import { testAgentRequestSchema } from "../../utils/schemas/requestSchemas";
import { extractUserId } from "../../utils/session";
import { computeCorsHeaders } from "../../utils/streamCorsHeaders";
import {
  handleStreamingErrorForApiGateway,
  persistConversationError,
} from "../../utils/streamErrorHandling";
import { executeStreamForApiGateway } from "../../utils/streamExecution";
import { performPostProcessing } from "../../utils/streamPostProcessing";
import {
  buildStreamRequestContext,
  type StreamRequestContext,
} from "../../utils/streamRequestContext";
import { createMockResponseStream } from "../../utils/streamResponseStream";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";

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
    asyncHandler(async (req, res) => {
      const { workspaceId, agentId } = req.params;

      if (!workspaceId || !agentId) {
        throw badRequest("workspaceId and agentId are required");
      }

      let requestBodyText: string;
      if (typeof req.body === "string") {
        requestBodyText = req.body;
        let parsed: unknown = null;
        let isJson = false;
        try {
          parsed = JSON.parse(req.body) as unknown;
          isJson = true;
        } catch {
          // If it's not valid JSON, treat as plain text (stream pipeline will handle)
        }
        if (isJson) {
          if (Array.isArray(parsed)) {
            validateBody({ messages: parsed }, testAgentRequestSchema);
          } else {
            validateBody(parsed, testAgentRequestSchema);
          }
        }
      } else if (Array.isArray(req.body)) {
        validateBody({ messages: req.body }, testAgentRequestSchema);
        requestBodyText = JSON.stringify(req.body);
      } else {
        const validatedBody = validateBody(req.body, testAgentRequestSchema);
        requestBodyText = JSON.stringify(validatedBody);
      }

      // Read and validate X-Conversation-Id header
      const conversationId =
        req.headers["x-conversation-id"] || req.headers["X-Conversation-Id"];
      if (!conversationId || typeof conversationId !== "string") {
        throw badRequest("X-Conversation-Id header is required");
      }

      // Extract AWS request ID from headers or from req.apiGateway.event (serverlessExpress attaches it)
      // Priority: headers first, then req.apiGateway.event.requestContext.requestId
      const awsRequestIdRaw =
        req.headers["x-amzn-requestid"] ||
        req.headers["X-Amzn-Requestid"] ||
        req.headers["x-request-id"] ||
        req.headers["X-Request-Id"] ||
        req.apiGateway?.event?.requestContext?.requestId;
      const awsRequestId = Array.isArray(awsRequestIdRaw)
        ? awsRequestIdRaw[0]
        : awsRequestIdRaw;
      if (!awsRequestId || typeof awsRequestId !== "string") {
        console.error("[post-test-agent] AWS request ID missing or invalid:", {
          awsRequestId,
          hasApiGateway: !!req.apiGateway,
          hasEvent: !!req.apiGateway?.event,
          requestIdFromEvent: req.apiGateway?.event?.requestContext?.requestId,
          headers: {
            "x-amzn-requestid": req.headers["x-amzn-requestid"],
            "X-Amzn-Requestid": req.headers["X-Amzn-Requestid"],
            "x-request-id": req.headers["x-request-id"],
            "X-Request-Id": req.headers["X-Request-Id"],
          },
        });
        throw new Error(
          "AWS request ID is required for workspace credit transactions"
        );
      }

      const userId = extractUserId(req);
      const requestTimeout = createRequestTimeout();
      let streamContext: StreamRequestContext | undefined;
      let llmCallAttempted = false;
      const origin =
        typeof req.headers.origin === "string" ? req.headers.origin : undefined;

      try {
        if (!awsRequestId || typeof awsRequestId !== "string") {
          throw new Error("Request ID is missing for test agent streaming");
        }

        const normalizedHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(req.headers)) {
          if (typeof value === "string") {
            normalizedHeaders[key.toLowerCase()] = value;
          } else if (Array.isArray(value) && value[0]) {
            normalizedHeaders[key.toLowerCase()] = value[0];
          }
        }
        const existingConversationId = normalizedHeaders["x-conversation-id"];
        if (existingConversationId && existingConversationId !== conversationId) {
          throw badRequest(
            "x-conversation-id header does not match the extracted conversationId"
          );
        }
        normalizedHeaders["x-conversation-id"] = conversationId;

        const rawQueryString = req.originalUrl?.includes("?")
          ? req.originalUrl.split("?")[1] || ""
          : "";

        const requestEvent: APIGatewayProxyEventV2 = {
          version: "2.0",
          routeKey: `POST /api/workspaces/${workspaceId}/agents/${agentId}/test`,
          rawPath: `/api/workspaces/${workspaceId}/agents/${agentId}/test`,
          rawQueryString,
          headers: normalizedHeaders,
          requestContext: {
            accountId: "local",
            apiId: "local",
            domainName: req.hostname || "localhost",
            domainPrefix: "local",
            http: {
              method: req.method,
              path: req.path,
              protocol: "HTTP/1.1",
              sourceIp: req.ip || "",
              userAgent: normalizedHeaders["user-agent"] || "",
            },
            requestId: awsRequestId,
            routeKey: `POST /api/workspaces/${workspaceId}/agents/${agentId}/test`,
            stage: "local",
            time: new Date().toISOString(),
            timeEpoch: Date.now(),
          },
          body: requestBodyText,
          isBase64Encoded: false,
        };

        streamContext = await buildStreamRequestContext(
          requestEvent,
          {
            workspaceId,
            agentId,
            endpointType: "test",
          },
          {
            authenticated: true,
            ...(userId ? { userId } : {}),
          }
        );

        const { stream, getBody } = createMockResponseStream();
        llmCallAttempted = true;
        const executionResult = await executeStreamForApiGateway(
          streamContext,
          stream,
          requestTimeout.signal
        );

        await performPostProcessing(
          streamContext,
          executionResult.tokenUsage,
          executionResult.streamResult,
          executionResult.generationTimeMs
        );

        trackBusinessEvent(
          "agent",
          "test_executed",
          {
            workspace_id: workspaceId,
            agent_id: agentId,
          },
          req
        );

        cleanupRequestTimeout(requestTimeout);

        const responseHeaders = computeCorsHeaders("test", origin, null);
        for (const [key, value] of Object.entries(responseHeaders)) {
          res.setHeader(key, value);
        }

        res.status(200).send(getBody());
      } catch (error) {
        cleanupRequestTimeout(requestTimeout);

        if (isTimeoutError(error)) {
          const timeoutError = createTimeoutError();
          if (streamContext) {
            await persistConversationError(streamContext, timeoutError);
          }
          const responseHeaders = computeCorsHeaders("test", origin, null);
          for (const [key, value] of Object.entries(responseHeaders)) {
            res.setHeader(key, value);
          }
          res.status(504).json({ error: timeoutError.message });
          return;
        }

        if (streamContext) {
          const responseHeaders = computeCorsHeaders("test", origin, null);
          const errorResponse = await handleStreamingErrorForApiGateway(
            error,
            streamContext,
            responseHeaders,
            llmCallAttempted
          );
          if (errorResponse && typeof errorResponse === "object") {
            for (const [key, value] of Object.entries(responseHeaders)) {
              res.setHeader(key, value);
            }
            const statusCode =
              "statusCode" in errorResponse && typeof errorResponse.statusCode === "number"
                ? errorResponse.statusCode
                : 500;
            const body =
              "body" in errorResponse && typeof errorResponse.body === "string"
                ? errorResponse.body
                : "";
            res.status(statusCode).send(body);
            return;
          }

          await persistConversationError(streamContext, error);
        }

        throw error;
      }
    })
  );
};
