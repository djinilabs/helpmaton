import { badRequest } from "@hapi/boom";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type express from "express";

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

const requireParams = (req: express.Request) => {
  const { workspaceId, agentId } = req.params;
  if (!workspaceId || !agentId) {
    throw badRequest("workspaceId and agentId are required");
  }
  return { workspaceId, agentId };
};

const resolveRequestBody = (req: express.Request): string => {
  if (typeof req.body === "string") {
    const requestBodyText = req.body;
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
    return requestBodyText;
  }

  if (Array.isArray(req.body)) {
    validateBody({ messages: req.body }, testAgentRequestSchema);
    return JSON.stringify(req.body);
  }

  const validatedBody = validateBody(req.body, testAgentRequestSchema);
  return JSON.stringify(validatedBody);
};

const requireConversationId = (req: express.Request): string => {
  const conversationId =
    req.headers["x-conversation-id"] || req.headers["X-Conversation-Id"];
  if (!conversationId || typeof conversationId !== "string") {
    throw badRequest("X-Conversation-Id header is required");
  }
  return conversationId;
};

const resolveAwsRequestId = (req: express.Request): string => {
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
  return awsRequestId;
};

const buildNormalizedHeaders = (
  req: express.Request,
  conversationId: string
): Record<string, string> => {
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
  return normalizedHeaders;
};

const buildRequestEvent = (params: {
  workspaceId: string;
  agentId: string;
  awsRequestId: string;
  requestBodyText: string;
  normalizedHeaders: Record<string, string>;
  rawQueryString: string;
  req: express.Request;
}): APIGatewayProxyEventV2 => ({
  version: "2.0",
  routeKey: `POST /api/workspaces/${params.workspaceId}/agents/${params.agentId}/test`,
  rawPath: `/api/workspaces/${params.workspaceId}/agents/${params.agentId}/test`,
  rawQueryString: params.rawQueryString,
  headers: params.normalizedHeaders,
  requestContext: {
    accountId: "local",
    apiId: "local",
    domainName: params.req.hostname || "localhost",
    domainPrefix: "local",
    http: {
      method: params.req.method,
      path: params.req.path,
      protocol: "HTTP/1.1",
      sourceIp: params.req.ip || "",
      userAgent: params.normalizedHeaders["user-agent"] || "",
    },
    requestId: params.awsRequestId,
    routeKey: `POST /api/workspaces/${params.workspaceId}/agents/${params.agentId}/test`,
    stage: "local",
    time: new Date().toISOString(),
    timeEpoch: Date.now(),
  },
  body: params.requestBodyText,
  isBase64Encoded: false,
});

const applyCorsHeaders = (
  res: express.Response,
  origin: string | undefined
) => {
  const responseHeaders = computeCorsHeaders("test", origin, null);
  for (const [key, value] of Object.entries(responseHeaders)) {
    res.setHeader(key, value);
  }
};

const handleTimeoutError = async (params: {
  res: express.Response;
  origin: string | undefined;
  streamContext?: StreamRequestContext;
}) => {
  const timeoutError = createTimeoutError();
  if (params.streamContext) {
    await persistConversationError(params.streamContext, timeoutError);
  }
  applyCorsHeaders(params.res, params.origin);
  params.res.status(504).json({ error: timeoutError.message });
};

const handleStreamingError = async (params: {
  res: express.Response;
  origin: string | undefined;
  error: unknown;
  streamContext: StreamRequestContext;
  llmCallAttempted: boolean;
}) => {
  const responseHeaders = computeCorsHeaders("test", params.origin, null);
  const errorResponse = await handleStreamingErrorForApiGateway(
    params.error,
    params.streamContext,
    responseHeaders,
    params.llmCallAttempted
  );
  if (errorResponse && typeof errorResponse === "object") {
    for (const [key, value] of Object.entries(responseHeaders)) {
      params.res.setHeader(key, value);
    }
    const statusCode =
      "statusCode" in errorResponse &&
      typeof errorResponse.statusCode === "number"
        ? errorResponse.statusCode
        : 500;
    const body =
      "body" in errorResponse && typeof errorResponse.body === "string"
        ? errorResponse.body
        : "";
    params.res.status(statusCode).send(body);
    return true;
  }

  await persistConversationError(params.streamContext, params.error);
  return false;
};

export const handlePostTestAgent = async (
  req: express.Request,
  res: express.Response
): Promise<void> => {
  const { workspaceId, agentId } = requireParams(req);
  const requestBodyText = resolveRequestBody(req);
  const conversationId = requireConversationId(req);
  const awsRequestId = resolveAwsRequestId(req);
  const userId = extractUserId(req);
  const requestTimeout = createRequestTimeout();
  let streamContext: StreamRequestContext | undefined;
  let llmCallAttempted = false;
  const origin =
    typeof req.headers.origin === "string" ? req.headers.origin : undefined;

  try {
    const normalizedHeaders = buildNormalizedHeaders(req, conversationId);
    const rawQueryString = req.originalUrl?.includes("?")
      ? req.originalUrl.split("?")[1] || ""
      : "";

    const requestEvent = buildRequestEvent({
      workspaceId,
      agentId,
      awsRequestId,
      requestBodyText,
      normalizedHeaders,
      rawQueryString,
      req,
    });

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
    applyCorsHeaders(res, origin);
    res.status(200).send(getBody());
  } catch (error) {
    cleanupRequestTimeout(requestTimeout);

    if (isTimeoutError(error)) {
      await handleTimeoutError({ res, origin, streamContext });
      return;
    }

    if (streamContext) {
      const handled = await handleStreamingError({
        res,
        origin,
        error,
        streamContext,
        llmCallAttempted,
      });
      if (handled) {
        return;
      }
    }

    throw error;
  }
};
