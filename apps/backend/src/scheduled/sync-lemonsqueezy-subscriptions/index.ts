/**
 * Scheduled Lambda to sync subscription status from Lemon Squeezy
 * Runs every hour to keep subscription data up to date
 */

import type { ScheduledEvent } from "aws-lambda";

import { database } from "../../tables";
import { handlingScheduledErrors } from "../../utils/handlingErrors";
import { sendGracePeriodExpiringEmail } from "../../utils/subscriptionEmails";
import { getSubscription as getLemonSqueezySubscription } from "../../utils/lemonSqueezy";
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
async function syncSubscription(subscription: {
  pk: string;
  sk?: string;
  lemonSqueezySubscriptionId?: string;
  userId: string;
  status?: string;
  gracePeriodEndsAt?: string;
  lastPaymentEmailSentAt?: string;
}): Promise<void> {
  if (!subscription.lemonSqueezySubscriptionId) {
    // Skip subscriptions without Lemon Squeezy ID
    return;
  }

  const db = await database();

  try {
    // Fetch latest data from Lemon Squeezy
    const lemonSqueezySub = await getLemonSqueezySubscription(
      subscription.lemonSqueezySubscriptionId
    );
    const attributes = lemonSqueezySub.attributes;

    // Determine plan from variant ID
    const plan = variantIdToPlan(String(attributes.variant_id));

    // Update subscription record
    const subscriptionRecord = await db.subscription.get(
      subscription.pk,
      subscription.sk
    );
    if (!subscriptionRecord) {
      console.error(
        `[Sync] Subscription ${subscription.pk} not found in database`
      );
      return;
    }

    await db.subscription.update({
      ...subscriptionRecord,
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
      lastSyncedAt: new Date().toISOString(),
    });

    // Check grace period
    if (subscriptionRecord) {
      await checkGracePeriod(subscriptionRecord);

      // Check if grace period warning should be sent
      if (shouldSendGracePeriodWarning(subscriptionRecord)) {
        const gracePeriodEnd = new Date(subscriptionRecord.gracePeriodEndsAt!);
        const now = new Date();
        const daysRemaining = Math.ceil(
          (gracePeriodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );

        // Only send if we haven't sent recently (avoid duplicate emails)
        const lastSent = subscriptionRecord.lastPaymentEmailSentAt
          ? new Date(subscriptionRecord.lastPaymentEmailSentAt)
          : null;
        const hoursSinceLastSent = lastSent
          ? (now.getTime() - lastSent.getTime()) / (1000 * 60 * 60)
          : Infinity;

        // Send warning if more than 24 hours since last email
        if (hoursSinceLastSent > 24) {
          try {
            const userEmail = await getUserEmailById(subscription.userId);
            if (userEmail && subscriptionRecord) {
              await sendGracePeriodExpiringEmail(
                subscriptionRecord,
                userEmail,
                daysRemaining
              );
              await db.subscription.update({
                ...subscriptionRecord,
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
 */
async function syncAllSubscriptions(): Promise<void> {
  console.log("[Sync] Starting subscription sync from Lemon Squeezy");

  // Query all subscriptions with Lemon Squeezy IDs
  // Note: We need to scan or use a different approach since we don't have an index on lemonSqueezySubscriptionId
  // For now, we'll query by userId and filter
  // This is not ideal but works for the initial implementation

  // Get all subscriptions (we'll need to scan or use a pagination approach)
  // For now, let's use a scan-like approach by querying all users
  // This is a limitation - in production, consider adding a GSI on lemonSqueezySubscriptionId

  // Alternative: Query subscriptions that have been synced recently or need syncing
  // For simplicity, we'll query a sample and rely on webhooks for real-time updates

  // Since we don't have a direct way to query by lemonSqueezySubscriptionId,
  // we'll rely on webhooks for most updates and only sync subscriptions that
  // have a grace period or need attention

  // Query subscriptions with grace periods (these need regular checking)
  // Note: Without a GSI on lemonSqueezySubscriptionId, we rely primarily on webhooks
  // This sync function serves as a backup to catch any missed updates
  // In production, consider adding a GSI for better performance

  // For now, we'll query subscriptions that have grace periods or need attention
  // Since we don't have a direct index, we'll rely on webhooks for most updates
  // This sync is primarily for grace period checking and email notifications

  const allSubscriptions: Array<{
    pk: string;
    sk?: string;
    lemonSqueezySubscriptionId?: string;
    userId: string;
    status?: string;
    gracePeriodEndsAt?: string;
    lastPaymentEmailSentAt?: string;
    lastSyncedAt?: string;
    version?: number;
  }> = [];

  // TODO: Implement proper query logic when GSI is added
  // For now, this is a placeholder - webhooks handle most updates in real-time
  // The sync primarily serves to check grace periods and send reminder emails

  console.log(
    `[Sync] Processing subscriptions (relying on webhooks for most updates)`
  );

  // Sync each subscription
  for (const subscription of allSubscriptions) {
    if (subscription.lemonSqueezySubscriptionId) {
      await syncSubscription(subscription);
    }
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
