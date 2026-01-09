import { boomify } from "@hapi/boom";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { streamifyResponse } from "lambda-stream";

import { database } from "../../tables";
import {
  InsufficientCreditsError,
  SpendingLimitExceededError,
} from "../../utils/creditErrors";
import {
  handlingErrors,
} from "../../utils/handlingErrors";
import type { LambdaUrlEvent } from "../../utils/httpEventAdapter";
import { adaptHttpHandler } from "../../utils/httpEventAdapter";
import { flushPostHog } from "../../utils/posthog";
import { Sentry, ensureError ,
  initSentry,
  flushSentry,
} from "../../utils/sentry";
import { trackBusinessEvent } from "../../utils/tracking";
import { clearCurrentHTTPContext } from "../../utils/workspaceCreditContext";
import { handleCreditErrors } from "../utils/generationErrorHandling";
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

  normalizeEventToHttpV2,
  ensureRequestContextHttp} from "../utils/streamEventNormalization";
import { executeStream } from "../utils/streamExecution";
import {
  buildStreamRequestContext,
  type StreamRequestContext,
} from "../utils/streamRequestContext";
import {
  writeChunkToStream,
  type HttpResponseStream,
} from "../utils/streamResponseStream";

// Declare global awslambda for Lambda Function URL streaming
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

// Initialize Sentry when this module is loaded
initSentry();

/**
 * Internal handler function that processes the widget request
 */
const internalHandler = async (
  event: APIGatewayProxyEventV2,
  responseStream: HttpResponseStream
): Promise<void> => {
  console.log("[Widget Handler] Internal handler called", {
    event,
  });

  // Ensure requestContext.http exists
  const httpV2Event = ensureRequestContextHttp(event);

  // Extract path parameters
  const workspaceId = httpV2Event.pathParameters?.workspaceId;
  const agentId = httpV2Event.pathParameters?.agentId;
  const key = httpV2Event.pathParameters?.key;

  if (!workspaceId || !agentId || !key) {
    const origin =
      httpV2Event.headers["origin"] || httpV2Event.headers["Origin"];
    const errorHeaders = mergeCorsHeaders(
      "stream", // Use stream endpoint type for CORS
      origin,
      null, // No allowed origins check for invalid paths
      {
        "Content-Type": "application/json",
      }
    );

    if (typeof awslambda !== "undefined" && awslambda) {
      responseStream = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: 400,
        headers: errorHeaders,
      });
    }
    const errorResponse = JSON.stringify({
      error: "workspaceId, agentId, and key are required in the URL path",
    });
    await writeChunkToStream(responseStream, errorResponse);
    responseStream.end();
    return;
  }

  // Handle OPTIONS preflight
  if (httpV2Event.requestContext.http.method === "OPTIONS") {
    const origin =
      httpV2Event.headers["origin"] || httpV2Event.headers["Origin"];
    // Get allowed origins from agent widget config
    const db = await database();
    const agentPk = `agents/${workspaceId}/${agentId}`;
    const agent = await db.agent.get(agentPk, "agent");
    const allowedOrigins =
      agent?.widgetConfig?.allowedOrigins || null;
    const corsHeaders = computeCorsHeaders("stream", origin, allowedOrigins);
    // Create OPTIONS response directly
    const optionsResponse: APIGatewayProxyResultV2 = {
      statusCode: 200,
      headers: corsHeaders,
      body: "",
    };
    if (typeof awslambda !== "undefined" && awslambda) {
      responseStream = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: optionsResponse.statusCode,
        headers: optionsResponse.headers,
      });
    }
    await writeChunkToStream(responseStream, optionsResponse.body || "");
    responseStream.end();
    return;
  }

  // Extract request ID
  const awsRequestId =
    httpV2Event.requestContext.requestId ||
    `gen-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  // Ensure the request ID is set in the event
  if (!httpV2Event.requestContext.requestId) {
    httpV2Event.requestContext.requestId = awsRequestId;
  }

  // Setup workspace credit context
  setupWorkspaceCreditContext(awsRequestId);

  // Get origin for CORS
  const origin =
    httpV2Event.headers["origin"] || httpV2Event.headers["Origin"];

  // Get allowed origins from agent widget config
  const db = await database();
  const agentPk = `agents/${workspaceId}/${agentId}`;
  const agent = await db.agent.get(agentPk, "agent");

  if (!agent) {
    const errorHeaders = mergeCorsHeaders(
      "stream",
      origin,
      null,
      {
        "Content-Type": "application/json",
      }
    );
    if (typeof awslambda !== "undefined" && awslambda) {
      responseStream = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: 404,
        headers: errorHeaders,
      });
    }
    const errorResponse = JSON.stringify({
      error: "Agent not found",
    });
    await writeChunkToStream(responseStream, errorResponse);
    responseStream.end();
    return;
  }

  // Check if widget is enabled
  if (!agent.widgetConfig?.enabled) {
    const errorHeaders = mergeCorsHeaders(
      "stream",
      origin,
      null,
      {
        "Content-Type": "application/json",
      }
    );
    if (typeof awslambda !== "undefined" && awslambda) {
      responseStream = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: 403,
        headers: errorHeaders,
      });
    }
    const errorResponse = JSON.stringify({
      error: "Widget is not enabled for this agent",
    });
    await writeChunkToStream(responseStream, errorResponse);
    responseStream.end();
    return;
  }

  const allowedOrigins = agent.widgetConfig?.allowedOrigins || null;

  // Validate widget key
  try {
    await validateWidgetKey(workspaceId, agentId, key);
  } catch (error) {
    const errorHeaders = mergeCorsHeaders(
      "stream",
      origin,
      allowedOrigins,
      {
        "Content-Type": "application/json",
      }
    );
    if (typeof awslambda !== "undefined" && awslambda) {
      responseStream = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: 401,
        headers: errorHeaders,
      });
    }
    const errorResponse = JSON.stringify({
      error: error instanceof Error ? error.message : "Invalid widget key",
    });
    await writeChunkToStream(responseStream, errorResponse);
    responseStream.end();
    return;
  }

  // Set CORS headers immediately before any async operations
  const corsHeaders = computeCorsHeaders("stream", origin, allowedOrigins);
  if (typeof awslambda !== "undefined" && awslambda) {
    responseStream = awslambda.HttpResponseStream.from(responseStream, {
      statusCode: 200,
      headers: corsHeaders,
    });
  }

  let context: StreamRequestContext | undefined;

  try {
    // Generate conversation ID if not provided (required by buildStreamRequestContext)
    let conversationId =
      httpV2Event.headers["x-conversation-id"] ||
      httpV2Event.headers["X-Conversation-Id"];
    
    if (!conversationId || typeof conversationId !== "string") {
      conversationId = `widget-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      // Set it in headers so buildStreamRequestContext can read it
      httpV2Event.headers["X-Conversation-Id"] = conversationId;
    }

    // Build context using buildStreamRequestContext
    // We pass a dummy secret since widget uses key auth, but the function needs it
    // The secret won't be used since we already validated the widget key
    context = await buildStreamRequestContext(
      httpV2Event,
      {
        workspaceId,
        agentId,
        secret: "widget-auth", // Dummy value, not used since we already validated key
        endpointType: "stream", // Use stream endpoint type
      },
      { authenticated: true } // Widget key is already validated
    );

    // Override allowed origins with widget config (buildStreamRequestContext uses stream-servers table)
    context.allowedOrigins = allowedOrigins;

    // Execute stream
    const executionResult = await executeStream(context, responseStream);
    if (!executionResult) {
      // Error was handled in executeStream
      return;
    }

    // Post-processing (logging, etc.)
    // Note: We skip some post-processing that requires userId since widget doesn't have user context
    trackBusinessEvent(
      "widget_endpoint",
      "called",
      {
        workspace_id: workspaceId,
        agent_id: agentId,
      },
      undefined // Widget endpoints use keys, not standard auth
    );
  } catch (error) {
    const boomed = boomify(error as Error);
    console.error("[Widget Handler] Unhandled error:", boomed);

    if (boomed.isServer) {
      Sentry.captureException(ensureError(error), {
        tags: {
          handler: "Widget Handler",
          statusCode: boomed.output.statusCode,
        },
      });
    }

    // Handle credit errors
    if (
      workspaceId &&
      (error instanceof InsufficientCreditsError ||
        error instanceof SpendingLimitExceededError)
    ) {
      const creditErrorResult = await handleCreditErrors(
        error,
        workspaceId,
        "webhook" // Use webhook endpoint type for credit error handling
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

            if (typeof awslambda !== "undefined" && awslambda) {
              const errorHeaders = mergeCorsHeaders(
                "stream",
                origin,
                allowedOrigins,
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
              "[Widget Handler] Error parsing credit error response:",
              parseError
            );
          }
        }
      }
    }

    // Generic error handling
    if (context) {
      await persistConversationError(context, error);
    }

    const errorHeaders = mergeCorsHeaders(
      "stream",
      origin,
      allowedOrigins,
      {
        "Content-Type": "text/event-stream; charset=utf-8",
      }
    );

    if (typeof awslambda !== "undefined" && awslambda) {
      responseStream = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: boomed.output.statusCode || 500,
        headers: errorHeaders,
      });
    }

    await writeErrorResponse(
      responseStream,
      error instanceof Error ? error : new Error(String(error))
    );
    responseStream.end();
  } finally {
    // Cleanup
    clearCurrentHTTPContext(awsRequestId);
    await flushSentry();
    await flushPostHog();
  }
};

/**
 * Main handler for widget endpoint
 * Supports both API Gateway and Lambda Function URL
 */
const createHandler = () => {
  if (typeof streamifyResponse !== "undefined") {
    return streamifyResponse(
      async (
        _event: APIGatewayProxyEventV2 | LambdaUrlEvent,
        responseStream: HttpResponseStream
      ): Promise<void> => {
        const httpV2Event = normalizeEventToHttpV2(_event);
        await internalHandler(httpV2Event, responseStream);
      }
    );
  }
  // Fallback for non-streaming environments
  return adaptHttpHandler(
    handlingErrors(
      async (): Promise<APIGatewayProxyResultV2> => {
        throw new Error("streamifyResponse is not available");
      }
    )
  );
};

export const handler = createHandler();
