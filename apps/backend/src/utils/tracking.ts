import { extractUserId } from "../http/utils/session";

import {
  getCurrentRequestDistinctId,
  getPostHogClient,
  identifyUser,
  identifyWorkspaceGroup,
} from "./posthog";

/**
 * Type-safe event properties
 */
export interface TrackingProperties {
  workspace_id?: string;
  agent_id?: string;
  user_id?: string;
  user_email?: string;
  environment?: string;
  subscription_tier?: string;
  [key: string]: unknown;
}

export type RequestWithUser = {
  userRef?: string;
  session?: { user?: { id?: string; email?: string | null } };
};

/**
 * Single place for request-based PostHog user identification.
 * Call this from auth middleware after setting req.userRef/session so all tracking in that request
 * is attributed to the user without each endpoint passing req to trackEvent/trackBusinessEvent.
 */
export function ensurePostHogIdentityFromRequest(req: RequestWithUser): void {
  const userId = extractUserId(req);
  const userEmail = req.session?.user?.email || undefined;
  if (userId) {
    identifyUser(userId, userEmail ? { email: userEmail } : undefined);
  }
}

/**
 * Track a custom event in PostHog (backend)
 * User identification is centralized: auth middleware calls ensurePostHogIdentityFromRequest(req),
 * so in authenticated routes you usually only need trackEvent(name, properties) and the user is
 * attributed from request context. Pass req only when the handler has req and didn't go through
 * that middleware, or pass properties.user_id for non-request flows (e.g. webhooks).
 *
 * @param eventName - Name of the event (snake_case format: feature_action)
 * @param properties - Event properties (workspace_id, agent_id, etc.)
 * @param req - Optional; omit when auth middleware already ran (user taken from request context)
 *
 * Event checklist:
 * - Always include `workspace_id` for workspace-scoped actions
 * - Include `agent_id` when the action targets a specific agent
 * - Include `user_id` for system or admin-triggered events when known
 * - Include `subscription_tier` for billing/limits-related actions
 * - Use backend tracking for webhook/async flows to avoid client loss
 */
export function trackEvent(
  eventName: string,
  properties?: TrackingProperties,
  req?: RequestWithUser
): void {
  const phClient = getPostHogClient();
  if (!phClient) {
    // PostHog not initialized
    return;
  }

  try {
    // Identify user: from req, from properties.user_id, or from request context (set by auth middleware)
    let userId: string | undefined;
    let userEmail: string | undefined;
    if (req) {
      userId = extractUserId(req);
      userEmail = req.session?.user?.email || undefined;
      const alreadySet = getCurrentRequestDistinctId();
      if (userId && alreadySet !== `user/${userId}`) {
        identifyUser(userId, userEmail ? { email: userEmail } : undefined);
      }
    } else if (properties?.user_id) {
      userEmail = properties.user_email;
      identifyUser(
        properties.user_id,
        userEmail ? { email: userEmail } : undefined
      );
      userId = properties.user_id;
    } else {
      const requestDistinctId = getCurrentRequestDistinctId();
      if (requestDistinctId?.startsWith("user/")) {
        userId = requestDistinctId.slice(5);
      }
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

    // Capture event with distinct ID (user from req, properties, or request context)
    const distinctId = userId
      ? `user/${userId}`
      : getCurrentRequestDistinctId() ?? "system";

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
 * User is attributed from request context when auth middleware ran; pass req only when needed.
 */
export function trackBusinessEvent(
  feature: string,
  action: string,
  properties?: TrackingProperties,
  req?: RequestWithUser
): void {
  const eventName = `${feature}_${action}`;
  trackEvent(eventName, properties, req);
}

/**
 * Track errors with context
 */
export function trackError(
  error: Error | string,
  context?: TrackingProperties,
  req?: RequestWithUser
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

