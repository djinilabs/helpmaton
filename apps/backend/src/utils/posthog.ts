import { PostHog } from "posthog-node";

let phClient: PostHog | null = null;

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
 * Identify a user in PostHog
 * Uses consistent `user/${userId}` format to match frontend identification
 * @param userId - User ID (without prefix)
 * @param properties - Optional user properties (include email for correlation)
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
    phClient.identify({
      distinctId,
      properties: properties || {},
    });
  } catch (error) {
    console.error("[PostHog] Error identifying user:", error);
  }
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
