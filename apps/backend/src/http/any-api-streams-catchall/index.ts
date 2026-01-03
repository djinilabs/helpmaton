// Refactored streaming handler - simplified and using specialized utilities
import { boomify } from "@hapi/boom";
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { ResponseStream, streamifyResponse } from "lambda-stream";

import { type LambdaUrlEvent } from "../../utils/httpEventAdapter";
import { flushPostHog } from "../../utils/posthog";
import {
  initSentry,
  Sentry,
  flushSentry,
  ensureError,
} from "../../utils/sentry";
import { getAllowedOrigins } from "../../utils/streamServerUtils";
import { clearCurrentHTTPContext } from "../../utils/workspaceCreditContext";
import { handleUrlEndpoint } from "../get-api-streams-url";
import { authenticateStreamRequest } from "../utils/streamAuthentication";
import { computeCorsHeaders } from "../utils/streamCorsHeaders";
import {
  detectEndpointType,
  extractPathFromEvent,
} from "../utils/streamEndpointDetection";
import {
  writeErrorResponse,
  persistConversationError,
} from "../utils/streamErrorHandling";
import {
  normalizeEventToHttpV2,
  ensureRequestContextHttp,
  setupWorkspaceCreditContext,
} from "../utils/streamEventNormalization";
import { executeStream } from "../utils/streamExecution";
import { extractStreamPathParameters } from "../utils/streamPathExtraction";
import { performPostProcessing } from "../utils/streamPostProcessing";
import {
  buildStreamRequestContext,
  type StreamRequestContext,
} from "../utils/streamRequestContext";
import {
  createResponseStream,
  writeChunkToStream,
  type HttpResponseStream,
} from "../utils/streamResponseStream";

// Declare global awslambda for Lambda Function URL streaming
// With RESPONSE_STREAM mode, awslambda.streamifyResponse provides the HttpResponseStream directly
declare const awslambda:
  | {
      streamifyResponse: <TEvent, TStream extends HttpResponseStream>(
        handler: (event: TEvent, responseStream: TStream) => Promise<void>
      ) => (event: TEvent, responseStream: TStream) => Promise<void>;
      HttpResponseStream: {
        from(
          underlyingStream: unknown,
          metadata: Record<string, unknown>
        ): HttpResponseStream;
      };
    }
  | undefined;

// Initialize Sentry when this module is loaded (before any handlers are called)
initSentry();

/**
 * Internal handler function that processes the request for Lambda Function URL streaming
 */
const internalHandler = async (
  event: LambdaUrlEvent | APIGatewayProxyEventV2 | APIGatewayProxyEvent,
  responseStream: HttpResponseStream
): Promise<void> => {
  console.log("[Stream Handler] Internal handler called", {
    event,
    responseStream,
  });
  // Normalize event
  const normalizedEvent = normalizeEventToHttpV2(event);
  const pathParams = extractStreamPathParameters(normalizedEvent);

  if (!pathParams) {
    // Use awslambda.HttpResponseStream.from if available, otherwise stream is already ready
    if (typeof awslambda !== "undefined" && awslambda) {
      responseStream = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: 406,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }
    const errorResponse = JSON.stringify({
      error: "Invalid path parameters",
    });
    await writeChunkToStream(responseStream, errorResponse);
    responseStream.end();
    return;
  }

  // URL endpoint should not reach here (handled by wrapper)
  if (pathParams.endpointType === "url") {
    throw new Error(
      "URL endpoint should be handled by the wrapper, not internalHandler"
    );
  }

  let context: StreamRequestContext | undefined;

  // Extract request ID from original event before normalization (as fallback)
  const originalRequestId =
    (event as { requestContext?: { requestId?: string } }).requestContext
      ?.requestId || undefined;

  // Ensure requestContext.http exists
  const httpV2Event = ensureRequestContextHttp(normalizedEvent);
  // Use request ID from normalized event, or fall back to original, or generate one
  const awsRequestId =
    httpV2Event.requestContext.requestId ||
    originalRequestId ||
    `gen-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  // Ensure the request ID is set in the event for later use
  if (!httpV2Event.requestContext.requestId) {
    httpV2Event.requestContext.requestId = awsRequestId;
  }

  // Setup workspace credit context
  setupWorkspaceCreditContext(awsRequestId);

  // CRITICAL FIX: Get allowed origins and set headers IMMEDIATELY before any other async operations
  // Headers must be set before any writes or stream activation in Lambda Function URLs
  // Do all async header-related work first, then set headers on the stream immediately
  const origin = httpV2Event.headers["origin"] || httpV2Event.headers["Origin"];

  // Get allowed origins for CORS (only for stream endpoint)
  let allowedOrigins: string[] | null = null;
  if (pathParams.endpointType === "stream") {
    allowedOrigins = await getAllowedOrigins(
      pathParams.workspaceId,
      pathParams.agentId
    );
  }

  // Build CORS headers
  const responseHeaders = computeCorsHeaders(
    pathParams.endpointType,
    origin,
    allowedOrigins
  );

  console.log("[Stream Handler] Response headers:", responseHeaders);

  // Set headers on the stream IMMEDIATELY - this must happen before any writes
  // In Lambda Function URLs, headers must be set via HttpResponseStream.from() before any data is written
  responseStream = createResponseStream(responseStream, responseHeaders);

  const method = httpV2Event.requestContext.http.method;
  console.log("[Stream Handler] Method:", method);

  try {
    // Handle OPTIONS preflight request
    if (method === "OPTIONS") {
      console.log("[Stream Handler] Handling OPTIONS request");
      await writeChunkToStream(responseStream, "");
      responseStream.end();
      return;
    }

    // Authenticate request
    const authResult = await authenticateStreamRequest(
      pathParams.endpointType,
      httpV2Event,
      pathParams.workspaceId,
      pathParams.agentId,
      pathParams.secret
    );

    // Build request context
    context = await buildStreamRequestContext(
      httpV2Event,
      pathParams,
      authResult
    );

    // Execute stream
    const executionResult = await executeStream(context, responseStream);
    if (!executionResult) {
      // Error was handled in executeStream
      return;
    }

    // Post-processing
    await performPostProcessing(
      context,
      executionResult.finalResponseText,
      executionResult.tokenUsage,
      executionResult.streamResult,
      executionResult.generationTimeMs
    );
  } catch (error) {
    const boomed = boomify(error as Error);
    console.error("[Stream Handler] Unhandled error:", boomed);
    if (boomed.isServer) {
      Sentry.captureException(ensureError(error), {
        tags: {
          handler: "Stream Handler",
          statusCode: boomed.output.statusCode,
        },
      });
    }

    if (context) {
      await persistConversationError(context, error);
    }
    try {
      if (typeof awslambda !== "undefined" && awslambda) {
        responseStream = awslambda.HttpResponseStream.from(responseStream, {
          statusCode: boomed.output?.statusCode || 500,
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
          },
        });
      }
      await writeErrorResponse(responseStream, error);
      responseStream.end();
    } catch (writeError) {
      console.error("[Stream Handler] Failed to write error response:", {
        error:
          writeError instanceof Error ? writeError.message : String(writeError),
      });
      Sentry.captureException(ensureError(writeError), {
        tags: {
          context: "stream-handler",
          operation: "write-error-response",
        },
      });
    }
  } finally {
    if (awsRequestId) {
      clearCurrentHTTPContext(awsRequestId);
    }
    await Promise.all([flushPostHog(), flushSentry()]).catch((flushErrors) => {
      console.error("[PostHog/Sentry] Error flushing events:", flushErrors);
      Sentry.captureException(ensureError(flushErrors), {
        tags: {
          context: "stream-handler",
          operation: "flush-events",
        },
      });
    });
  }
};

/**
 * Dual handler wrapper that supports both Lambda Function URL and API Gateway
 */
const createHandler = () => {
  const streamingHandler = streamifyResponse(internalHandler);

  return async (
    event: APIGatewayProxyEvent | APIGatewayProxyEventV2 | LambdaUrlEvent,
    responseStream: HttpResponseStream
  ): Promise<APIGatewayProxyResultV2 | void> => {
    console.log("[Stream Handler] Event:", event);
    const path = extractPathFromEvent(event);
    const normalizedPath = path.replace(/^\/+/, "/");
    const endpointType = detectEndpointType(normalizedPath);
    console.log("[Stream Handler] Endpoint type:", endpointType);

    const httpV2Event = normalizeEventToHttpV2(event);
    // URL endpoint always uses non-streaming handler
    if (endpointType === "url") {
      console.log("[Stream Handler] URL endpoint");
      return handleUrlEndpoint(httpV2Event);
    } else {
      console.log("[Stream Handler] Standard invocation");
      let mockResponseStream = false;
      if (typeof responseStream.write !== "function") {
        console.log("[Stream Handler] Mocking response stream");
        mockResponseStream = true;
        responseStream = new ResponseStream();
        console.log("[Stream Handler] Mocked response stream:", responseStream);
      }
      // Standard invocation
      await streamingHandler(httpV2Event, responseStream);
      if (mockResponseStream) {
        return {
          statusCode: 200,
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
          },
          body: responseStream.getBufferedData().toString("utf-8"),
        };
      }
    }
  };
};

/**
 * Streaming Lambda handler for agent interactions
 * Supports both Lambda Function URL (true streaming) and API Gateway (buffered)
 */
export const handler = createHandler();
