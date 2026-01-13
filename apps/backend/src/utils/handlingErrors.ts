import type { HttpAsyncHandler, HttpHandler } from "@architect/functions";
import type {
  HttpRequest,
  HttpResponse,
} from "@architect/functions/types/http";
import { boomify } from "@hapi/boom";
import {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyEventV2,
  Callback,
  APIGatewayProxyResultV2,
  ScheduledEvent,
} from "aws-lambda";
import type { Context } from "aws-lambda";

/**
 * Check if an error indicates an authentication/authorization issue with the API key
 * This includes 401, 403 errors or error messages containing authentication-related keywords
 */
export function isAuthenticationError(error: unknown): boolean {
  // Helper to check a single error object
  const checkError = (err: unknown): boolean => {
    if (!err) return false;

    // Check if it's an Error instance
    if (err instanceof Error) {
      const message = err.message.toLowerCase();

      // Check for HTTP status codes in error properties
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 401 || statusCode === 403) {
        return true;
      }

      // Check for authentication-related keywords in error message
      if (
        message.includes("api key") ||
        message.includes("authentication") ||
        message.includes("unauthorized") ||
        message.includes("forbidden") ||
        message.includes("invalid key") ||
        message.includes("invalid api") ||
        message.includes("authentication failed") ||
        message.includes("401") ||
        message.includes("403") ||
        message.includes("invalid api key") ||
        message.includes("api key is invalid") ||
        message.includes("authentication required") ||
        message.includes("no cookie auth credentials") ||
        message.includes("cookie auth credentials") ||
        // NoOutputGeneratedError with "check the stream for errors" often indicates auth errors
        (message.includes("no output generated") &&
          message.includes("check the stream for errors"))
      ) {
        return true;
      }

      // Check error.cause (standard Error property) - recursively check the cause chain
      if (err.cause) {
        if (checkError(err.cause)) {
          return true;
        }
      }

      // For AI SDK errors, check if there's a cause with statusCode
      // AI SDK wraps errors, so we need to check nested properties
      if (typeof err === "object" && err !== null && !(err instanceof Error)) {
        const errorObj = err as Record<string, unknown>;
        if ("cause" in errorObj && errorObj.cause) {
          const cause = errorObj.cause;
          if (checkError(cause)) {
            return true;
          }
        }
      }
    }

    // Check if error object has statusCode property
    if (typeof err === "object" && err !== null) {
      const obj = err as Record<string, unknown>;

      // Check statusCode
      if ("statusCode" in obj) {
        const statusCode = obj.statusCode;
        if (statusCode === 401 || statusCode === 403) {
          return true;
        }
      }

      // Check status
      if ("status" in obj) {
        const status = obj.status;
        if (status === 401 || status === 403) {
          return true;
        }
      }

      // Check response object (common in fetch errors)
      if ("response" in obj && obj.response) {
        const response = obj.response as Record<string, unknown>;
        if ("status" in response) {
          const status = response.status;
          if (status === 401 || status === 403) {
            return true;
          }
        }
        if ("statusCode" in response) {
          const statusCode = response.statusCode;
          if (statusCode === 401 || statusCode === 403) {
            return true;
          }
        }
      }

      // Check data/body for error messages (AI SDK errors often have error info in data)
      if ("data" in obj && typeof obj.data === "object" && obj.data !== null) {
        const data = obj.data as Record<string, unknown>;

        // Check data.error.message (common in AI SDK errors)
        if ("error" in data) {
          const errorField = data.error;
          if (typeof errorField === "object" && errorField !== null) {
            const errorObj = errorField as Record<string, unknown>;
            if ("message" in errorObj && typeof errorObj.message === "string") {
              const errorMsg = errorObj.message.toLowerCase();
              if (
                errorMsg.includes("api key") ||
                errorMsg.includes("authentication") ||
                errorMsg.includes("unauthorized") ||
                errorMsg.includes("forbidden") ||
                errorMsg.includes("invalid key") ||
                errorMsg.includes("no cookie auth credentials") ||
                errorMsg.includes("cookie auth credentials")
              ) {
                return true;
              }
            }
            // Check for status code in error object
            if (
              "code" in errorObj &&
              (errorObj.code === 401 || errorObj.code === 403)
            ) {
              return true;
            }
          } else if (typeof errorField === "string") {
            const errorMsg = errorField.toLowerCase();
            if (
              errorMsg.includes("api key") ||
              errorMsg.includes("authentication") ||
              errorMsg.includes("unauthorized") ||
              errorMsg.includes("forbidden") ||
              errorMsg.includes("invalid key")
            ) {
              return true;
            }
          }
        }

        // Check data.message directly
        if ("message" in data && typeof data.message === "string") {
          const errorMsg = data.message.toLowerCase();
          if (
            errorMsg.includes("api key") ||
            errorMsg.includes("authentication") ||
            errorMsg.includes("unauthorized") ||
            errorMsg.includes("forbidden") ||
            errorMsg.includes("invalid key") ||
            errorMsg.includes("no cookie auth credentials") ||
            errorMsg.includes("cookie auth credentials")
          ) {
            return true;
          }
        }
      }

      // Check body for error messages
      if ("body" in obj && typeof obj.body === "string") {
        try {
          const body = JSON.parse(obj.body) as Record<string, unknown>;
          if ("error" in body && typeof body.error === "string") {
            const errorMsg = body.error.toLowerCase();
            if (
              errorMsg.includes("api key") ||
              errorMsg.includes("authentication") ||
              errorMsg.includes("unauthorized") ||
              errorMsg.includes("forbidden") ||
              errorMsg.includes("invalid key")
            ) {
              return true;
            }
          }
        } catch {
          // Not JSON, ignore
        }
      }
    }

    return false;
  };

  return checkError(error);
}

import { initPostHog, flushPostHog } from "./posthog";
import { initSentry, Sentry, flushSentry, ensureError } from "./sentry";
import type { AugmentedContext } from "./workspaceCreditContext";
import {
  augmentContextWithCreditTransactions,
  commitContextTransactions,
  setCurrentHTTPContext,
  clearCurrentHTTPContext,
} from "./workspaceCreditContext";

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
    // Augment context with workspace credit transaction capability
    // Database will be lazy-loaded only if workspace credit transactions are actually used
    // This avoids interfering with other handlers (e.g., auth) that need tables() with specific options
    const augmentedContext = augmentContextWithCreditTransactions(context);

    // Make context available to Express handlers via module-level storage
    // Extract requestId from event (API Gateway includes it in requestContext.requestId)
    // In local sandbox environments, requestId might not be present, so generate one if needed
    let requestId = event.requestContext?.requestId || context.awsRequestId;

    // If no requestId is available (e.g., in local sandbox), generate one
    if (!requestId) {
      // Generate a unique requestId for local development
      requestId = `local-${Date.now()}-${Math.random()
        .toString(36)
        .substring(2, 15)}`;
      console.log(
        "[handlingErrors] Generated requestId for local environment:",
        requestId
      );

      // Ensure requestContext exists and set the requestId
      if (!event.requestContext) {
        event.requestContext = {
          accountId: "local",
          apiId: "local",
          domainName: "localhost",
          domainPrefix: "local",
          http: {
            method: "GET",
            path: "/",
            protocol: "HTTP/1.1",
            sourceIp: "127.0.0.1",
            userAgent: "",
          },
          requestId,
          routeKey: event.routeKey || "GET /",
          stage: "local",
          time: new Date().toISOString(),
          timeEpoch: Date.now(),
        };
      } else {
        event.requestContext.requestId = requestId;
      }

      // Also set it on the context's awsRequestId property for commitContextTransactions
      // This is needed because commitContextTransactions reads from context.awsRequestId
      (context as { awsRequestId: string }).awsRequestId = requestId;
    }

    if (requestId) {
      // Ensure context.awsRequestId is set (needed for commitContextTransactions)
      if (!context.awsRequestId) {
        (context as { awsRequestId: string }).awsRequestId = requestId;
      }

      console.log(
        "[handlingErrors] Setting up context with requestId:",
        requestId
      );
      setCurrentHTTPContext(requestId, augmentedContext);

      // Ensure requestId is in event headers so serverlessExpress can pass it to Express handlers
      // This is needed because serverlessExpress may not automatically add x-amzn-requestid header
      if (
        !event.headers["x-amzn-requestid"] &&
        !event.headers["X-Amzn-Requestid"]
      ) {
        event.headers["x-amzn-requestid"] = requestId;
      }
      if (!event.headers["x-request-id"] && !event.headers["X-Request-Id"]) {
        event.headers["x-request-id"] = requestId;
      }
    }

    let hadError = false;
    try {
      const result = await userHandler(event, augmentedContext, callback);
      if (!result) {
        throw new Error("Handler returned undefined");
      }
      return result as APIGatewayProxyResultV2;
    } catch (error) {
      hadError = true; // Used in finally block for commitContextTransactions
      const boomed = boomify(ensureError(error));

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

      if (boomed.isServer) {
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
              url:
                event.rawPath || event.requestContext?.http?.path || "UNKNOWN",
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
      }

      const { statusCode, headers, payload } = boomed.output;

      // Convert headers to Record<string, string> as required by HttpResponse
      const stringHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(headers)) {
        stringHeaders[key] = String(value);
      }

      return {
        statusCode,
        headers: stringHeaders,
        body: JSON.stringify(payload),
      };
    } finally {
      // Commit workspace credit transactions (only on success, no errors)
      try {
        await commitContextTransactions(context, hadError);
      } catch (commitError) {
        // Commit failures cause handler to fail (per user requirement)
        const messagePrefix = hadError
          ? "[handlingErrors] Handler failed and additionally failed to commit credit transactions"
          : "[handlingErrors] Failed to commit credit transactions";
        console.error(messagePrefix + ":", commitError);

        // Wrap the commit error to preserve context about prior handler failure
        const wrappedError =
          commitError instanceof Error
            ? new Error(messagePrefix + ": " + commitError.message, {
                cause: commitError,
              })
            : new Error(messagePrefix + ": " + String(commitError));

        // eslint-disable-next-line no-unsafe-finally
        throw wrappedError;
      } finally {
        // Clear context from module-level storage
        const requestId =
          event.requestContext?.requestId || context.awsRequestId;
        if (requestId) {
          clearCurrentHTTPContext(requestId);
        }
      }

      // Flush Sentry and PostHog events before Lambda terminates (critical for Lambda)
      // This ensures flushing happens on both success and error paths
      await Promise.all([flushPostHog(), flushSentry()]).catch(
        (flushErrors) => {
          console.error("[PostHog/Sentry] Error flushing events:", flushErrors);
        }
      );
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
    // Augment context with workspace credit transaction capability
    // Database will be lazy-loaded only if workspace credit transactions are actually used
    const augmentedContext = augmentContextWithCreditTransactions(context);

    // Make context available to Express handlers via module-level storage
    const requestId = context.awsRequestId;
    setCurrentHTTPContext(requestId, augmentedContext);

    let hadError = false;
    try {
      const result = await userHandler(req, augmentedContext);
      return result;
    } catch (error) {
      hadError = true;
      const boomed = boomify(ensureError(error));

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

      return {
        statusCode,
        headers: stringHeaders,
        body: JSON.stringify(payload),
      };
    } finally {
      // Commit workspace credit transactions (only on success, no errors)
      try {
        await commitContextTransactions(context, hadError);
      } catch (commitError) {
        // Commit failures cause handler to fail (per user requirement)
        console.error(
          "[handlingHttpAsyncErrors] Failed to commit credit transactions:",
          commitError
        );
        // eslint-disable-next-line no-unsafe-finally
        throw commitError;
      } finally {
        // Clear context from module-level storage
        clearCurrentHTTPContext(requestId);
      }

      // Flush Sentry and PostHog events before Lambda terminates (critical for Lambda)
      // This ensures flushing happens on both success and error paths
      await Promise.all([flushPostHog(), flushSentry()]).catch(
        (flushErrors) => {
          console.error("[PostHog/Sentry] Error flushing events:", flushErrors);
        }
      );
    }
  };
};

export const handlingHttpErrors = (userHandler: HttpHandler): HttpHandler => {
  return (
    req: HttpRequest,
    res: (resOrError: HttpResponse | Error) => void,
    next: () => void
  ): void => {
    /**
     * @deprecated HttpHandler is synchronous and deprecated in favor of HttpAsyncHandler.
     * This handler type does not support workspace credit transactions.
     * Use HttpAsyncHandler instead for credit transaction support.
     */
    // Note: HttpHandler is synchronous, so we can't augment context here
    // This handler type is deprecated in favor of HttpAsyncHandler
    // For now, we'll just pass through without credit transaction support
    try {
      userHandler(req, res, next);
    } catch (error) {
      const boomed = boomify(ensureError(error));

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
  userHandler: (
    event: ScheduledEvent,
    context?: AugmentedContext
  ) => Promise<void>
): ((event: ScheduledEvent) => Promise<void>) => {
  return async (event: ScheduledEvent): Promise<void> => {
    // Create a mock context for scheduled functions (they don't have a real context)
    // We'll create a minimal context object with awsRequestId
    const mockContext = {
      awsRequestId: `scheduled-${Date.now()}-${Math.random()
        .toString(36)
        .substring(7)}`,
    } as Context;

    // Augment context with workspace credit transaction capability
    // Database will be lazy-loaded only if workspace credit transactions are actually used
    const augmentedContext = augmentContextWithCreditTransactions(mockContext);

    // Wrap user handler to pass augmented context
    // Scheduled handlers normally don't receive context from AWS,
    // but we can still pass our augmented mockContext as a second
    // argument so user handlers can opt in to using it.
    const wrappedHandler = async (e: ScheduledEvent) => {
      // Pass the augmented context as a second parameter
      // Handlers can opt in by accepting a second Context parameter
      await userHandler(e, augmentedContext);
    };

    let hadError = false;
    try {
      await wrappedHandler(event);
    } catch (error) {
      hadError = true;
      const boomed = boomify(ensureError(error));

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

      // Re-throw the error so Lambda marks the invocation as failed
      throw error;
    } finally {
      // Commit workspace credit transactions (only on success, no errors)
      try {
        await commitContextTransactions(mockContext, hadError);
      } catch (commitError) {
        // Commit failures cause handler to fail (per user requirement)
        console.error(
          "[handlingScheduledErrors] Failed to commit credit transactions:",
          commitError
        );
        // eslint-disable-next-line no-unsafe-finally
        throw commitError;
      }

      // Flush Sentry and PostHog events before Lambda terminates (critical for Lambda)
      // This ensures flushing happens on both success and error paths
      await Promise.all([flushPostHog(), flushSentry()]).catch(
        (flushErrors) => {
          console.error("[PostHog/Sentry] Error flushing events:", flushErrors);
        }
      );
    }
  };
};
