import { posthog } from "./posthog";

/**
 * Type-safe event properties
 */
export interface TrackingProperties {
  workspace_id?: string;
  agent_id?: string;
  user_id?: string;
  environment?: string;
  subscription_tier?: string;
  [key: string]: unknown;
}

/**
 * Track a custom event in PostHog
 * @param eventName - Name of the event (snake_case format: feature_action)
 * @param properties - Event properties (workspace_id, agent_id, etc.)
 */
export function trackEvent(
  eventName: string,
  properties?: TrackingProperties
): void {
  if (!posthog || typeof posthog.capture !== "function") {
    // PostHog not initialized or not available
    if (import.meta.env.DEV) {
      console.log("[Tracking] Event not tracked (PostHog not available):", {
        eventName,
        properties,
      });
    }
    return;
  }

  try {
    // Add environment if not provided
    const env =
      properties?.environment ||
      (import.meta.env.VITE_ENV === "production"
        ? "production"
        : import.meta.env.VITE_ENV === "staging"
          ? "staging"
          : import.meta.env.MODE === "production"
            ? "production"
            : "development");

    posthog.capture(eventName, {
      ...properties,
      environment: env,
    });
  } catch (error) {
    // Silently fail - don't break the app if tracking fails
    console.error("[Tracking] Error tracking event:", error);
  }
}

/**
 * Track feature usage with standardized properties
 * @param feature - Feature name (e.g., "agent", "document")
 * @param action - Action performed (e.g., "created", "updated")
 * @param properties - Additional properties
 */
export function trackFeatureUsage(
  feature: string,
  action: string,
  properties?: TrackingProperties
): void {
  const eventName = `${feature}_${action}`;
  trackEvent(eventName, properties);
}

/**
 * Track errors with context
 * @param error - Error object or message
 * @param context - Additional context (feature, workspace, etc.)
 */
export function trackError(
  error: Error | string,
  context?: TrackingProperties
): void {
  const errorMessage = error instanceof Error ? error.message : error;
  const errorType = error instanceof Error ? error.constructor.name : "Unknown";

  trackEvent("error_occurred", {
    ...context,
    error_message: errorMessage,
    error_type: errorType,
    error_stack: error instanceof Error ? error.stack : undefined,
  });
}

/**
 * Track workspace group identification
 * @param workspaceId - Workspace ID
 * @param properties - Workspace properties (member_count, agent_count, subscription_tier, etc.)
 */
export function identifyWorkspaceGroup(
  workspaceId: string,
  properties?: Record<string, unknown>
): void {
  if (!posthog || typeof posthog.group !== "function") {
    return;
  }

  try {
    // PostHog JS uses group() method for group identification
    posthog.group("workspace", workspaceId, properties || {});
  } catch (error) {
    console.error("[Tracking] Error identifying workspace group:", error);
  }
}

