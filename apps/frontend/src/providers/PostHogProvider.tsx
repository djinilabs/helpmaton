import { useEffect } from "react";
import { useLocation } from "react-router-dom";

import { posthog } from "../utils/posthog";

/**
 * PostHog Provider component that tracks page views and user interactions
 * Should wrap the app routes to enable automatic tracking
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  // Track page views on route changes
  // PostHog's built-in capture_pageview only tracks initial page load,
  // so we manually track route changes for SPA navigation
  useEffect(() => {
    // Check if PostHog is initialized and loaded
    if (posthog && typeof posthog.capture === "function") {
      posthog.capture("$pageview", {
        $current_url: window.location.href,
        pathname: location.pathname,
      });
    }
  }, [location]);

  // Track page leave events
  // PostHog's built-in capture_pageleave handles this, but we add
  // additional context for better tracking
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (posthog && typeof posthog.capture === "function") {
        posthog.capture("$pageleave", {
          $current_url: window.location.href,
          pathname: location.pathname,
        });
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [location]);

  return <>{children}</>;
}

