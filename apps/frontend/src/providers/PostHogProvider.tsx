import { useSession } from "next-auth/react";
import { useEffect } from "react";
import { useLocation, useParams } from "react-router-dom";

import { posthog } from "../utils/posthog";
import { identifyWorkspaceGroup } from "../utils/tracking";

/**
 * PostHog Provider component that tracks page views and user interactions
 * Should wrap the app routes to enable automatic tracking
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const params = useParams<{
    id?: string;
    workspaceId?: string;
  }>();
  const { data: session, status } = useSession();

  // Identify user when authenticated (PostHog official approach: identify as soon as we have session
  // so all subsequent capture() calls are attributed to this distinct_id; matches backend user/${id})
  useEffect(() => {
    if (status === "authenticated" && session?.user?.id) {
      if (posthog && typeof posthog.identify === "function") {
        posthog.identify(`user/${session.user.id}`, {
          email: session.user.email || undefined,
        });
      }
    } else if (status === "unauthenticated") {
      if (posthog && typeof posthog.reset === "function") {
        posthog.reset();
      }
    }
  }, [status, session]);

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

  // Identify workspace group when workspace is in URL
  useEffect(() => {
    const workspaceId = params.workspaceId || params.id;
    if (workspaceId && posthog && typeof posthog.group === "function") {
      identifyWorkspaceGroup(workspaceId);
    }
  }, [location.pathname, params.workspaceId, params.id]);

  return <>{children}</>;
}

