import { useSession } from "next-auth/react";
import { useEffect } from "react";
import { useLocation, useParams } from "react-router-dom";

import { posthog } from "../utils/posthog";
import { shouldAliasBeforeIdentify } from "../utils/posthogIdentity";
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
  const userId = session?.user?.id;
  const userEmail = session?.user?.email;

  // Identify user when authenticated. Alias first when coming from anonymous so PostHog
  // merges the pre-sign-in profile into the identified user (single profile per user).
  useEffect(() => {
    if (status === "authenticated" && userId) {
      if (posthog && typeof posthog.identify === "function") {
        const newId = `user/${userId}`;
        let currentId: string | null = null;
        if (typeof posthog.get_distinct_id === "function") {
          try {
            currentId = posthog.get_distinct_id();
          } catch {
            // ignore; we will identify without aliasing
          }
        }
        if (
          shouldAliasBeforeIdentify(currentId, userId) &&
          typeof posthog.alias === "function"
        ) {
          posthog.alias(newId);
        }
        posthog.identify(newId, {
          email: userEmail || undefined,
        });
      }
    } else if (status === "unauthenticated") {
      if (posthog && typeof posthog.reset === "function") {
        posthog.reset();
      }
    }
  }, [status, userId, userEmail]);

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

