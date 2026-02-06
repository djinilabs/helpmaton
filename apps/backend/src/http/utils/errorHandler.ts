import { boomify } from "@hapi/boom";
import type { ErrorRequestHandler } from "express";

import { initSentry, Sentry, flushSentry, ensureError } from "../../utils/sentry";

// Initialize Sentry when this module is loaded
initSentry();

/**
 * Express error handler middleware that:
 * - Returns user errors (4xx) as-is from boom errors
 * - Logs and returns server errors (5xx) with proper status codes from boom errors
 */
export const expressErrorHandler: ErrorRequestHandler = async (
  error: unknown,
  req,
  res,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next
) => {
  // First, boomify the error (defensive - in case error wasn't already boomified)
  const boomError = boomify(ensureError(error));

  // Then, log the error
  console.error("[Express Error Handler] Error caught:", {
    method: req.method,
    path: req.path,
    url: req.url,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    boom: {
      statusCode: boomError.output.statusCode,
      message: boomError.message,
      isServer: boomError.isServer,
    },
  });

  // If it's a server error (5xx), log additional details and report to Sentry (unless route asked to skip)
  if (boomError.isServer) {
    console.error("[Express Error Handler] Server error details:", boomError);
    if (!req.skipSentryCapture) {
      Sentry.captureException(ensureError(error), {
        tags: {
          handler: "Express",
          method: req.method,
          path: req.path,
          statusCode: boomError.output.statusCode,
        },
        contexts: {
          request: {
            method: req.method,
            url: req.url,
            path: req.path,
          },
        },
      });
      // Flush Sentry events before responding (critical for Lambda)
      try {
        await flushSentry();
      } catch (flushError) {
        console.error("[Sentry] Error flushing events:", flushError);
      }
    }
  } else {
    console.warn("[Express Error Handler] Client error:", boomError);
  }

  // Finally, set the response appropriately
  const { statusCode, payload } = boomError.output;
  res.status(statusCode).json(payload);
};

