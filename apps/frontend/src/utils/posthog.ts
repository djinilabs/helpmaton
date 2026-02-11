import posthogLib from "posthog-js";

let isInitialized = false;

/**
 * Initialize PostHog for analytics tracking in React app
 * Should be called once at application startup
 * Uses a guard to prevent multiple initializations (important for React StrictMode)
 */
export function initPostHog(): void {
  // Guard against multiple initializations
  if (isInitialized) {
    return;
  }

  const apiKey = import.meta.env.VITE_POSTHOG_API_KEY;
  const apiHost = import.meta.env.VITE_POSTHOG_API_HOST || "https://us.i.posthog.com";

  // Only initialize if API key is provided
  if (!apiKey) {
    console.warn("[PostHog] VITE_POSTHOG_API_KEY not provided, PostHog will not be initialized");
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

  posthogLib.init(apiKey, {
    api_host: apiHost,
    // Enable automatic pageview tracking
    loaded: (ph) => {
      if (import.meta.env.DEV) {
        ph.debug(); // Enable debug mode in development
      }
      // Register environment as a property
      ph.register({
        environment,
      });
    },
    // Capture pageviews automatically
    capture_pageview: true,
    // Capture pageleaves automatically
    capture_pageleave: true,
    // Enable session recording (optional, can be disabled if not needed)
    disable_session_recording: false,
    // Enable autocapture for user interactions
    autocapture: true,
    // Mask all element text in autocapture (avoids PII e.g. email in forms before identify).
    // Tradeoff: no text from any element is sent (labels, links, etc.), not just inputs.
    mask_all_text: true,
    // Persist user across sessions
    persistence: "localStorage+cookie",
  });

  isInitialized = true;
  console.log(`[PostHog] Initialized for environment: ${environment}`);
}

// Export PostHog for direct use
export const posthog = posthogLib;

