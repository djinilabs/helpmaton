/**
 * Scheduled Lambda to sync subscription status from Lemon Squeezy
 * Runs every hour to keep subscription data up to date
 */

import type { ScheduledEvent } from "aws-lambda";

import { database } from "../../tables";
import type { SubscriptionRecord } from "../../tables/schema";
import { handlingScheduledErrors } from "../../utils/handlingErrors";
import { getSubscription as getLemonSqueezySubscription } from "../../utils/lemonSqueezy";
import { sendGracePeriodExpiringEmail } from "../../utils/subscriptionEmails";
import {
  checkGracePeriod,
  shouldSendGracePeriodWarning,
} from "../../utils/subscriptionStatus";
import { getUserEmailById } from "../../utils/subscriptionUtils";
/**
 * Map Lemon Squeezy variant ID to plan
 */
function variantIdToPlan(variantId: string): "starter" | "pro" {
  const starterVariantId = process.env.LEMON_SQUEEZY_STARTER_VARIANT_ID;
  const proVariantId = process.env.LEMON_SQUEEZY_PRO_VARIANT_ID;

  if (variantId === starterVariantId) {
    return "starter";
  }
  if (variantId === proVariantId) {
    return "pro";
  }

  // Default to starter if variant ID doesn't match
  console.warn(`[Sync] Unknown variant ID ${variantId}, defaulting to starter`);
  return "starter";
}

/**
 * Sync a single subscription from Lemon Squeezy
 */
async function syncSubscription(
  subscription: SubscriptionRecord
): Promise<void> {
  if (!subscription.lemonSqueezySubscriptionId) {
    // Skip subscriptions without Lemon Squeezy ID
    return;
  }

  const db = await database();

  try {
    // Fetch latest data from Lemon Squeezy
    const lemonSqueezySub = await getLemonSqueezySubscription(
      subscription.lemonSqueezySubscriptionId!
    );
    const attributes = lemonSqueezySub.attributes;

    // Determine plan from variant ID
    const plan = variantIdToPlan(String(attributes.variant_id));

    // Update subscription record with latest data from Lemon Squeezy
    const updatedSubscription = await db.subscription.update({
      ...subscription,
      plan,
      status: attributes.status as
        | "active"
        | "past_due"
        | "unpaid"
        | "cancelled"
        | "expired"
        | "on_trial",
      renewsAt: attributes.renews_at,
      endsAt: attributes.ends_at || undefined,
      trialEndsAt: attributes.trial_ends_at || undefined,
      lemonSqueezyVariantId: String(attributes.variant_id),
      lemonSqueezySyncKey: "ACTIVE", // Maintain GSI key for sync
      lastSyncedAt: new Date().toISOString(),
    });

    // Check grace period
    await checkGracePeriod(updatedSubscription);

    // Check if grace period warning should be sent
    if (shouldSendGracePeriodWarning(updatedSubscription)) {
      const gracePeriodEnd = new Date(updatedSubscription.gracePeriodEndsAt!);
      const now = new Date();
      const daysRemaining = Math.ceil(
        (gracePeriodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Only send if we haven't sent recently (avoid duplicate emails)
      const lastSent = updatedSubscription.lastPaymentEmailSentAt
        ? new Date(updatedSubscription.lastPaymentEmailSentAt)
        : null;
      const hoursSinceLastSent = lastSent
        ? (now.getTime() - lastSent.getTime()) / (1000 * 60 * 60)
        : Infinity;

      // Send warning if more than 24 hours since last email
      if (hoursSinceLastSent > 24) {
        try {
          const userEmail = await getUserEmailById(subscription.userId);
          if (userEmail) {
            await sendGracePeriodExpiringEmail(
              updatedSubscription,
              userEmail,
              daysRemaining
            );
            await db.subscription.update({
              ...updatedSubscription,
              lastPaymentEmailSentAt: new Date().toISOString(),
            });
          }
        } catch (error) {
          console.error(
            `[Sync] Failed to send grace period warning email for subscription ${subscription.pk}:`,
            error
          );
          // Don't throw - email failure shouldn't block sync
        }
      }
    }

    console.log(
      `[Sync] Synced subscription ${subscription.pk} from Lemon Squeezy`
    );
  } catch (error) {
    console.error(
      `[Sync] Error syncing subscription ${subscription.pk}:`,
      error
    );
    // Don't throw - continue with other subscriptions
  }
}

/**
 * Main sync function
 * Queries all subscriptions with Lemon Squeezy IDs using the byLemonSqueezySubscription GSI
 */
async function syncAllSubscriptions(): Promise<void> {
  console.log("[Sync] Starting subscription sync from Lemon Squeezy");

  const db = await database();

  // Query all subscriptions with Lemon Squeezy IDs using the GSI
  // The GSI uses lemonSqueezySyncKey = "ACTIVE" as the partition key
  // to efficiently query all subscriptions that have Lemon Squeezy integration
  let subscriptionCount = 0;

  try {
    // Use queryAsync to iterate through all subscriptions with Lemon Squeezy IDs
    // This uses the byLemonSqueezySubscription GSI which indexes subscriptions
    // where lemonSqueezySyncKey = "ACTIVE"
    for await (const subscription of db.subscription.queryAsync({
      IndexName: "byLemonSqueezySubscription",
      KeyConditionExpression: "lemonSqueezySyncKey = :syncKey",
      ExpressionAttributeValues: {
        ":syncKey": "ACTIVE",
      },
    })) {
      // Only sync subscriptions that actually have a Lemon Squeezy subscription ID
      // (defensive check in case the GSI key is set but the ID is missing)
      if (subscription.lemonSqueezySubscriptionId) {
        await syncSubscription(subscription);
        subscriptionCount++;
      }
    }

    console.log(
      `[Sync] Processed ${subscriptionCount} subscriptions with Lemon Squeezy IDs`
    );
  } catch (error) {
    console.error("[Sync] Error querying subscriptions:", error);
    // Don't throw - log the error but allow the function to complete
    // This prevents the scheduled job from failing completely
  }

  console.log("[Sync] Completed subscription sync");
}

/**
 * Lambda handler
 */
export const handler = handlingScheduledErrors(
  async (event: ScheduledEvent): Promise<void> => {
    console.log("[Sync] Scheduled event received:", event);
    await syncAllSubscriptions();
  }
);



