import { extractUserId } from "../http/utils/session";

import { getPostHogClient, identifyUser, identifyWorkspaceGroup } from "./posthog";

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
 * Extract user ID from request and identify in PostHog
 * @param req - Request object with userRef or session
 * @returns User ID or undefined
 */
function identifyUserFromRequest(req: {
  userRef?: string;
  session?: { user?: { id?: string } };
}): string | undefined {
  const userId = extractUserId(req);
  if (userId) {
    identifyUser(userId);
  }
  return userId;
}

/**
 * Track a custom event in PostHog (backend)
 * Automatically identifies user and includes context
 * @param eventName - Name of the event (snake_case format: feature_action)
 * @param properties - Event properties (workspace_id, agent_id, etc.)
 * @param req - Optional request object for user identification
 */
export function trackEvent(
  eventName: string,
  properties?: TrackingProperties,
  req?: {
    userRef?: string;
    session?: { user?: { id?: string } };
  }
): void {
  const phClient = getPostHogClient();
  if (!phClient) {
    // PostHog not initialized
    return;
  }

  try {
    // Identify user if request is provided
    let userId: string | undefined;
    if (req) {
      userId = identifyUserFromRequest(req);
    } else if (properties?.user_id) {
      // If user_id is in properties, identify user
      identifyUser(properties.user_id);
      userId = properties.user_id;
    }

    // Determine environment
    const environment =
      properties?.environment ||
      (process.env.ARC_ENV === "production"
        ? "production"
        : process.env.ARC_ENV === "staging"
          ? "staging"
          : process.env.NODE_ENV === "production"
            ? "production"
            : "development");

    // Identify workspace group if workspace_id is provided
    if (properties?.workspace_id) {
      identifyWorkspaceGroup(properties.workspace_id, {
        subscription_tier: properties.subscription_tier,
      });
    }

    // Capture event with distinct ID
    const distinctId = userId ? `user/${userId}` : "system";

    phClient.capture({
      distinctId,
      event: eventName,
      properties: {
        ...properties,
        environment,
        // Ensure user_id is included if we have it
        user_id: userId || properties?.user_id,
      },
      groups: properties?.workspace_id
        ? { workspace: properties.workspace_id }
        : undefined,
    });
  } catch (error) {
    // Silently fail - don't break the app if tracking fails
    console.error("[Tracking] Error tracking event:", error);
  }
}

/**
 * Track business event with standardized properties
 * @param feature - Feature name (e.g., "agent", "document")
 * @param action - Action performed (e.g., "created", "updated")
 * @param properties - Additional properties
 * @param req - Optional request object for user identification
 */
export function trackBusinessEvent(
  feature: string,
  action: string,
  properties?: TrackingProperties,
  req?: {
    userRef?: string;
    session?: { user?: { id?: string } };
  }
): void {
  const eventName = `${feature}_${action}`;
  trackEvent(eventName, properties, req);
}

/**
 * Track errors with context
 * @param error - Error object or message
 * @param context - Additional context (feature, workspace, etc.)
 * @param req - Optional request object for user identification
 */
export function trackError(
  error: Error | string,
  context?: TrackingProperties,
  req?: {
    userRef?: string;
    session?: { user?: { id?: string } };
  }
): void {
  const errorMessage = error instanceof Error ? error.message : error;
  const errorType = error instanceof Error ? error.constructor.name : "Unknown";

  trackEvent(
    "error_occurred",
    {
      ...context,
      error_message: errorMessage,
      error_type: errorType,
      error_stack: error instanceof Error ? error.stack : undefined,
    },
    req
  );
}

