import { boomify } from "@hapi/boom";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

import {
  InsufficientCreditsError,
  SpendingLimitExceededError,
} from "../../utils/creditErrors";
import { flushPostHog } from "../../utils/posthog";
import { Sentry, flushSentry, ensureError } from "../../utils/sentry";
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

type PathParams = NonNullable<ReturnType<typeof extractStreamPathParameters>>;

const getOriginFromEvent = (event: APIGatewayProxyEventV2): string | undefined =>
  event.headers["origin"] || event.headers["Origin"];

const setStreamStatusIfPossible = (
  responseStream: HttpResponseStream,
  statusCode: number,
  headers: Record<string, string>
): HttpResponseStream => {
  if (
    typeof awslambda !== "undefined" &&
    awslambda &&
    awslambda.HttpResponseStream &&
    typeof awslambda.HttpResponseStream.from === "function"
  ) {
    return awslambda.HttpResponseStream.from(responseStream, {
      statusCode,
      headers,
    });
  }
  return responseStream;
};

const writeInvalidPathResponse = async (params: {
  event: APIGatewayProxyEventV2;
  responseStream: HttpResponseStream;
}): Promise<void> => {
  const { event } = params;
  let { responseStream } = params;
  const path = extractPathFromEvent(event);
  const endpointType = detectEndpointType(path);
  const origin = getOriginFromEvent(event);

  const errorHeaders = mergeCorsHeaders(endpointType, origin, null, {
    "Content-Type": "application/json",
  });

  responseStream = setStreamStatusIfPossible(
    responseStream,
    406,
    errorHeaders
  );

  const errorResponse = JSON.stringify({
    error: "Invalid path parameters",
  });
  await writeChunkToStream(responseStream, errorResponse);
  responseStream.end();
};

export const resolveAwsRequestId = (
  event: APIGatewayProxyEventV2,
  httpV2Event: APIGatewayProxyEventV2
): string => {
  const originalRequestId =
    (event as { requestContext?: { requestId?: string } }).requestContext
      ?.requestId || undefined;

  const awsRequestId =
    httpV2Event.requestContext.requestId ||
    originalRequestId ||
    `gen-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  if (!httpV2Event.requestContext.requestId) {
    httpV2Event.requestContext.requestId = awsRequestId;
  }

  return awsRequestId;
};

const prepareResponseHeaders = async (params: {
  httpV2Event: APIGatewayProxyEventV2;
  pathParams: PathParams;
}): Promise<{
  origin: string | undefined;
  allowedOrigins: string[] | null;
  responseHeaders: Record<string, string>;
}> => {
  const origin = getOriginFromEvent(params.httpV2Event);
  let allowedOrigins: string[] | null = null;
  if (params.pathParams.endpointType === "stream") {
    allowedOrigins = await getAllowedOrigins(
      params.pathParams.workspaceId,
      params.pathParams.agentId
    );
  }

  const responseHeaders = computeCorsHeaders(
    params.pathParams.endpointType,
    origin,
    allowedOrigins
  );

  return { origin, allowedOrigins, responseHeaders };
};

const handleOptionsRequest = async (
  responseStream: HttpResponseStream,
  requestTimeout: ReturnType<typeof createRequestTimeout>
): Promise<void> => {
  console.log("[Stream Handler] Handling OPTIONS request");
  await writeChunkToStream(responseStream, "");
  responseStream.end();
  cleanupRequestTimeout(requestTimeout);
};

const handleTimeoutError = async (params: {
  error: unknown;
  context?: StreamRequestContext;
  responseStream: HttpResponseStream;
  pathParams?: PathParams;
  origin: string | undefined;
  allowedOrigins: string[] | null;
}): Promise<void> => {
  const { error, context } = params;
  let { responseStream } = params;
  const timeoutError = createTimeoutError();
  if (context) {
    await persistConversationError(context, timeoutError);
  }

  const errorHeaders = mergeCorsHeaders(
    params.pathParams?.endpointType || "stream",
    params.origin,
    params.pathParams?.endpointType === "stream" ? params.allowedOrigins : null,
    {
      "Content-Type": "text/event-stream; charset=utf-8",
    }
  );

  responseStream = setStreamStatusIfPossible(
    responseStream,
    504,
    errorHeaders
  );

  await writeErrorResponse(responseStream, timeoutError.message);
  responseStream.end();
  console.warn("[Stream Handler] Timeout error handled:", {
    error: error instanceof Error ? error.message : String(error),
  });
};

const tryHandleCreditError = async (params: {
  error: unknown;
  workspaceId?: string;
  pathParams?: PathParams;
  origin: string | undefined;
  allowedOrigins: string[] | null;
  responseStream: HttpResponseStream;
  context?: StreamRequestContext;
}): Promise<boolean> => {
  const { error, workspaceId } = params;
  if (
    !workspaceId ||
    !(
      error instanceof InsufficientCreditsError ||
      error instanceof SpendingLimitExceededError
    )
  ) {
    return false;
  }

  const creditErrorResult = await handleCreditErrors(
    error,
    workspaceId,
    params.pathParams?.endpointType || "stream"
  );
  if (!creditErrorResult.handled || !creditErrorResult.response) {
    return false;
  }

  const response = creditErrorResult.response;
  if (typeof response !== "object" || response === null || !("body" in response)) {
    return false;
  }

  try {
    const body = JSON.parse((response as { body: string }).body);
    const errorMessage =
      typeof body === "object" && body !== null && "error" in body
        ? (body as { error: string }).error
        : error instanceof Error
        ? error.message
        : String(error);

    if (params.context) {
      await persistConversationError(params.context, error);
    }

    let responseStream = params.responseStream;
    const errorHeaders = mergeCorsHeaders(
      params.pathParams?.endpointType || "stream",
      params.origin,
      params.pathParams?.endpointType === "stream" ? params.allowedOrigins : null,
      {
        "Content-Type": "text/event-stream; charset=utf-8",
      }
    );
    responseStream = setStreamStatusIfPossible(
      responseStream,
      (response as { statusCode?: number }).statusCode || 402,
      errorHeaders
    );

    await writeErrorResponse(responseStream, new Error(errorMessage));
    responseStream.end();
    return true;
  } catch (parseError) {
    console.error(
      "[Stream Handler] Failed to parse credit error response:",
      parseError
    );
  }

  return false;
};

const writeUnhandledErrorResponse = async (params: {
  error: unknown;
  responseStream: HttpResponseStream;
  pathParams?: PathParams;
  origin: string | undefined;
  allowedOrigins: string[] | null;
}): Promise<void> => {
  const { error } = params;
  const boomed = boomify(ensureError(error));
  let responseStream = params.responseStream;

  if (
    typeof awslambda !== "undefined" &&
    awslambda &&
    awslambda.HttpResponseStream &&
    typeof awslambda.HttpResponseStream.from === "function"
  ) {
    const errorHeaders = mergeCorsHeaders(
      params.pathParams?.endpointType || "stream",
      params.origin,
      params.pathParams?.endpointType === "stream" ? params.allowedOrigins : null,
      {
        "Content-Type": "text/event-stream; charset=utf-8",
      }
    );
    responseStream = awslambda.HttpResponseStream.from(responseStream, {
      statusCode: boomed.output?.statusCode || 500,
      headers: errorHeaders,
    });
  }

  try {
    await writeErrorResponse(responseStream, error);
    responseStream.end();
  } catch (writeError) {
    console.error("[Stream Handler] Failed to write error response:", {
      error:
        writeError instanceof Error ? writeError.message : String(writeError),
    });
    if (boomed.isServer) {
      Sentry.captureException(ensureError(writeError), {
        tags: {
          context: "stream-handler",
          operation: "write-error-response",
        },
      });
    }
  }
};

const flushAndClearContext = async (awsRequestId: string | undefined) => {
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
};

/**
 * Internal handler function that processes the request for Lambda Function URL streaming
 */
export const internalHandler = async (
  event: APIGatewayProxyEventV2,
  responseStream: HttpResponseStream
): Promise<void> => {
  console.log("[Stream Handler] Internal handler called", {
    event,
    responseStream,
  });

  const httpV2Event = ensureRequestContextHttp(event);
  const pathParams = extractStreamPathParameters(event);

  if (!pathParams) {
    await writeInvalidPathResponse({ event, responseStream });
    return;
  }

  let context: StreamRequestContext | undefined;
  const awsRequestId = resolveAwsRequestId(event, httpV2Event);
  setupWorkspaceCreditContext(awsRequestId);

  const requestTimeout = createRequestTimeout();
  const headersResult = await prepareResponseHeaders({
    httpV2Event,
    pathParams,
  });
  const origin = headersResult.origin;
  const allowedOrigins = headersResult.allowedOrigins;
  const responseHeaders = headersResult.responseHeaders;

  console.log("[Stream Handler] Response headers:", responseHeaders);
  responseStream = createResponseStream(responseStream, responseHeaders);

  const method = httpV2Event.requestContext.http.method;
  console.log("[Stream Handler] Method:", method);

  try {
    if (method === "OPTIONS") {
      await handleOptionsRequest(responseStream, requestTimeout);
      return;
    }

    const authResult = await authenticateStreamRequest(
      pathParams.endpointType,
      httpV2Event,
      pathParams.workspaceId,
      pathParams.agentId,
      pathParams.secret
    );

    context = await buildStreamRequestContext(
      httpV2Event,
      pathParams,
      authResult
    );

    const executionResult = await executeStream(
      context,
      responseStream,
      requestTimeout.signal
    );
    if (!executionResult) {
      cleanupRequestTimeout(requestTimeout);
      return;
    }

    await performPostProcessing(
      context,
      executionResult.tokenUsage,
      executionResult.streamResult,
      executionResult.generationTimeMs
    );

    trackBusinessEvent(
      "stream_endpoint",
      "called",
      {
        workspace_id: pathParams.workspaceId,
        agent_id: pathParams.agentId,
        endpoint_type: pathParams.endpointType,
        user_id: authResult.userId,
      },
      undefined
    );

    cleanupRequestTimeout(requestTimeout);
  } catch (error) {
    cleanupRequestTimeout(requestTimeout);

    if (isTimeoutError(error)) {
      await handleTimeoutError({
        error,
        context,
        responseStream,
        pathParams,
        origin,
        allowedOrigins,
      });
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

    const workspaceId =
      context?.workspaceId || pathParams?.workspaceId || undefined;
    const handledCreditError = await tryHandleCreditError({
      error,
      workspaceId,
      pathParams,
      origin,
      allowedOrigins,
      responseStream,
      context,
    });
    if (handledCreditError) {
      return;
    }

    if (context) {
      await persistConversationError(context, error);
    }

    await writeUnhandledErrorResponse({
      error,
      responseStream,
      pathParams,
      origin,
      allowedOrigins,
    });
  } finally {
    await flushAndClearContext(awsRequestId);
  }
};
