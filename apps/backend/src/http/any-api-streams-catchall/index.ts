// Refactored streaming handler - simplified and using specialized utilities
import { boomify } from "@hapi/boom";
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { streamifyResponse } from "lambda-stream";

import {
  InsufficientCreditsError,
  SpendingLimitExceededError,
} from "../../utils/creditErrors";
import { type LambdaUrlEvent } from "../../utils/httpEventAdapter";
import { flushPostHog } from "../../utils/posthog";
import {
  initSentry,
  Sentry,
  flushSentry,
  ensureError,
} from "../../utils/sentry";
import { getAllowedOrigins } from "../../utils/streamServerUtils";
import { trackBusinessEvent } from "../../utils/tracking";
import { clearCurrentHTTPContext } from "../../utils/workspaceCreditContext";
import { handleCreditErrors } from "../utils/generationErrorHandling";
import {
  createRequestTimeout,
  cleanupRequestTimeout,
  isTimeoutError,
  createTimeoutError,
} from "../utils/requestTimeout";
import { authenticateStreamRequest } from "../utils/streamAuthentication";
import {
  computeCorsHeaders,
  mergeCorsHeaders,
} from "../utils/streamCorsHeaders";
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
  event: APIGatewayProxyEventV2,
  responseStream: HttpResponseStream
): Promise<void> => {
  console.log("[Stream Handler] Internal handler called", {
    event,
    responseStream,
  });

  // Ensure requestContext.http exists (needed for early error case)
  const httpV2Event = ensureRequestContextHttp(event);

  const pathParams = extractStreamPathParameters(event);

  if (!pathParams) {
    // Compute CORS headers even for invalid path parameters
    // Try to detect endpoint type from path, default to "stream" if detection fails
    const path = extractPathFromEvent(event);
    const endpointType = detectEndpointType(path);
    const origin =
      httpV2Event.headers["origin"] || httpV2Event.headers["Origin"];

    // For invalid path params, use default CORS (allow all origins)
    const errorHeaders = mergeCorsHeaders(
      endpointType,
      origin,
      null, // No allowed origins check for invalid paths
      {
        "Content-Type": "application/json",
      }
    );

    // Use awslambda.HttpResponseStream.from if available, otherwise stream is already ready
    if (
      typeof awslambda !== "undefined" &&
      awslambda.HttpResponseStream &&
      typeof awslambda.HttpResponseStream.from === "function"
    ) {
      responseStream = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: 406,
        headers: errorHeaders,
      });
    }
    const errorResponse = JSON.stringify({
      error: "Invalid path parameters",
    });
    await writeChunkToStream(responseStream, errorResponse);
    responseStream.end();
    return;
  }

  let context: StreamRequestContext | undefined;

  // Extract request ID from original event before normalization (as fallback)
  const originalRequestId =
    (event as { requestContext?: { requestId?: string } }).requestContext
      ?.requestId || undefined;
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

  // Create request timeout (10 minutes)
  const requestTimeout = createRequestTimeout();

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
    const executionResult = await executeStream(
      context,
      responseStream,
      requestTimeout.signal
    );
    if (!executionResult) {
      // Error was handled in executeStream (including timeout after data was written)
      cleanupRequestTimeout(requestTimeout);
      return;
    }

    // Post-processing
    await performPostProcessing(
      context,
      executionResult.finalResponseText,
      executionResult.tokenUsage,
      executionResult.streamResult,
      executionResult.generationTimeMs,
      executionResult.generationStartedAt,
      executionResult.generationEndedAt,
      executionResult.eventTimestamps
    );

    // Track stream endpoint call
    trackBusinessEvent(
      "stream_endpoint",
      "called",
      {
        workspace_id: pathParams.workspaceId,
        agent_id: pathParams.agentId,
        endpoint_type: pathParams.endpointType,
        user_id: authResult.userId,
      },
      undefined // Stream endpoints use secrets, not standard auth
    );

    // Clean up timeout on success
    cleanupRequestTimeout(requestTimeout);
  } catch (error) {
    // Clean up timeout on error
    cleanupRequestTimeout(requestTimeout);

    // Check if this is a timeout error
    // Note: If data has already been written, executeStream handles it internally
    // This catch block only handles timeouts that occur before any data is written
    if (isTimeoutError(error)) {
      const timeoutError = createTimeoutError();
      if (context) {
        await persistConversationError(context, timeoutError);
      }

      const origin =
        httpV2Event.headers["origin"] || httpV2Event.headers["Origin"];
      const errorHeaders = mergeCorsHeaders(
        pathParams?.endpointType || "stream",
        origin,
        pathParams?.endpointType === "stream" ? allowedOrigins : null,
        {
          "Content-Type": "text/event-stream; charset=utf-8",
        }
      );

      // Only set status 504 if no data has been written yet
      // If data was written, executeStream already handled the error
      if (
        typeof awslambda !== "undefined" &&
        awslambda &&
        awslambda.HttpResponseStream &&
        typeof awslambda.HttpResponseStream.from === "function"
      ) {
        responseStream = awslambda.HttpResponseStream.from(responseStream, {
          statusCode: 504,
          headers: errorHeaders,
        });
      }

      await writeErrorResponse(responseStream, timeoutError.message);
      responseStream.end();
      return;
    }
    const boomed = boomify(ensureError(error));
    console.error("[Stream Handler] Unhandled error:", boomed);
    if (boomed.isServer) {
      Sentry.captureException(ensureError(error), {
        tags: {
          handler: "Stream Handler",
          statusCode: boomed.output.statusCode,
        },
      });
    }

    // Handle credit errors before generic error handling
    // Extract workspaceId from pathParams as fallback when context is not available
    const workspaceId =
      context?.workspaceId || pathParams?.workspaceId || undefined;

    if (
      workspaceId &&
      (error instanceof InsufficientCreditsError ||
        error instanceof SpendingLimitExceededError)
    ) {
      const creditErrorResult = await handleCreditErrors(
        error,
        workspaceId,
        pathParams?.endpointType || "stream"
      );
      if (creditErrorResult.handled && creditErrorResult.response) {
        const response = creditErrorResult.response;
        if (
          typeof response === "object" &&
          response !== null &&
          "body" in response
        ) {
          try {
            const body = JSON.parse((response as { body: string }).body);
            const errorMessage =
              typeof body === "object" && body !== null && "error" in body
                ? (body as { error: string }).error
                : error instanceof Error
                ? error.message
                : String(error);

            if (context) {
              await persistConversationError(context, error);
            }

            if (
              typeof awslambda !== "undefined" &&
              awslambda &&
              awslambda.HttpResponseStream &&
              typeof awslambda.HttpResponseStream.from === "function"
            ) {
              // Merge CORS headers with existing headers
              const errorHeaders = mergeCorsHeaders(
                pathParams?.endpointType || "stream",
                origin,
                pathParams?.endpointType === "stream" ? allowedOrigins : null,
                {
                  "Content-Type": "text/event-stream; charset=utf-8",
                }
              );
              responseStream = awslambda.HttpResponseStream.from(
                responseStream,
                {
                  statusCode:
                    (response as { statusCode?: number }).statusCode || 402,
                  headers: errorHeaders,
                }
              );
            }
            await writeErrorResponse(responseStream, new Error(errorMessage));
            responseStream.end();
            return;
          } catch (parseError) {
            console.error(
              "[Stream Handler] Failed to parse credit error response:",
              parseError
            );
            // Fall through to generic error handling
          }
        }
      }
    }

    if (context) {
      await persistConversationError(context, error);
    }
    try {
      if (
        typeof awslambda !== "undefined" &&
        awslambda &&
        awslambda.HttpResponseStream &&
        typeof awslambda.HttpResponseStream.from === "function"
      ) {
        // Merge CORS headers with existing headers
        const errorHeaders = mergeCorsHeaders(
          pathParams?.endpointType || "stream",
          origin,
          pathParams?.endpointType === "stream" ? allowedOrigins : null,
          {
            "Content-Type": "text/event-stream; charset=utf-8",
          }
        );
        responseStream = awslambda.HttpResponseStream.from(responseStream, {
          statusCode: boomed.output?.statusCode || 500,
          headers: errorHeaders,
        });
      }
      await writeErrorResponse(responseStream, error);
      responseStream.end();
    } catch (writeError) {
      console.error("[Stream Handler] Failed to write error response:", {
        error:
          writeError instanceof Error ? writeError.message : String(writeError),
      });
      // Only send to Sentry if the original error was a server error
      if (boomed.isServer) {
        Sentry.captureException(ensureError(writeError), {
          tags: {
            context: "stream-handler",
            operation: "write-error-response",
          },
        });
      }
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
  return streamifyResponse(
    async (
      event: APIGatewayProxyEvent | APIGatewayProxyEventV2 | LambdaUrlEvent,
      responseStream: HttpResponseStream
    ): Promise<APIGatewayProxyResultV2 | void> => {
      console.log("[Stream Handler] Handler called", { event, responseStream });
      const httpV2Event = normalizeEventToHttpV2(event);
      console.log("[Stream Handler] Standard invocation");
      // Standard invocation
      await internalHandler(httpV2Event, responseStream);
    }
  );
};

/**
 * Streaming Lambda handler for agent interactions
 * Supports both Lambda Function URL (true streaming) and API Gateway (buffered)
 */
export const handler = createHandler();
