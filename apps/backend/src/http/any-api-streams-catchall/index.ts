// Refactored streaming handler - simplified and using specialized utilities
import { boomify } from "@hapi/boom";
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Context,
  Callback,
} from "aws-lambda";
import { streamifyResponse } from "lambda-stream";

import {
  adaptHttpHandler,
  transformLambdaUrlToHttpV2Event,
  type LambdaUrlEvent,
  transformRestToHttpV2Event,
} from "../../utils/httpEventAdapter";
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
import {
  computeCorsHeaders,
  handleOptionsRequest,
} from "../utils/streamCorsHeaders";
import {
  detectEndpointType,
  extractPathFromEvent,
} from "../utils/streamEndpointDetection";
import {
  writeErrorResponse,
  persistConversationError,
  handleStreamingErrorForApiGateway,
} from "../utils/streamErrorHandling";
import {
  normalizeEventToHttpV2,
  ensureRequestContextHttp,
  setupWorkspaceCreditContext,
} from "../utils/streamEventNormalization";
import {
  executeStream,
  executeStreamForApiGateway,
} from "../utils/streamExecution";
import { extractStreamPathParameters } from "../utils/streamPathExtraction";
import { performPostProcessing } from "../utils/streamPostProcessing";
import {
  buildStreamRequestContext,
  type StreamRequestContext,
} from "../utils/streamRequestContext";
import {
  createResponseStream,
  createMockResponseStream,
  writeChunkToStream,
  type HttpResponseStream,
} from "../utils/streamResponseStream";

// Declare global awslambda for HttpResponseStream.from() metadata helper
// We still need this for setting headers and status code
declare const awslambda:
  | {
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

  // Get allowed origins for CORS (only for stream endpoint)
  let allowedOrigins: string[] | null = null;
  if (pathParams.endpointType === "stream") {
    allowedOrigins = await getAllowedOrigins(
      pathParams.workspaceId,
      pathParams.agentId
    );
  }

  // Build CORS headers
  const origin = httpV2Event.headers["origin"] || httpV2Event.headers["Origin"];
  const responseHeaders = computeCorsHeaders(
    pathParams.endpointType,
    origin,
    allowedOrigins
  );

  responseStream = createResponseStream(responseStream, responseHeaders);

  try {
    // Handle OPTIONS preflight request
    if (httpV2Event.requestContext.http.method === "OPTIONS") {
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
 * Handles streaming for API Gateway (buffered approach)
 */
async function handleApiGatewayStreaming(
  event: APIGatewayProxyEventV2,
  context: Context
): Promise<APIGatewayProxyResultV2> {
  const pathParams = extractStreamPathParameters(event);
  if (!pathParams) {
    return {
      statusCode: 406,
      body: JSON.stringify({ error: "Invalid path parameters" }),
    };
  }

  // Route URL endpoint to separate handler
  if (pathParams.endpointType === "url") {
    return await handleUrlEndpoint(event);
  }

  // Extract request ID from event or context, or generate one
  // Handle empty string case (transformations may set it to "")
  const eventRequestId = event.requestContext?.requestId;
  const awsRequestId =
    eventRequestId && eventRequestId.trim() !== ""
      ? eventRequestId
      : context.awsRequestId ||
        `gen-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  // Ensure the request ID is set in the event for later use
  // This is critical - buildStreamRequestContext will use this to retrieve the context
  if (!event.requestContext) {
    event.requestContext = {
      accountId: "",
      apiId: "",
      domainName: "",
      domainPrefix: "",
      http: {
        method: "POST",
        path: event.rawPath || "/",
        protocol: "HTTP/1.1",
        sourceIp: "",
        userAgent: "",
      },
      requestId: awsRequestId,
      routeKey: "POST /",
      stage: "$default",
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    };
  } else {
    // Always update the requestId to ensure it matches what we use for context setup
    event.requestContext.requestId = awsRequestId;
  }

  // Setup workspace credit context
  setupWorkspaceCreditContext(awsRequestId, context);

  // Get allowed origins for CORS (only for stream endpoint)
  let allowedOrigins: string[] | null = null;
  if (pathParams.endpointType === "stream") {
    allowedOrigins = await getAllowedOrigins(
      pathParams.workspaceId,
      pathParams.agentId
    );
  }

  // Build CORS headers
  const origin = event.headers["origin"] || event.headers["Origin"];
  const responseHeaders = computeCorsHeaders(
    pathParams.endpointType,
    origin,
    allowedOrigins
  );

  try {
    // Handle OPTIONS preflight request
    if (event.requestContext.http.method === "OPTIONS") {
      return handleOptionsRequest(responseHeaders);
    }

    // Authenticate request
    const authResult = await authenticateStreamRequest(
      pathParams.endpointType,
      event,
      pathParams.workspaceId,
      pathParams.agentId,
      pathParams.secret
    );

    // Build request context
    const streamContext = await buildStreamRequestContext(
      event,
      pathParams,
      authResult
    );

    // Create mock response stream for buffering
    const { stream: mockStream, getBody } = createMockResponseStream();

    // Execute stream
    let executionResult;
    try {
      executionResult = await executeStreamForApiGateway(
        streamContext,
        mockStream
      );
    } catch (error) {
      // Handle streaming errors for API Gateway
      const errorResponse = await handleStreamingErrorForApiGateway(
        error,
        streamContext,
        responseHeaders,
        false // llmCallAttempted - we don't track this in executeStreamForApiGateway
      );
      if (errorResponse) {
        return errorResponse;
      }
      throw error;
    }

    // Post-processing
    await performPostProcessing(
      streamContext,
      executionResult.finalResponseText,
      executionResult.tokenUsage,
      executionResult.streamResult,
      executionResult.generationTimeMs
    );

    // Get buffered body and return
    const body = getBody();

    return {
      statusCode: 200,
      headers: responseHeaders,
      body,
    };
  } catch (error) {
    const boomed = boomify(error as Error);
    console.error("[Stream Handler] Unhandled error (API Gateway):", boomed);
    if (boomed.isServer) {
      Sentry.captureException(ensureError(error), {
        tags: {
          handler: "Stream Handler (API Gateway)",
          statusCode: boomed.output.statusCode,
        },
      });
    }

    return {
      statusCode: boomed.output.statusCode,
      headers: responseHeaders,
      body: JSON.stringify({
        error: boomed.message,
      }),
    };
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
}

/**
 * Dual handler wrapper that supports both Lambda Function URL and API Gateway
 */
const createHandler = () => {
  // Standard handler for API Gateway
  const standardHandler = async (
    event: APIGatewayProxyEvent | APIGatewayProxyEventV2 | LambdaUrlEvent,
    context: Context,
    callback: Callback
  ): Promise<APIGatewayProxyResultV2> => {
    const path = extractPathFromEvent(event);
    const normalizedPath = path.replace(/^\/+/, "/");
    const endpointType = detectEndpointType(normalizedPath);

    // Route URL endpoint to separate handler
    if (endpointType === "url") {
      let httpV2Event: APIGatewayProxyEventV2;
      if ("httpMethod" in event && event.httpMethod !== undefined) {
        httpV2Event = transformRestToHttpV2Event(event as APIGatewayProxyEvent);
      } else if ("rawPath" in event && "requestContext" in event) {
        httpV2Event = transformLambdaUrlToHttpV2Event(event as LambdaUrlEvent);
      } else {
        httpV2Event = event as unknown as APIGatewayProxyEventV2;
      }
      return await handleUrlEndpoint(httpV2Event);
    }

    // For streaming endpoints, use buffered handler
    const bufferedHandler = adaptHttpHandler(handleApiGatewayStreaming);
    return await bufferedHandler(event, context, callback);
  };

  // Always use lambda-stream's streamifyResponse - it provides a polyfill for local/testing
  // In AWS, it uses the real awslambda.streamifyResponse; locally, it buffers the response
  const streamingHandler = streamifyResponse(internalHandler);

  return async (
    event: APIGatewayProxyEvent | APIGatewayProxyEventV2 | LambdaUrlEvent,
    contextOrStream: Context | HttpResponseStream,
    callback?: Callback
  ): Promise<APIGatewayProxyResultV2 | void> => {
    console.log("[Stream Handler] Event:", event);
    const path = extractPathFromEvent(event);
    const normalizedPath = path.replace(/^\/+/, "/");
    const endpointType = detectEndpointType(normalizedPath);
    console.log("[Stream Handler] Endpoint type:", endpointType);

    // URL endpoint always uses non-streaming handler
    if (endpointType === "url") {
      if (
        contextOrStream &&
        typeof contextOrStream === "object" &&
        "write" in contextOrStream &&
        typeof (contextOrStream as HttpResponseStream).write === "function"
      ) {
        // Streaming invocation - write JSON response to stream
        let httpV2Event: APIGatewayProxyEventV2;
        if ("httpMethod" in event && event.httpMethod !== undefined) {
          httpV2Event = transformRestToHttpV2Event(
            event as APIGatewayProxyEvent
          );
        } else if (
          "rawPath" in event &&
          "requestContext" in event &&
          (event as { requestContext?: { http?: unknown } }).requestContext
            ?.http
        ) {
          httpV2Event = transformLambdaUrlToHttpV2Event(
            event as LambdaUrlEvent
          );
        } else {
          httpV2Event = event as unknown as APIGatewayProxyEventV2;
        }

        const result = await handleUrlEndpoint(httpV2Event);
        const apiResult = result as {
          statusCode: number;
          headers?: Record<string, string>;
          body: string;
        };
        let responseStream = contextOrStream as HttpResponseStream;
        // Use awslambda.HttpResponseStream.from if available, otherwise stream is already ready
        if (typeof awslambda !== "undefined" && awslambda) {
          responseStream = awslambda.HttpResponseStream.from(responseStream, {
            statusCode: apiResult.statusCode,
            headers: apiResult.headers || {},
          });
        }
        await writeChunkToStream(responseStream, apiResult.body || "");
        responseStream.end();
        return;
      } else {
        console.log("[Stream Handler] Standard invocation");
        // Standard invocation
        return await standardHandler(
          event,
          contextOrStream as Context,
          callback as Callback
        );
      }
    }

    // For streaming endpoints, check if this is a streaming invocation
    if (
      contextOrStream &&
      typeof contextOrStream === "object" &&
      "write" in contextOrStream &&
      typeof (contextOrStream as HttpResponseStream).write === "function"
    ) {
      console.log("[Stream Handler] Streaming invocation");
      // Streaming invocation (Function URL or lambda-stream polyfill)
      return await streamingHandler(
        event,
        contextOrStream as HttpResponseStream
      );
    } else {
      console.log("[Stream Handler] Standard invocation (API Gateway)");
      // Standard invocation (API Gateway)
      return await standardHandler(
        event,
        contextOrStream as Context,
        callback as Callback
      );
    }
  };
};

/**
 * Streaming Lambda handler for agent interactions
 * Supports both Lambda Function URL (true streaming) and API Gateway (buffered)
 */
export const handler = createHandler();
