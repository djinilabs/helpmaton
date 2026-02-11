import { PostHog } from "posthog-node";

let phClient: PostHog | null = null;

/**
 * Request-scoped user id for PostHog (used to avoid leaking identity across requests in a reused process).
 * Reset at the start of every HTTP handler so events are never attributed to a previous request's user.
 * Stored at module level; safe because Lambda runs one request per invocation (no concurrent requests in the same process).
 */
let currentRequestDistinctId: string | null = null;

/**
 * Reset user identification at the start of every HTTP request.
 * Call this first in request middleware so events in this request are never attributed to a previous request's user.
 */
export function resetPostHogRequestContext(): void {
  currentRequestDistinctId = null;
}

/**
 * Distinct ID for the current request (set when user is identified in this request).
 * Used by trackEvent when req is not passed so endpoints don't need to pass req for attribution.
 */
export function getCurrentRequestDistinctId(): string | null {
  return currentRequestDistinctId;
}

/**
 * Initialize PostHog for analytics tracking in Lambda environment
 * Should be called once at application startup
 * Uses a guard to prevent multiple initializations
 */
export function initPostHog(): PostHog | null {
  // Guard against multiple initializations
  if (phClient) {
    return phClient;
  }

  const apiKey = process.env.POSTHOG_API_KEY;
  const apiHost = process.env.POSTHOG_API_HOST || "https://us.i.posthog.com";

  // Only initialize if API key is provided
  if (!apiKey) {
    console.warn(
      "[PostHog] POSTHOG_API_KEY not provided, PostHog will not be initialized"
    );
    return null;
  }

  // Determine environment from ARC_ENV or NODE_ENV
  const environment =
    process.env.ARC_ENV === "production"
      ? "production"
      : process.env.ARC_ENV === "staging"
      ? "staging"
      : process.env.NODE_ENV === "production"
      ? "production"
      : "development";

  phClient = new PostHog(apiKey, {
    host: apiHost,
  });

  console.log(`[PostHog] Initialized for environment: ${environment}`);
  return phClient;
}

/**
 * Get the PostHog client instance
 * Initializes if not already initialized
 */
export function getPostHogClient(): PostHog | null {
  if (!phClient) {
    return initPostHog();
  }
  return phClient;
}

/**
 * Flush PostHog events with a timeout to ensure events are sent before Lambda terminates
 * @param timeoutMs Maximum time to wait for flush (default: 2000ms)
 */
export async function flushPostHog(timeoutMs = 2000): Promise<void> {
  if (!phClient) {
    return;
  }

  try {
    await Promise.race([
      phClient.shutdown(),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  } catch (error) {
    console.error("[PostHog] Error flushing events:", error);
  }
}

/**
 * Identify a user in PostHog (official approach for attribution)
 * Uses consistent `user/${userId}` as distinct_id so all capture() calls with
 * the same id are attributed to this person. Must match frontend identify().
 * @param userId - User ID (without prefix)
 * @param properties - Optional person properties (include email for correlation)
 */
export function identifyUser(
  userId: string,
  properties?: Record<string, unknown>
): void {
  if (!phClient) {
    return;
  }

  try {
    const distinctId = `user/${userId}`;
    currentRequestDistinctId = distinctId;
    phClient.identify({
      distinctId,
      properties: properties || {},
    });
  } catch (error) {
    console.error("[PostHog] Error identifying user:", error);
  }
}

/**
 * Update PostHog person with current subscription plan (for analytics segmentation).
 * Call after subscription create/update/sync so plan is reflected in PostHog.
 * @param userId - User ID (without prefix)
 * @param plan - Plan name (e.g. "starter", "pro", "free")
 */
export function updatePostHogUserSubscriptionPlan(
  userId: string,
  plan: string,
): void {
  identifyUser(userId, { subscription_plan: plan });
}

/**
 * Identify a workspace as a group in PostHog
 * @param workspaceId - Workspace ID
 * @param properties - Workspace properties (member_count, agent_count, subscription_tier, etc.)
 */
export function identifyWorkspaceGroup(
  workspaceId: string,
  properties?: Record<string, unknown>
): void {
  if (!phClient) {
    return;
  }

  try {
    phClient.groupIdentify({
      groupType: "workspace",
      groupKey: workspaceId,
      properties: properties || {},
    });
  } catch (error) {
    console.error("[PostHog] Error identifying workspace group:", error);
  }
}
