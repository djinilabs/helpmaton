import {
  checkDailyRequestLimit,
  incrementRequestBucket,
} from "../../utils/requestTracking";
import { Sentry, ensureError } from "../../utils/sentry";
import {
  checkFreePlanExpiration,
  getWorkspaceSubscription,
} from "../../utils/subscriptionUtils";

import type { GenerationEndpoint } from "./generationErrorHandling";

/**
 * Validates subscription and plan limits before processing request
 * Returns subscription ID if found
 */
export async function validateSubscriptionAndLimits(
  workspaceId: string,
  endpoint: GenerationEndpoint
): Promise<string | undefined> {
  // Check if free plan has expired (block agent execution if expired)
  await checkFreePlanExpiration(workspaceId);

  // Check daily request limit before LLM call
  // Note: This is a soft limit - there's a small race condition window where
  // concurrent requests near the limit could all pass the check before incrementing.
  // This is acceptable as a user experience limit, not a security boundary.
  const subscription = await getWorkspaceSubscription(workspaceId);
  const subscriptionId = subscription
    ? subscription.pk.replace("subscriptions/", "")
    : undefined;
  if (subscriptionId) {
    console.log(`[${endpoint} Handler] Found subscription:`, subscriptionId);
    await checkDailyRequestLimit(subscriptionId);
  } else {
    console.warn(
      `[${endpoint} Handler] No subscription found for workspace:`,
      workspaceId
    );
  }

  return subscriptionId;
}

/**
 * Tracks successful LLM request by incrementing request bucket
 */
export async function trackSuccessfulRequest(
  subscriptionId: string | undefined,
  workspaceId: string,
  agentId: string,
  endpoint: GenerationEndpoint
): Promise<void> {
  if (!subscriptionId) {
    console.warn(
      `[${endpoint} Handler] Skipping request bucket increment - no subscription ID:`,
      { workspaceId, agentId }
    );
    return;
  }

  try {
    console.log(
      `[${endpoint} Handler] Incrementing request bucket for subscription:`,
      subscriptionId
    );
    await incrementRequestBucket(subscriptionId);
    console.log(
      `[${endpoint} Handler] Successfully incremented request bucket:`,
      subscriptionId
    );
  } catch (error) {
    // Log error but don't fail the request
    console.error(
      `[${endpoint} Handler] Error incrementing request bucket:`,
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        workspaceId,
        agentId,
        subscriptionId,
      }
    );
    // Report to Sentry
    Sentry.captureException(ensureError(error), {
      tags: {
        endpoint,
        operation: "request_tracking",
      },
      extra: {
        workspaceId,
        agentId,
        subscriptionId,
      },
    });
  }
}

