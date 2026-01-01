import * as Sentry from "@sentry/node";

let isInitialized = false;

/**
 * Initialize Sentry for error tracking in Lambda environment
 * Should be called once at application startup
 * Uses a guard to prevent multiple initializations
 */
export function initSentry(): void {
  // Guard against multiple initializations
  if (isInitialized) {
    return;
  }

  const dsn = process.env.SENTRY_DSN;

  // Only initialize if DSN is provided
  if (!dsn) {
    console.warn(
      "[Sentry] SENTRY_DSN not provided, Sentry will not be initialized"
    );
    return;
  }

  // Determine environment from ARC_ENV or NODE_ENV
  const environment =
    process.env.ARC_ENV === "production"
      ? "production"
      : process.env.ARC_ENV === "staging"
      ? "staging"
      : process.env.NODE_ENV === "production"
      ? "production"
      : "development";

  Sentry.init({
    dsn,
    environment,
    // Enable source maps for better error reporting
    integrations: [
      // Automatically instrument Node.js modules
      Sentry.httpIntegration(),
      Sentry.consoleIntegration(),
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.onUnhandledRejectionIntegration(),
    ],
    // Set tracesSampleRate to 1.0 to capture 100% of transactions for performance monitoring
    // Adjust this value in production
    tracesSampleRate: environment === "production" ? 0.1 : 1.0,
  });

  isInitialized = true;
  console.log(`[Sentry] Initialized for environment: ${environment}`);
}

/**
 * Helper function to ensure error is an Error instance
 */
export function ensureError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string") {
    return new Error(error);
  }
  console.warn("[Sentry] Unknown error type:", typeof error, error);
  return new Error(String(error));
}

/**
 * Flush Sentry events with a timeout to ensure events are sent before Lambda terminates
 * @param timeoutMs Maximum time to wait for flush (default: 2000ms)
 */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  try {
    await Promise.race([
      Sentry.flush(timeoutMs),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  } catch (error) {
    console.error("[Sentry] Error flushing events:", error);
  }
}

// Export Sentry for direct use
export { Sentry };
