import { boomify } from "@hapi/boom";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";

import { database } from "../../tables";
import {
  InsufficientCreditsError,
  SpendingLimitExceededError,
} from "../../utils/creditErrors";
import { flushPostHog } from "../../utils/posthog";
import { Sentry, ensureError, flushSentry } from "../../utils/sentry";
import { trackBusinessEvent } from "../../utils/tracking";
import { clearCurrentHTTPContext } from "../../utils/workspaceCreditContext";
import { handleCreditErrors } from "../utils/generationErrorHandling";
import {
  createRequestTimeout,
  cleanupRequestTimeout,
  isTimeoutError,
  createTimeoutError,
} from "../utils/requestTimeout";
import { validateWidgetKey } from "../utils/requestValidation";
import {
  computeCorsHeaders,
  mergeCorsHeaders,
} from "../utils/streamCorsHeaders";
import {
  writeErrorResponse,
  persistConversationError,
} from "../utils/streamErrorHandling";
import {
  setupWorkspaceCreditContext,
  ensureRequestContextHttp,
} from "../utils/streamEventNormalization";
import { executeStream } from "../utils/streamExecution";
import {
  buildStreamRequestContext,
  type StreamRequestContext,
} from "../utils/streamRequestContext";
import {
  createResponseStream,
  writeChunkToStream,
  type HttpResponseStream,
} from "../utils/streamResponseStream";

type WidgetPathParams = {
  workspaceId?: string;
  agentId?: string;
  key?: string;
};

const getOrigin = (event: APIGatewayProxyEventV2) =>
  event.headers["origin"] || event.headers["Origin"];

/**
 * Extracts widget path parameters from rawPath when pathParameters is not available
 * Pattern: /api/widget/:workspaceId/:agentId/:key
 */
const extractWidgetPathParametersFromRawPath = (
  rawPath: string
): WidgetPathParams => {
  if (!rawPath) {
    return {};
  }

  const pathWithoutQuery = rawPath.split("?")[0];
  const match = pathWithoutQuery.match(
    /^\/api\/widget\/([^/]+)\/([^/]+)\/([^/]+)\/?$/
  );
  if (match) {
    return {
      workspaceId: match[1],
      agentId: match[2],
      key: match[3],
    };
  }
  return {};
};

const resolvePathParams = (event: APIGatewayProxyEventV2): WidgetPathParams => {
  let workspaceId = event.pathParameters?.workspaceId;
  let agentId = event.pathParameters?.agentId;
  let key = event.pathParameters?.key;

  if (!workspaceId || !agentId || !key) {
    const possiblePaths = [
      event.rawPath,
      event.requestContext?.http?.path,
      event.routeKey?.split(" ")[1],
    ].filter(Boolean) as string[];

    console.log(
      "[Widget Handler] Path parameters missing, attempting extraction:",
      {
        pathParameters: event.pathParameters,
        possiblePaths,
        fullEvent: JSON.stringify(event, null, 2),
      }
    );

    for (const path of possiblePaths) {
      const extracted = extractWidgetPathParametersFromRawPath(path);
      if (extracted.workspaceId && extracted.agentId && extracted.key) {
        workspaceId = extracted.workspaceId;
        agentId = extracted.agentId;
        key = extracted.key;
        console.log(
          "[Widget Handler] Successfully extracted from path:",
          path,
          {
            workspaceId,
            agentId,
            key,
          }
        );
        break;
      }
    }
  }

  return { workspaceId, agentId, key };
};

const writeJsonErrorResponse = async (
  responseStream: HttpResponseStream,
  statusCode: number,
  origin: string | undefined,
  allowedOrigins: string[] | null,
  errorMessage: string
): Promise<void> => {
  const errorHeaders = mergeCorsHeaders("stream", origin, allowedOrigins, {
    "Content-Type": "application/json",
  });
  const response = createResponseStream(responseStream, errorHeaders, statusCode);
  await writeChunkToStream(
    response,
    JSON.stringify({
      error: errorMessage,
    })
  );
  response.end();
};

const handleMissingPathParams = async (
  responseStream: HttpResponseStream,
  origin: string | undefined
): Promise<void> => {
  await writeJsonErrorResponse(
    responseStream,
    400,
    origin,
    null,
    "workspaceId, agentId, and key are required in the URL path"
  );
};

const handleOptionsRequest = async (
  event: APIGatewayProxyEventV2,
  responseStream: HttpResponseStream
): Promise<boolean> => {
  if (event.requestContext.http.method !== "OPTIONS") {
    return false;
  }
  const origin = getOrigin(event);
  const corsHeaders = computeCorsHeaders("stream", origin, null);
  const optionsResponse: APIGatewayProxyResultV2 = {
    statusCode: 200,
    headers: corsHeaders,
    body: "",
  };
  const headersAsStrings: Record<string, string> = {};
  if (optionsResponse.headers) {
    for (const [key, value] of Object.entries(optionsResponse.headers)) {
      headersAsStrings[key] = String(value);
    }
  }
  const response = createResponseStream(
    responseStream,
    headersAsStrings,
    optionsResponse.statusCode
  );
  await writeChunkToStream(response, optionsResponse.body || "");
  response.end();
  return true;
};

const ensureAwsRequestId = (event: APIGatewayProxyEventV2): string => {
  const awsRequestId =
    event.requestContext.requestId ||
    `gen-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  if (!event.requestContext.requestId) {
    event.requestContext.requestId = awsRequestId;
  }
  return awsRequestId;
};

const ensureConversationId = (event: APIGatewayProxyEventV2): string => {
  let conversationId =
    event.headers["x-conversation-id"] || event.headers["X-Conversation-Id"];
  if (!conversationId || typeof conversationId !== "string") {
    conversationId = `widget-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 9)}`;
    event.headers["X-Conversation-Id"] = conversationId;
  }
  return conversationId;
};

const loadAgentConfig = async (
  db: Awaited<ReturnType<typeof database>>,
  workspaceId: string,
  agentId: string
) => {
  const agentPk = `agents/${workspaceId}/${agentId}`;
  return db.agent.get(agentPk, "agent");
};

const validateWidgetKeyOrRespond = async (params: {
  workspaceId: string;
  agentId: string;
  key: string;
  responseStream: HttpResponseStream;
  origin: string | undefined;
  allowedOrigins: string[] | null;
}): Promise<boolean> => {
  try {
    await validateWidgetKey(params.workspaceId, params.agentId, params.key);
    return true;
  } catch (error) {
    await writeJsonErrorResponse(
      params.responseStream,
      401,
      params.origin,
      params.allowedOrigins,
      error instanceof Error ? error.message : "Invalid widget key"
    );
    return false;
  }
};

const handleTimeoutError = async (params: {
  context?: StreamRequestContext;
  responseStream: HttpResponseStream;
  origin: string | undefined;
  allowedOrigins: string[] | null;
}) => {
  const timeoutError = createTimeoutError();
  if (params.context) {
    await persistConversationError(params.context, timeoutError);
  }

  const errorHeaders = mergeCorsHeaders(
    "stream",
    params.origin,
    params.allowedOrigins,
    {
      "Content-Type": "text/event-stream; charset=utf-8",
    }
  );
  const response = createResponseStream(params.responseStream, errorHeaders, 504);
  await writeErrorResponse(response, timeoutError.message);
  response.end();
};

const tryHandleCreditError = async (params: {
  error: unknown;
  workspaceId: string;
  responseStream: HttpResponseStream;
  origin: string | undefined;
  allowedOrigins: string[] | null;
  context?: StreamRequestContext;
}): Promise<boolean> => {
  const { error } = params;
  if (
    !(error instanceof InsufficientCreditsError) &&
    !(error instanceof SpendingLimitExceededError)
  ) {
    return false;
  }

  const creditErrorResult = await handleCreditErrors(
    error,
    params.workspaceId,
    "webhook"
  );
  if (!creditErrorResult.handled || !creditErrorResult.response) {
    return false;
  }

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

      if (params.context) {
        await persistConversationError(params.context, error);
      }

      const errorHeaders = mergeCorsHeaders(
        "stream",
        params.origin,
        params.allowedOrigins,
        {
          "Content-Type": "text/event-stream; charset=utf-8",
        }
      );
      const responseStream = createResponseStream(
        params.responseStream,
        errorHeaders,
        (response as { statusCode?: number }).statusCode || 402
      );
      await writeErrorResponse(responseStream, new Error(errorMessage));
      responseStream.end();
      return true;
    } catch (parseError) {
      console.error(
        "[Widget Handler] Error parsing credit error response:",
        parseError
      );
    }
  }

  return false;
};

const writeGenericError = async (params: {
  error: unknown;
  responseStream: HttpResponseStream;
  origin: string | undefined;
  allowedOrigins: string[] | null;
  context?: StreamRequestContext;
}): Promise<void> => {
  if (params.context) {
    await persistConversationError(params.context, params.error);
  }

  const boomed = boomify(ensureError(params.error));
  const errorHeaders = mergeCorsHeaders(
    "stream",
    params.origin,
    params.allowedOrigins,
    {
      "Content-Type": "text/event-stream; charset=utf-8",
    }
  );
  const response = createResponseStream(
    params.responseStream,
    errorHeaders,
    boomed.output.statusCode || 500
  );
  await writeErrorResponse(
    response,
    params.error instanceof Error ? params.error : new Error(String(params.error))
  );
  response.end();
};

/**
 * Internal handler function that processes the widget request
 */
export const internalHandler = async (
  event: APIGatewayProxyEventV2,
  responseStream: HttpResponseStream
): Promise<void> => {
  console.log("[Widget Handler] Internal handler called", {
    event,
  });

  const httpV2Event = ensureRequestContextHttp(event);
  const { workspaceId, agentId, key } = resolvePathParams(httpV2Event);

  if (!workspaceId || !agentId || !key) {
    await handleMissingPathParams(responseStream, getOrigin(httpV2Event));
    return;
  }

  if (await handleOptionsRequest(httpV2Event, responseStream)) {
    return;
  }

  const awsRequestId = ensureAwsRequestId(httpV2Event);
  setupWorkspaceCreditContext(awsRequestId);

  const origin = getOrigin(httpV2Event);
  const db = await database();
  const agent = await loadAgentConfig(db, workspaceId, agentId);

  if (!agent) {
    await writeJsonErrorResponse(
      responseStream,
      404,
      origin,
      null,
      "Agent not found"
    );
    return;
  }

  if (!agent.widgetConfig?.enabled) {
    await writeJsonErrorResponse(
      responseStream,
      403,
      origin,
      null,
      "Widget is not enabled for this agent"
    );
    return;
  }

  const allowedOrigins = agent.widgetConfig?.allowedOrigins || null;

  const isKeyValid = await validateWidgetKeyOrRespond({
    workspaceId,
    agentId,
    key,
    responseStream,
    origin,
    allowedOrigins,
  });
  if (!isKeyValid) {
    return;
  }

  const corsHeaders = computeCorsHeaders("stream", origin, allowedOrigins);
  responseStream = createResponseStream(responseStream, corsHeaders, 200);

  const requestTimeout = createRequestTimeout();
  let context: StreamRequestContext | undefined;

  try {
    ensureConversationId(httpV2Event);
    context = await buildStreamRequestContext(
      httpV2Event,
      {
        workspaceId,
        agentId,
        secret: "widget-auth",
        endpointType: "stream",
      },
      { authenticated: true }
    );

    context.allowedOrigins = allowedOrigins;

    const executionResult = await executeStream(
      context,
      responseStream,
      requestTimeout.signal
    );
    if (!executionResult) {
      cleanupRequestTimeout(requestTimeout);
      return;
    }

    trackBusinessEvent(
      "widget_endpoint",
      "called",
      {
        workspace_id: workspaceId,
        agent_id: agentId,
      },
      undefined
    );

    cleanupRequestTimeout(requestTimeout);
  } catch (error) {
    cleanupRequestTimeout(requestTimeout);

    if (isTimeoutError(error)) {
      await handleTimeoutError({
        context,
        responseStream,
        origin,
        allowedOrigins,
      });
      return;
    }

    const boomed = boomify(ensureError(error));
    console.error("[Widget Handler] Unhandled error:", boomed);

    if (boomed.isServer) {
      Sentry.captureException(ensureError(error), {
        tags: {
          handler: "Widget Handler",
          statusCode: boomed.output.statusCode,
        },
      });
    }

    if (
      await tryHandleCreditError({
        error,
        workspaceId,
        responseStream,
        origin,
        allowedOrigins,
        context,
      })
    ) {
      return;
    }

    await writeGenericError({
      error,
      responseStream,
      origin,
      allowedOrigins,
      context,
    });
  } finally {
    clearCurrentHTTPContext(awsRequestId);
    await flushSentry();
    await flushPostHog();
  }
};
