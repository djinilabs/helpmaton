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

  // Determine environment from VITE_SENTRY_ENVIRONMENT, VITE_ENV, or MODE
  const environment =
    import.meta.env.VITE_SENTRY_ENVIRONMENT ||
    (import.meta.env.VITE_ENV === "production"
      ? "production"
      : import.meta.env.VITE_ENV === "staging"
        ? "staging"
        : import.meta.env.MODE === "production"
          ? "production"
          : "development");

  // Get release version from build-time environment variable
  // This should match the release version used during the build process
  const release = import.meta.env.VITE_SENTRY_RELEASE || undefined;

  Sentry.init({
    dsn,
    environment,
    release,
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
    // Ignore CefSharp bot errors (e.g. Outlook SafeSearch scanning links).
    // "Object Not Found Matching Id:..., MethodName:..., ParamCount:..." is thrown
    // by CefSharp when bots load the page; not a real user issue.
    // Ignore Android WebView bridge errors (e.g. Facebook in-app browser). When the WebView
    // or injected Java object is destroyed, JS calls into the bridge throw "Java object is gone".
    // This is an environment lifecycle issue, not an app bug.
    ignoreErrors: [
      // CefSharp bot errors (e.g. Outlook SafeSearch); rejection value is the string below
      /Object Not Found Matching Id:\d+, MethodName:\w+, ParamCount:\d+/,
      // Sentry's message for non-Error promise rejections
      /Non-Error promise rejection.*Object Not Found Matching Id:/,
      // Android WebView / in-app browser (e.g. Facebook): Java bridge object destroyed
      /Java object is gone/,
    ],
    // Set sample rate for session replay
    replaysSessionSampleRate: environment === "production" ? 0.1 : 1.0,
    replaysOnErrorSampleRate: 1.0,
  });

  isInitialized = true;
  console.log(`[Sentry] Initialized for environment: ${environment}`);
}

// Export Sentry for direct use
export { Sentry };

