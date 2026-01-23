import * as Sentry from "@sentry/aws-serverless";

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

  // Determine environment from SENTRY_ENVIRONMENT, ARC_ENV, or NODE_ENV
  const environment =
    process.env.SENTRY_ENVIRONMENT ||
    (process.env.ARC_ENV === "production"
      ? "production"
      : process.env.ARC_ENV === "staging"
      ? "staging"
      : process.env.NODE_ENV === "production"
      ? "production"
      : "development");

  // Get release version from environment variable (typically GITHUB_SHA in CI/CD)
  // Falls back to undefined if not set (Sentry will work without it)
  const release =
    process.env.SENTRY_RELEASE || process.env.GITHUB_SHA || undefined;

  const tracesSampleRate = getTracesSampleRate(environment);
  const dist = process.env.SENTRY_DIST || undefined;

  Sentry.init({
    dsn,
    environment,
    release, // Add release configuration
    dist,
    // Enable source maps for better error reporting
    integrations: [
      Sentry.awsLambdaIntegration(),
      Sentry.awsIntegration(),
      // Automatically instrument Node.js modules
      Sentry.httpIntegration(),
      Sentry.consoleIntegration(),
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.onUnhandledRejectionIntegration(),
    ],
    // Production-only tracing with 100% sampling by default
    tracesSampleRate,
  });

  isInitialized = true;
  console.log(
    `[Sentry] Initialized for environment: ${environment}${
      release ? `, release: ${release}` : ""
    }`
  );
}

function getTracesSampleRate(environment: string): number {
  if (environment !== "production") {
    return 0;
  }

  const rawSampleRate = process.env.SENTRY_TRACES_SAMPLE_RATE;
  if (!rawSampleRate) {
    return 1.0;
  }

  const parsed = Number(rawSampleRate);
  if (Number.isNaN(parsed)) {
    console.warn(
      `[Sentry] Invalid SENTRY_TRACES_SAMPLE_RATE "${rawSampleRate}", defaulting to 1.0`
    );
    return 1.0;
  }

  return parsed;
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
