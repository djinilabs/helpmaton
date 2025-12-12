/**
 * Subscription Status Utilities
 * Helper functions for checking subscription status and handling grace periods
 */

import { database } from "../tables";
import type { SubscriptionRecord } from "../tables/schema";

import { sendSubscriptionDowngradedEmail } from "./subscriptionEmails";
import type { SubscriptionPlan } from "./subscriptionPlans";
import { getUserEmailById } from "./subscriptionUtils";

/**
 * Check if subscription is currently active
 * A subscription is active if:
 * - Status is "active" or "on_trial"
 * - Not cancelled
 * - Not expired
 * - Not past grace period
 */
export function isSubscriptionActive(
  subscription: SubscriptionRecord
): boolean {
  // Free plans are always active (they don't have Lemon Squeezy status)
  if (
    subscription.plan === "free" &&
    !subscription.lemonSqueezySubscriptionId
  ) {
    return true;
  }

  // Check if subscription has ended (check endsAt first, before status)
  if (subscription.endsAt) {
    const endsAt = new Date(subscription.endsAt);
    if (endsAt < new Date()) {
      return false;
    }
  }

  // Check if past grace period
  if (subscription.gracePeriodEndsAt) {
    const gracePeriodEnd = new Date(subscription.gracePeriodEndsAt);
    if (gracePeriodEnd < new Date()) {
      return false;
    }
  }

  // Check status - cancelled subscriptions remain active until endsAt
  // expired subscriptions are always inactive
  if (subscription.status === "expired") {
    return false;
  }

  // Cancelled subscriptions are active until endsAt (checked above)
  // If endsAt is not set, cancelled subscriptions are immediately inactive
  if (subscription.status === "cancelled" && !subscription.endsAt) {
    return false;
  }

  // Allow access during grace period for past_due subscriptions
  // past_due subscriptions should remain active until grace period expires
  return (
    subscription.status === "active" ||
    subscription.status === "on_trial" ||
    subscription.status === "past_due"
  );
}

/**
 * Get effective plan for a subscription
 * Returns "free" if subscription is expired, cancelled, or past grace period
 * Note: Cancelled subscriptions show as "free" immediately, even if they still have access until endsAt
 */
export function getEffectivePlan(
  subscription: SubscriptionRecord
): SubscriptionPlan {
  // Cancelled subscriptions show as "free" immediately (even if still active until endsAt)
  if (subscription.status === "cancelled") {
    return "free";
  }

  if (!isSubscriptionActive(subscription)) {
    return "free";
  }

  return subscription.plan;
}

/**
 * Check if grace period warning email should be sent
 * Sends warning 3 days before grace period expires
 */
export function shouldSendGracePeriodWarning(
  subscription: SubscriptionRecord
): boolean {
  if (!subscription.gracePeriodEndsAt) {
    return false;
  }

  const gracePeriodEnd = new Date(subscription.gracePeriodEndsAt);
  const now = new Date();
  const daysRemaining = Math.ceil(
    (gracePeriodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Send warning if 3 days or less remaining
  return daysRemaining <= 3 && daysRemaining > 0;
}

/**
 * Check grace period and downgrade if expired
 * Also sends email notification if downgraded
 */
export async function checkGracePeriod(
  subscription: SubscriptionRecord
): Promise<void> {
  if (!subscription.gracePeriodEndsAt) {
    return;
  }

  const gracePeriodEnd = new Date(subscription.gracePeriodEndsAt);
  const now = new Date();

  // If grace period has expired, downgrade to free
  if (gracePeriodEnd < now) {
    const db = await database();

    // Update subscription to free plan
    await db.subscription.update({
      ...subscription,
      plan: "free",
      status: "expired",
      gracePeriodEndsAt: undefined,
      lemonSqueezySubscriptionId: undefined,
      lemonSqueezyCustomerId: undefined,
      lemonSqueezyVariantId: undefined,
      lemonSqueezySyncKey: undefined, // Remove from GSI when downgraded to free
      renewsAt: undefined,
      endsAt: undefined,
    });

    // Send downgrade email
    try {
      const userEmail = await getUserEmailById(subscription.userId);
      if (userEmail) {
        await sendSubscriptionDowngradedEmail(subscription, userEmail);
      }
    } catch (error) {
      console.error(
        `[checkGracePeriod] Failed to send downgrade email for subscription ${subscription.pk}:`,
        error
      );
      // Don't throw - email failure shouldn't block the downgrade
    }

    console.log(
      `[checkGracePeriod] Downgraded subscription ${subscription.pk} to free plan due to expired grace period`
    );
  }
}
