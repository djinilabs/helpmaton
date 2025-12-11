import * as Sentry from "@sentry/react";
import { browserTracingIntegration, replayIntegration } from "@sentry/react";

let isInitialized = false;

/**
 * Initialize Sentry for error tracking in React app
 * Should be called once at application startup
 * Uses a guard to prevent multiple initializations (important for React StrictMode)
 */
export function initSentry(): void {
  // Guard against multiple initializations
  if (isInitialized) {
    return;
  }

  const dsn = import.meta.env.VITE_SENTRY_DSN;

  // Only initialize if DSN is provided
  if (!dsn) {
    console.warn("[Sentry] VITE_SENTRY_DSN not provided, Sentry will not be initialized");
    return;
  }

  // Determine environment from VITE_ENV or MODE
  const environment =
    import.meta.env.VITE_ENV === "production"
      ? "production"
      : import.meta.env.VITE_ENV === "staging"
        ? "staging"
        : import.meta.env.MODE === "production"
          ? "production"
          : "development";

  Sentry.init({
    dsn,
    environment,
    integrations: [
      browserTracingIntegration(),
      replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    // Set tracesSampleRate to 1.0 to capture 100% of transactions for performance monitoring
    // Adjust this value in production
    tracesSampleRate: environment === "production" ? 0.1 : 1.0,
    // Set sample rate for session replay
    replaysSessionSampleRate: environment === "production" ? 0.1 : 1.0,
    replaysOnErrorSampleRate: 1.0,
  });

  isInitialized = true;
  console.log(`[Sentry] Initialized for environment: ${environment}`);
}

// Export Sentry for direct use
export { Sentry };

