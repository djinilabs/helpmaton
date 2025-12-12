import type { HttpAsyncHandler, HttpHandler } from "@architect/functions";
import type {
  HttpRequest,
  HttpResponse,
} from "@architect/functions/types/http";
import { boomify } from "@hapi/boom";
import type { Context } from "aws-lambda";
import {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyEventV2,
  Callback,
  APIGatewayProxyResultV2,
  ScheduledEvent,
} from "aws-lambda";

import { initPostHog, flushPostHog } from "./posthog";
import { initSentry, Sentry, flushSentry, ensureError } from "./sentry";

// Initialize Sentry when this module is loaded (before any handlers are called)
initSentry();
// Initialize PostHog when this module is loaded (before any handlers are called)
initPostHog();

export const handlingErrors = (
  userHandler: APIGatewayProxyHandlerV2
): APIGatewayProxyHandlerV2 => {
  return async (
    event: APIGatewayProxyEventV2,
    context: Context,
    callback: Callback
  ): Promise<APIGatewayProxyResultV2> => {
    try {
      const result = await userHandler(event, context, callback);
      if (!result) {
        throw new Error("Handler returned undefined");
      }
      // Flush PostHog events before returning (critical for Lambda)
      try {
        await flushPostHog();
      } catch (flushError) {
        console.error("[PostHog] Error flushing events:", flushError);
      }
      return result as APIGatewayProxyResultV2;
    } catch (error) {
      const boomed = boomify(error as Error);

      // Always log the full error details
      console.error("Lambda handler error:", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        boom: {
          statusCode: boomed.output.statusCode,
          message: boomed.message,
          isServer: boomed.isServer,
        },
      });

      // Report ALL errors to Sentry with full context
      // This ensures we capture all failures for monitoring and debugging
      Sentry.captureException(ensureError(error), {
        tags: {
          handler: "APIGatewayProxyHandlerV2",
          statusCode: boomed.output.statusCode,
          isServer: boomed.isServer,
        },
        contexts: {
          request: {
            method: event.requestContext?.http?.method || "UNKNOWN",
            url: event.rawPath || event.requestContext?.http?.path || "UNKNOWN",
            path:
              event.rawPath || event.requestContext?.http?.path || "UNKNOWN",
            headers: event.headers || {},
            queryString:
              event.rawQueryString || event.queryStringParameters || {},
            body: event.body
              ? event.body.length > 10000
                ? "[truncated]"
                : event.body
              : undefined,
          },
          lambda: {
            requestId: context.awsRequestId,
            functionName: context.functionName,
            functionVersion: context.functionVersion,
            memoryLimitInMB: context.memoryLimitInMB,
            remainingTimeInMillis:
              typeof context.getRemainingTimeInMillis === "function"
                ? context.getRemainingTimeInMillis()
                : undefined,
          },
        },
        extra: {
          event: {
            path: event.rawPath || event.requestContext?.http?.path,
            method: event.requestContext?.http?.method,
            headers: event.headers,
            queryStringParameters: event.queryStringParameters,
            pathParameters: event.pathParameters,
            stageVariables: event.stageVariables,
            requestContext: event.requestContext,
          },
          boom: {
            statusCode: boomed.output.statusCode,
            message: boomed.message,
            isServer: boomed.isServer,
            payload: boomed.output.payload,
          },
        },
      });

      const { statusCode, headers, payload } = boomed.output;

      // Convert headers to Record<string, string> as required by HttpResponse
      const stringHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(headers)) {
        stringHeaders[key] = String(value);
      }

      // Flush Sentry events before returning (critical for Lambda)
      // Always flush to ensure all errors are reported, not just server errors
      await flushSentry();

      // Flush PostHog events before returning (critical for Lambda)
      await flushPostHog();

      return {
        statusCode,
        headers: stringHeaders,
        body: JSON.stringify(payload),
      };
    }
  };
};

export const handlingHttpAsyncErrors = (
  userHandler: HttpAsyncHandler
): HttpAsyncHandler => {
  return async (
    req: HttpRequest,
    context: Context
  ): Promise<HttpResponse | void> => {
    try {
      const result = await userHandler(req, context);
      // Flush PostHog events before returning (critical for Lambda)
      try {
        await flushPostHog();
      } catch (flushError) {
        console.error("[PostHog] Error flushing events:", flushError);
      }
      return result;
    } catch (error) {
      const boomed = boomify(error as Error);

      if (boomed.isServer) {
        console.error(boomed);
        // Report 500 errors to Sentry
        Sentry.captureException(ensureError(error), {
          tags: {
            handler: "HttpAsyncHandler",
            statusCode: boomed.output.statusCode,
          },
        });
      } else {
        console.warn(boomed);
      }

      const { statusCode, headers, payload } = boomed.output;

      // Convert headers to Record<string, string> as required by HttpResponse
      const stringHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(headers)) {
        stringHeaders[key] = String(value);
      }

      // Flush Sentry events before returning (critical for Lambda)
      if (boomed.isServer) {
        await flushSentry();
      }

      // Flush PostHog events before returning (critical for Lambda)
      await flushPostHog();

      return {
        statusCode,
        headers: stringHeaders,
        body: JSON.stringify(payload),
      };
    }
  };
};

export const handlingHttpErrors = (userHandler: HttpHandler): HttpHandler => {
  return (
    req: HttpRequest,
    res: (resOrError: HttpResponse | Error) => void,
    next: () => void
  ): void => {
    try {
      userHandler(req, res, next);
    } catch (error) {
      const boomed = boomify(error as Error);

      if (boomed.isServer) {
        console.error(boomed);
        // Report 500 errors to Sentry
        Sentry.captureException(ensureError(error), {
          tags: {
            handler: "HttpHandler",
            statusCode: boomed.output.statusCode,
          },
        });
        // Note: This is a synchronous handler, so we can't await the flush.
        // The flush will run in the background, but Lambda may terminate before it completes.
        // This is a limitation of the synchronous handler pattern.
        flushSentry().catch((flushError) => {
          console.error("[Sentry] Error flushing events:", flushError);
        });
        flushPostHog().catch((flushError) => {
          console.error("[PostHog] Error flushing events:", flushError);
        });
      } else {
        console.warn(boomed);
      }

      const { statusCode, headers, payload } = boomed.output;

      // Convert headers to Record<string, string> as required by HttpResponse
      const stringHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(headers)) {
        stringHeaders[key] = String(value);
      }

      res({
        statusCode,
        headers: stringHeaders,
        body: JSON.stringify(payload),
      });
    }
  };
};

/**
 * Wrapper for scheduled Lambda functions (EventBridge scheduled events)
 * Handles errors uniformly and reports server errors to Sentry
 * Scheduled functions don't have user errors - all errors are server errors
 */
export const handlingScheduledErrors = (
  userHandler: (event: ScheduledEvent) => Promise<void>
): ((event: ScheduledEvent) => Promise<void>) => {
  return async (event: ScheduledEvent): Promise<void> => {
    try {
      await userHandler(event);
      // Flush PostHog events before Lambda terminates (critical for Lambda)
      try {
        await flushPostHog();
      } catch (flushError) {
        console.error("[PostHog] Error flushing events:", flushError);
      }
    } catch (error) {
      const boomed = boomify(error as Error);

      // Always log the full error details
      console.error("Scheduled function error:", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        boom: {
          statusCode: boomed.output.statusCode,
          message: boomed.message,
          isServer: boomed.isServer,
        },
        event: {
          source: event.source,
          "detail-type": event["detail-type"],
          time: event.time,
        },
      });

      // Scheduled functions don't have user errors - all errors are server errors
      // Report all errors to Sentry
      console.error("Scheduled function server error details:", boomed);
      Sentry.captureException(ensureError(error), {
        tags: {
          handler: "ScheduledFunction",
          statusCode: boomed.output.statusCode,
          source: event.source || "unknown",
          detailType: event["detail-type"] || "unknown",
        },
        contexts: {
          event: {
            source: event.source,
            "detail-type": event["detail-type"],
            time: event.time,
            region: event.region,
            account: event.account,
          },
        },
      });

      // Flush Sentry events before Lambda terminates (critical for Lambda)
      await flushSentry();

      // Flush PostHog events before Lambda terminates (critical for Lambda)
      await flushPostHog();

      // Re-throw the error so Lambda marks the invocation as failed
      throw error;
    }
  };
};
