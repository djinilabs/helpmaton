/**
 * Lemon Squeezy Webhook Handler
 * Handles webhook events from Lemon Squeezy for subscriptions and orders
 */

import { internal, notFound } from "@hapi/boom";
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

import { database } from "../../tables";
import { handlingErrors } from "../../utils/handlingErrors";
import { adaptHttpHandler } from "../../utils/httpEventAdapter";
import {
  verifyWebhookSignature,
  getSubscription as getLemonSqueezySubscription,
  getOrder as getLemonSqueezyOrder,
} from "../../utils/lemonSqueezy";
import {
  sendPaymentFailedEmail,
  sendSubscriptionCancelledEmail,
} from "../../utils/subscriptionEmails";
import { getUserSubscription } from "../../utils/subscriptionUtils";

interface LemonSqueezyWebhookEvent {
  meta: {
    event_name: string;
    custom_data?: Record<string, unknown>;
  };
  data: {
    id: string;
    type: string;
    attributes: Record<string, unknown>;
  };
}

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

  // Default to starter if variant ID doesn't match (shouldn't happen in production)
  console.warn(
    `[Webhook] Unknown variant ID ${variantId}, defaulting to starter`
  );
  return "starter";
}

/**
 * Handle subscription_created event
 */
async function handleSubscriptionCreated(
  subscriptionData: LemonSqueezyWebhookEvent["data"],
  customData?: Record<string, unknown>
): Promise<void> {
  console.log(
    `[Webhook subscription_created] Processing subscription_created event:`,
    {
      lemonSqueezySubscriptionId: subscriptionData.id,
      customData,
    }
  );

  const db = await database();
  const attributes = subscriptionData.attributes as {
    store_id: number;
    customer_id: number;
    order_id: number;
    variant_id: number;
    user_email: string;
    status: string;
    renews_at: string;
    ends_at: string | null;
    trial_ends_at: string | null;
    created_at: string;
  };

  console.log(`[Webhook subscription_created] Subscription attributes:`, {
    variant_id: attributes.variant_id,
    user_email: attributes.user_email,
    status: attributes.status,
    customer_id: attributes.customer_id,
    order_id: attributes.order_id,
  });

  // Try to get subscription ID from custom data first (more efficient)
  const subscriptionIdFromCustom = customData?.subscriptionId as
    | string
    | undefined;
  let subscription;

  console.log(`[Webhook subscription_created] Looking up subscription:`, {
    subscriptionIdFromCustom,
    hasCustomData: !!customData,
  });

  if (subscriptionIdFromCustom) {
    // Use subscription ID from custom data
    const { getSubscriptionById } = await import(
      "../../utils/subscriptionUtils"
    );
    subscription = await getSubscriptionById(subscriptionIdFromCustom);
    if (!subscription) {
      console.error(
        `[Webhook subscription_created] Subscription ${subscriptionIdFromCustom} not found, falling back to email lookup`
      );
    } else {
      console.log(`[Webhook subscription_created] Found subscription by ID:`, {
        subscriptionId: subscriptionIdFromCustom,
        currentPlan: subscription.plan,
        currentStatus: subscription.status,
        hasLemonSqueezyId: !!subscription.lemonSqueezySubscriptionId,
      });
    }
  }

  // Fallback to email lookup if subscription ID not found
  if (!subscription) {
    console.log(
      `[Webhook subscription_created] Looking up user by email: ${attributes.user_email}`
    );
    const userId = await findUserIdByEmail(attributes.user_email);
    if (!userId) {
      // CRITICAL: Both custom data and email lookup failed
      // This indicates a webhook event for a user/subscription that doesn't exist in our system
      // This is an unrecoverable failure - throw error to be caught and reported to Sentry
      const errorMessage =
        `Failed to find subscription for event "subscription_created". ` +
        `Lemon Squeezy subscription ID: ${subscriptionData.id}, ` +
        `Custom data subscription ID: ${
          subscriptionIdFromCustom || "not provided"
        }, ` +
        `User email: ${attributes.user_email}, ` +
        `User lookup result: not found. ` +
        `This may indicate a webhook event for a user that doesn't exist in our system.`;
      console.error(`[Webhook subscription_created] CRITICAL: ${errorMessage}`);
      // Throw error - this will be caught by handlingErrors, reported to Sentry, and returned as 500
      throw internal(errorMessage, {
        lemonSqueezySubscriptionId: subscriptionData.id,
        customDataSubscriptionId: subscriptionIdFromCustom,
        userEmail: attributes.user_email,
        eventType: "subscription_created",
      });
    }
    console.log(
      `[Webhook subscription_created] Found user by email: ${userId}`
    );
    subscription = await getUserSubscription(userId);
    console.log(`[Webhook subscription_created] Got subscription for user:`, {
      subscriptionId: subscription.pk.replace("subscriptions/", ""),
      currentPlan: subscription.plan,
      currentStatus: subscription.status,
    });
  }

  const subscriptionId = subscription.pk.replace("subscriptions/", "");

  // Determine plan from variant ID
  const plan = variantIdToPlan(String(attributes.variant_id));

  console.log(`[Webhook subscription_created] Updating subscription:`, {
    subscriptionId,
    currentPlan: subscription.plan,
    newPlan: plan,
    variantId: attributes.variant_id,
    lemonSqueezySubscriptionId: subscriptionData.id,
    status: attributes.status,
    customerId: attributes.customer_id,
    orderId: attributes.order_id,
    isUpgradeFromFree:
      subscription.plan === "free" && (plan === "starter" || plan === "pro"),
  });

  // Update subscription with Lemon Squeezy data
  // This is critical for free-to-paid upgrades - the subscription plan must be updated
  console.log(
    `[Webhook subscription_created] Calling db.subscription.update for subscription ${subscriptionId}`
  );
  const updatedSubscription = await db.subscription.update({
    ...subscription,
    plan,
    lemonSqueezySubscriptionId: subscriptionData.id,
    lemonSqueezyCustomerId: String(attributes.customer_id),
    lemonSqueezyOrderId: String(attributes.order_id),
    lemonSqueezyVariantId: String(attributes.variant_id),
    status: attributes.status as "active" | "on_trial",
    renewsAt: attributes.renews_at,
    endsAt: attributes.ends_at || undefined,
    trialEndsAt: attributes.trial_ends_at || undefined,
    gracePeriodEndsAt: undefined,
    lemonSqueezySyncKey: "ACTIVE", // Set GSI key for efficient querying
    lastSyncedAt: new Date().toISOString(),
  });

  console.log(
    `[Webhook subscription_created] Database update completed. Verifying update:`,
    {
      subscriptionId,
      updatedPlan: updatedSubscription.plan,
      updatedStatus: updatedSubscription.status,
      updatedLemonSqueezySubscriptionId:
        updatedSubscription.lemonSqueezySubscriptionId,
      updatedLemonSqueezyVariantId: updatedSubscription.lemonSqueezyVariantId,
      planUpdateSuccessful: updatedSubscription.plan === plan,
    }
  );

  console.log(
    `[Webhook subscription_created] Subscription updated in database:`,
    {
      subscriptionId,
      plan: updatedSubscription.plan,
      status: updatedSubscription.status,
      lemonSqueezySubscriptionId:
        updatedSubscription.lemonSqueezySubscriptionId,
    }
  );

  // Associate subscription with API Gateway usage plan immediately
  // This ensures the plan change takes effect right away
  try {
    const { associateSubscriptionWithPlan } = await import(
      "../../utils/apiGatewayUsagePlans"
    );
    console.log(
      `[Webhook subscription_created] Associating subscription ${subscriptionId} with ${plan} usage plan`
    );
    await associateSubscriptionWithPlan(subscriptionId, plan);
    console.log(
      `[Webhook subscription_created] Successfully associated subscription ${subscriptionId} with ${plan} usage plan`
    );
  } catch (error) {
    console.error(
      `[Webhook subscription_created] Error associating subscription ${subscriptionId} with usage plan:`,
      error
    );
    // Don't throw - subscription is updated, usage plan association can be retried
  }

  console.log(
    `[Webhook subscription_created] Successfully updated subscription ${subscriptionId} from ${subscription.plan} to ${plan} plan`
  );
}

/**
 * Handle subscription_updated event
 */
async function handleSubscriptionUpdated(
  subscriptionData: LemonSqueezyWebhookEvent["data"],
  customData?: Record<string, unknown>
): Promise<void> {
  const db = await database();
  const attributes = subscriptionData.attributes as {
    status: string;
    renews_at: string;
    ends_at: string | null;
    trial_ends_at: string | null;
    variant_id: number;
  };

  // Try to get subscription ID from custom data first (more efficient)
  const subscriptionIdFromCustom = customData?.subscriptionId as
    | string
    | undefined;
  let subscription;

  if (subscriptionIdFromCustom) {
    // Use subscription ID from custom data
    const { getSubscriptionById } = await import(
      "../../utils/subscriptionUtils"
    );
    subscription = await getSubscriptionById(subscriptionIdFromCustom);
    if (!subscription) {
      console.error(
        `[Webhook] Subscription ${subscriptionIdFromCustom} not found, falling back to email lookup`
      );
    }
  }

  // Fallback to email lookup if subscription ID not found
  if (!subscription) {
    // Get full subscription from Lemon Squeezy to find customer
    const lemonSqueezySub = await getLemonSqueezySubscription(
      subscriptionData.id
    );
    const userEmail = lemonSqueezySub.attributes.user_email;

    const userId = await findUserIdByEmail(userEmail);
    if (!userId) {
      // CRITICAL: Both custom data and email lookup failed
      // This indicates a webhook event for a user/subscription that doesn't exist in our system
      // This is an unrecoverable failure - throw error to be caught and reported to Sentry
      const errorMessage =
        `Failed to find subscription for event "subscription_updated". ` +
        `Lemon Squeezy subscription ID: ${subscriptionData.id}, ` +
        `Custom data subscription ID: ${
          subscriptionIdFromCustom || "not provided"
        }, ` +
        `User email: ${userEmail}, ` +
        `User lookup result: not found. ` +
        `This may indicate a webhook event for a user that doesn't exist in our system.`;
      console.error(`[Webhook] CRITICAL: ${errorMessage}`);
      // Throw error - this will be caught by handlingErrors, reported to Sentry, and returned as 500
      throw internal(errorMessage, {
        lemonSqueezySubscriptionId: subscriptionData.id,
        customDataSubscriptionId: subscriptionIdFromCustom,
        userEmail,
        eventType: "subscription_updated",
      });
    }

    subscription = await getUserSubscription(userId);
  }
  const subscriptionId = subscription.pk.replace("subscriptions/", "");
  const plan = variantIdToPlan(String(attributes.variant_id));

  // Update subscription
  // Keep lemonSqueezySyncKey as "ACTIVE" if subscription still has Lemon Squeezy ID
  await db.subscription.update({
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
    lemonSqueezySyncKey: subscription.lemonSqueezySubscriptionId
      ? "ACTIVE"
      : undefined, // Maintain GSI key if subscription has Lemon Squeezy ID
    lastSyncedAt: new Date().toISOString(),
  });

  // Associate subscription with API Gateway usage plan immediately
  // This ensures the plan change takes effect right away
  try {
    const { associateSubscriptionWithPlan } = await import(
      "../../utils/apiGatewayUsagePlans"
    );
    await associateSubscriptionWithPlan(subscriptionId, plan);
    console.log(
      `[Webhook] Associated subscription ${subscriptionId} with ${plan} usage plan`
    );
  } catch (error) {
    console.error(
      `[Webhook] Error associating subscription ${subscriptionId} with usage plan:`,
      error
    );
    // Don't throw - subscription is updated, usage plan association can be retried
  }

  console.log(
    `[Webhook] Updated subscription ${subscription.pk} with new status: ${attributes.status}`
  );
}

/**
 * Handle subscription_past_due event
 */
async function handleSubscriptionPastDue(
  subscriptionData: LemonSqueezyWebhookEvent["data"],
  customData?: Record<string, unknown>
): Promise<void> {
  const db = await database();

  // Try to get subscription ID from custom data first (more efficient)
  const subscriptionIdFromCustom = customData?.subscriptionId as
    | string
    | undefined;
  let subscription;

  if (subscriptionIdFromCustom) {
    // Use subscription ID from custom data
    const { getSubscriptionById } = await import(
      "../../utils/subscriptionUtils"
    );
    subscription = await getSubscriptionById(subscriptionIdFromCustom);
    if (!subscription) {
      console.error(
        `[Webhook] Subscription ${subscriptionIdFromCustom} not found, falling back to email lookup`
      );
    }
  }

  // Fallback to email lookup if subscription ID not found
  let userEmail: string | undefined;
  if (!subscription) {
    const lemonSqueezySub = await getLemonSqueezySubscription(
      subscriptionData.id
    );
    userEmail = lemonSqueezySub.attributes.user_email;

    const userId = await findUserIdByEmail(userEmail);
    if (!userId) {
      // CRITICAL: Both custom data and email lookup failed
      // This indicates a webhook event for a user/subscription that doesn't exist in our system
      // This is an unrecoverable failure - throw error to be caught and reported to Sentry
      const errorMessage =
        `Failed to find subscription for event "subscription_past_due". ` +
        `Lemon Squeezy subscription ID: ${subscriptionData.id}, ` +
        `Custom data subscription ID: ${
          subscriptionIdFromCustom || "not provided"
        }, ` +
        `User email: ${userEmail}, ` +
        `User lookup result: not found. ` +
        `This may indicate a webhook event for a user that doesn't exist in our system.`;
      console.error(`[Webhook] CRITICAL: ${errorMessage}`);
      // Throw error - this will be caught by handlingErrors, reported to Sentry, and returned as 500
      throw internal(errorMessage, {
        lemonSqueezySubscriptionId: subscriptionData.id,
        customDataSubscriptionId: subscriptionIdFromCustom,
        userEmail,
        eventType: "subscription_past_due",
      });
    }

    subscription = await getUserSubscription(userId);
  } else {
    // Get user email for sending notification
    const { getUserEmailById } = await import("../../utils/subscriptionUtils");
    userEmail = await getUserEmailById(subscription.userId);
  }

  // Set grace period to 7 days from now
  const gracePeriodEndsAt = new Date();
  gracePeriodEndsAt.setDate(gracePeriodEndsAt.getDate() + 7);

  await db.subscription.update({
    ...subscription,
    status: "past_due",
    gracePeriodEndsAt: gracePeriodEndsAt.toISOString(),
    lemonSqueezySyncKey: "ACTIVE", // Maintain GSI key for sync
    lastSyncedAt: new Date().toISOString(),
  });

  // Send payment failed email
  try {
    if (userEmail) {
      await sendPaymentFailedEmail(subscription, userEmail);
      await db.subscription.update({
        ...subscription,
        lastPaymentEmailSentAt: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error(`[Webhook] Failed to send payment failed email:`, error);
    // Don't throw - email failure shouldn't block webhook processing
  }

  console.log(`[Webhook] Set grace period for subscription ${subscription.pk}`);
}

/**
 * Handle subscription_resumed event
 */
async function handleSubscriptionResumed(
  subscriptionData: LemonSqueezyWebhookEvent["data"],
  customData?: Record<string, unknown>
): Promise<void> {
  const db = await database();

  // Try to get subscription ID from custom data first (more efficient)
  const subscriptionIdFromCustom = customData?.subscriptionId as
    | string
    | undefined;
  let subscription;

  if (subscriptionIdFromCustom) {
    // Use subscription ID from custom data
    const { getSubscriptionById } = await import(
      "../../utils/subscriptionUtils"
    );
    subscription = await getSubscriptionById(subscriptionIdFromCustom);
    if (!subscription) {
      console.error(
        `[Webhook] Subscription ${subscriptionIdFromCustom} not found, falling back to email lookup`
      );
    }
  }

  // Fallback to email lookup if subscription ID not found
  if (!subscription) {
    const lemonSqueezySub = await getLemonSqueezySubscription(
      subscriptionData.id
    );
    const userEmail = lemonSqueezySub.attributes.user_email;

    const userId = await findUserIdByEmail(userEmail);
    if (!userId) {
      // CRITICAL: Both custom data and email lookup failed
      // This indicates a webhook event for a user/subscription that doesn't exist in our system
      // This is an unrecoverable failure - throw error to be caught and reported to Sentry
      const errorMessage =
        `Failed to find subscription for event "subscription_resumed". ` +
        `Lemon Squeezy subscription ID: ${subscriptionData.id}, ` +
        `Custom data subscription ID: ${
          subscriptionIdFromCustom || "not provided"
        }, ` +
        `User email: ${userEmail}, ` +
        `User lookup result: not found. ` +
        `This may indicate a webhook event for a user that doesn't exist in our system.`;
      console.error(`[Webhook] CRITICAL: ${errorMessage}`);
      // Throw error - this will be caught by handlingErrors, reported to Sentry, and returned as 500
      throw internal(errorMessage, {
        lemonSqueezySubscriptionId: subscriptionData.id,
        customDataSubscriptionId: subscriptionIdFromCustom,
        userEmail,
        eventType: "subscription_resumed",
      });
    }

    subscription = await getUserSubscription(userId);
  }

  await db.subscription.update({
    ...subscription,
    status: "active",
    gracePeriodEndsAt: undefined,
    lemonSqueezySyncKey: "ACTIVE", // Maintain GSI key for sync
    lastSyncedAt: new Date().toISOString(),
  });

  console.log(
    `[Webhook] Cleared grace period for subscription ${subscription.pk}`
  );
}

/**
 * Handle subscription_cancelled event
 */
async function handleSubscriptionCancelled(
  subscriptionData: LemonSqueezyWebhookEvent["data"],
  customData?: Record<string, unknown>
): Promise<void> {
  const db = await database();

  // Try to get subscription ID from custom data first (more efficient)
  const subscriptionIdFromCustom = customData?.subscriptionId as
    | string
    | undefined;
  let subscription;

  if (subscriptionIdFromCustom) {
    // Use subscription ID from custom data
    const { getSubscriptionById } = await import(
      "../../utils/subscriptionUtils"
    );
    subscription = await getSubscriptionById(subscriptionIdFromCustom);
    if (!subscription) {
      console.error(
        `[Webhook] Subscription ${subscriptionIdFromCustom} not found, falling back to email lookup`
      );
    }
  }

  // Fallback to email lookup if subscription ID not found
  let lemonSqueezySub;
  let userEmail: string | undefined;
  if (!subscription) {
    lemonSqueezySub = await getLemonSqueezySubscription(subscriptionData.id);
    userEmail = lemonSqueezySub.attributes.user_email;

    const userId = await findUserIdByEmail(userEmail);
    if (!userId) {
      // CRITICAL: Both custom data and email lookup failed
      // This indicates a webhook event for a user/subscription that doesn't exist in our system
      // This is an unrecoverable failure - throw error to be caught and reported to Sentry
      const errorMessage =
        `Failed to find subscription for event "subscription_cancelled". ` +
        `Lemon Squeezy subscription ID: ${subscriptionData.id}, ` +
        `Custom data subscription ID: ${
          subscriptionIdFromCustom || "not provided"
        }, ` +
        `User email: ${userEmail}, ` +
        `User lookup result: not found. ` +
        `This may indicate a webhook event for a user that doesn't exist in our system.`;
      console.error(`[Webhook] CRITICAL: ${errorMessage}`);
      // Throw error - this will be caught by handlingErrors, reported to Sentry, and returned as 500
      throw internal(errorMessage, {
        lemonSqueezySubscriptionId: subscriptionData.id,
        customDataSubscriptionId: subscriptionIdFromCustom,
        userEmail,
        eventType: "subscription_cancelled",
      });
    }

    subscription = await getUserSubscription(userId);
  } else {
    // Get user email from subscription userId
    const { getUserEmailById } = await import("../../utils/subscriptionUtils");
    userEmail = await getUserEmailById(subscription.userId);
  }

  // Fetch Lemon Squeezy subscription data if we haven't already
  if (!lemonSqueezySub) {
    lemonSqueezySub = await getLemonSqueezySubscription(subscriptionData.id);
  }

  await db.subscription.update({
    ...subscription,
    status: "cancelled",
    endsAt: lemonSqueezySub.attributes.ends_at || undefined,
    lemonSqueezySyncKey: undefined, // Remove from GSI when cancelled
    lastSyncedAt: new Date().toISOString(),
  });

  // Send cancellation email
  try {
    if (userEmail) {
      await sendSubscriptionCancelledEmail(subscription, userEmail);
    }
  } catch (error) {
    console.error(`[Webhook] Failed to send cancellation email:`, error);
  }

  console.log(`[Webhook] Cancelled subscription ${subscription.pk}`);
}

/**
 * Handle subscription_expired event
 */
async function handleSubscriptionExpired(
  subscriptionData: LemonSqueezyWebhookEvent["data"],
  customData?: Record<string, unknown>
): Promise<void> {
  const db = await database();

  // Try to get subscription ID from custom data first (more efficient)
  const subscriptionIdFromCustom = customData?.subscriptionId as
    | string
    | undefined;
  let subscription;

  if (subscriptionIdFromCustom) {
    // Use subscription ID from custom data
    const { getSubscriptionById } = await import(
      "../../utils/subscriptionUtils"
    );
    subscription = await getSubscriptionById(subscriptionIdFromCustom);
    if (!subscription) {
      console.error(
        `[Webhook] Subscription ${subscriptionIdFromCustom} not found, falling back to email lookup`
      );
    }
  }

  // Fallback to email lookup if subscription ID not found
  if (!subscription) {
    const lemonSqueezySub = await getLemonSqueezySubscription(
      subscriptionData.id
    );
    const userEmail = lemonSqueezySub.attributes.user_email;

    const userId = await findUserIdByEmail(userEmail);
    if (!userId) {
      // CRITICAL: Both custom data and email lookup failed
      // This indicates a webhook event for a user/subscription that doesn't exist in our system
      // This is an unrecoverable failure - throw error to be caught and reported to Sentry
      const errorMessage =
        `Failed to find subscription for event "subscription_expired". ` +
        `Lemon Squeezy subscription ID: ${subscriptionData.id}, ` +
        `Custom data subscription ID: ${
          subscriptionIdFromCustom || "not provided"
        }, ` +
        `User email: ${userEmail}, ` +
        `User lookup result: not found. ` +
        `This may indicate a webhook event for a user that doesn't exist in our system.`;
      console.error(`[Webhook] CRITICAL: ${errorMessage}`);
      // Throw error - this will be caught by handlingErrors, reported to Sentry, and returned as 500
      throw internal(errorMessage, {
        lemonSqueezySubscriptionId: subscriptionData.id,
        customDataSubscriptionId: subscriptionIdFromCustom,
        userEmail,
        eventType: "subscription_expired",
      });
    }

    subscription = await getUserSubscription(userId);
  }

  // Downgrade to free plan
  await db.subscription.update({
    ...subscription,
    plan: "free",
    status: "expired",
    gracePeriodEndsAt: undefined,
    lemonSqueezySyncKey: undefined, // Remove from GSI when expired
    lemonSqueezySubscriptionId: undefined,
    lemonSqueezyCustomerId: undefined,
    lemonSqueezyVariantId: undefined,
    renewsAt: undefined,
    endsAt: undefined,
    lastSyncedAt: new Date().toISOString(),
  });

  console.log(
    `[Webhook] Expired subscription ${subscription.pk}, downgraded to free`
  );
}

/**
 * Handle order_created event (for credit purchases)
 */
async function handleOrderCreated(
  orderData: LemonSqueezyWebhookEvent["data"],
  customData?: Record<string, unknown>
): Promise<void> {
  const db = await database();
  const order = await getLemonSqueezyOrder(orderData.id);
  const attributes = order.attributes;

  // Extract workspace ID from custom data
  // Lemon Squeezy stores custom data in checkout_data.custom when creating the checkout
  // This should be available in the webhook event meta.custom_data
  const workspaceId = customData?.workspaceId as string | undefined;

  if (!workspaceId) {
    // Unrecoverable failure - cannot process order without workspace ID
    const errorMessage =
      `No workspace ID in order custom data for order ${orderData.id}. ` +
      `Custom data: ${JSON.stringify(customData)}. ` +
      `Cannot process order without workspace ID.`;
    console.error(`[Webhook] CRITICAL: ${errorMessage}`);
    // Throw error - this will be caught by handlingErrors, reported to Sentry, and returned as 500
    throw internal(errorMessage, {
      lemonSqueezyOrderId: orderData.id,
      customData,
      eventType: "order_created",
    });
  }

  // Get workspace
  const workspacePk = `workspaces/${workspaceId}`;
  const workspace = await db.workspace.get(workspacePk, "workspace");
  if (!workspace) {
    // Unrecoverable failure - workspace not found
    const errorMessage = `Workspace ${workspaceId} not found for order ${orderData.id}. Cannot process order.`;
    console.error(`[Webhook] CRITICAL: ${errorMessage}`);
    // Throw error - this will be caught by handlingErrors, reported to Sentry, and returned as 500
    throw notFound(errorMessage, {
      workspaceId,
      lemonSqueezyOrderId: orderData.id,
      eventType: "order_created",
    });
  }

  // Extract credit amount from order total (in cents, convert to millionths)
  // Lemon Squeezy stores amounts in cents, so: cents * 10_000 = millionths
  const creditAmount = attributes.total * 10_000;

  // Add credits to workspace using atomic update
  await db.workspace.atomicUpdate(
    workspacePk,
    "workspace",
    async (workspace) => {
      if (!workspace) {
        throw new Error(`Workspace ${workspaceId} not found`);
      }
      const newBalance = (workspace.creditBalance || 0) + creditAmount;
      return {
        pk: workspacePk,
        sk: "workspace",
        creditBalance: newBalance,
        lemonSqueezyOrderId: orderData.id,
      };
    }
  );

  console.log(
    `[Webhook] Added ${creditAmount} credits to workspace ${workspaceId} from order ${orderData.id}`
  );
}

/**
 * Handle order_refunded event (for credit purchase refunds)
 */
async function handleOrderRefunded(
  orderData: LemonSqueezyWebhookEvent["data"],
  customData?: Record<string, unknown>
): Promise<void> {
  const db = await database();

  // Try to extract workspaceId from webhook event custom data
  let workspaceId = customData?.workspaceId as string | undefined;

  // If not present, fetch order from Lemon Squeezy and try to extract custom data
  if (!workspaceId) {
    try {
      const order = await getLemonSqueezyOrder(orderData.id);
      // Try to extract from order attributes (checkout_data.custom)
      // Note: Lemon Squeezy stores custom data in checkout_data.custom when creating the checkout
      // The checkout_data field may not be in the order attributes type, so we access it safely
      const checkoutData = (order.attributes as Record<string, unknown>)
        .checkout_data as { custom?: { workspaceId?: string } } | undefined;
      workspaceId = checkoutData?.custom?.workspaceId;
    } catch (err) {
      console.error(
        `[Webhook] Failed to fetch order ${orderData.id} for refund:`,
        err
      );
    }
  }

  // Fallback: Look up workspace by lemonSqueezyOrderId using GSI
  // This handles cases where custom data is missing but the workspace has the order ID stored
  if (!workspaceId) {
    try {
      console.log(
        `[Webhook] Workspace ID not found in custom data, attempting lookup by order ID ${orderData.id}`
      );
      const workspacesQuery = await db.workspace.query({
        IndexName: "byLemonSqueezyOrderId",
        KeyConditionExpression: "lemonSqueezyOrderId = :orderId",
        ExpressionAttributeValues: {
          ":orderId": orderData.id,
        },
      });

      if (workspacesQuery.items.length > 0) {
        // Extract workspace ID from pk (format: "workspaces/{workspaceId}")
        const workspacePk = workspacesQuery.items[0].pk;
        workspaceId = workspacePk.replace("workspaces/", "");
        console.log(
          `[Webhook] Found workspace ${workspaceId} by order ID ${orderData.id}`
        );
      } else {
        console.warn(
          `[Webhook] No workspace found with lemonSqueezyOrderId ${orderData.id}`
        );
      }
    } catch (err) {
      console.error(
        `[Webhook] Failed to lookup workspace by order ID ${orderData.id}:`,
        err
      );
    }
  }

  if (!workspaceId) {
    // Unrecoverable failure - cannot process refund without workspace ID
    const errorMessage =
      `No workspace ID found for refunded order ${orderData.id}. ` +
      `Tried: custom data, order checkout_data, and workspace lookup by order ID. ` +
      `Cannot process refund without workspace ID.`;
    console.error(`[Webhook] CRITICAL: ${errorMessage}`);
    // Throw error - this will be caught by handlingErrors, reported to Sentry, and returned as 500
    throw internal(errorMessage, {
      lemonSqueezyOrderId: orderData.id,
      customData,
      eventType: "order_refunded",
    });
  }

  // Get workspace
  const workspacePk = `workspaces/${workspaceId}`;
  const workspace = await db.workspace.get(workspacePk, "workspace");
  if (!workspace) {
    // Unrecoverable failure - workspace not found
    const errorMessage = `Workspace ${workspaceId} not found for refunded order ${orderData.id}. Cannot process refund.`;
    console.error(`[Webhook] CRITICAL: ${errorMessage}`);
    // Throw error - this will be caught by handlingErrors, reported to Sentry, and returned as 500
    throw notFound(errorMessage, {
      workspaceId,
      lemonSqueezyOrderId: orderData.id,
      eventType: "order_refunded",
    });
  }

  // Get the order total (in cents, convert to millionths)
  // Lemon Squeezy stores amounts in cents, so: cents * 10_000 = millionths
  let creditAmount: number | undefined;
  if (orderData.attributes?.total) {
    creditAmount = (orderData.attributes.total as number) * 10_000;
  } else {
    // Fallback: fetch order from Lemon Squeezy
    try {
      const order = await getLemonSqueezyOrder(orderData.id);
      creditAmount = order?.attributes?.total
        ? order.attributes.total * 10_000
        : undefined;
    } catch (err) {
      console.error(
        `[Webhook] Failed to fetch order total for refund ${orderData.id}:`,
        err
      );
    }
  }

  if (!creditAmount) {
    // Unrecoverable failure - cannot process refund without credit amount
    const errorMessage = `Could not determine credit amount for refunded order ${orderData.id}. Cannot process refund.`;
    console.error(`[Webhook] CRITICAL: ${errorMessage}`);
    // Throw error - this will be caught by handlingErrors, reported to Sentry, and returned as 500
    throw internal(errorMessage, {
      lemonSqueezyOrderId: orderData.id,
      workspaceId,
      eventType: "order_refunded",
    });
  }

  // Deduct credits from workspace using atomic update
  await db.workspace.atomicUpdate(
    workspacePk,
    "workspace",
    async (workspace) => {
      if (!workspace) {
        throw new Error(`Workspace ${workspaceId} not found`);
      }
      const newBalance = Math.max(
        0,
        Math.round(
          ((workspace.creditBalance || 0) - creditAmount) * 1_000_000
        ) / 1_000_000
      );
      return {
        pk: workspacePk,
        sk: "workspace",
        creditBalance: newBalance,
        lemonSqueezyOrderId: orderData.id,
      };
    }
  );

  console.log(
    `[Webhook] Deducted ${creditAmount} credits from workspace ${workspaceId} due to refund of order ${orderData.id}`
  );
}

/**
 * Find user ID by email
 */
async function findUserIdByEmail(email: string): Promise<string | undefined> {
  const db = await database();
  const normalizedEmail = email.toLowerCase().trim();
  const gsi1Pk = `USER#${normalizedEmail}`;
  const gsi1Sk = `USER#${normalizedEmail}`;

  try {
    const result = await db["next-auth"].query({
      IndexName: "GSI2",
      KeyConditionExpression: "gsi1pk = :gsi1Pk AND gsi1sk = :gsi1Sk",
      ExpressionAttributeValues: {
        ":gsi1Pk": gsi1Pk,
        ":gsi1Sk": gsi1Sk,
      },
    });

    const user = result.items[0];
    return user?.id;
  } catch (error) {
    console.error(`[Webhook] Error finding user by email ${email}:`, error);
    return undefined;
  }
}

/**
 * Main webhook handler
 */
export const handler = adaptHttpHandler(
  handlingErrors(
    async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
      // Verify webhook signature
      // Lemon Squeezy sends signature in X-Signature header
      const signature =
        event.headers["x-signature"] ||
        event.headers["X-Signature"] ||
        event.headers["x-signature-256"] ||
        event.headers["X-Signature-256"];
      if (!signature || typeof signature !== "string") {
        console.error("[Webhook] Missing signature header");
        return {
          statusCode: 401,
          body: JSON.stringify({ error: "Missing signature" }),
        };
      }

      const body = event.body || "";
      if (!verifyWebhookSignature(body, signature)) {
        console.error("[Webhook] Invalid signature");
        return {
          statusCode: 401,
          body: JSON.stringify({ error: "Invalid signature" }),
        };
      }

      // Parse webhook event
      let webhookEvent: LemonSqueezyWebhookEvent;
      try {
        webhookEvent = JSON.parse(body);
      } catch (error) {
        console.error("[Webhook] Failed to parse webhook body:", error);
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "Invalid JSON" }),
        };
      }

      const eventName = webhookEvent.meta.event_name;
      // Custom data is stored in the webhook event meta
      // For orders, it's also available in order attributes
      const customData = webhookEvent.meta.custom_data || {};

      console.log(`[Webhook] Received event: ${eventName}`, {
        customData,
        dataId: webhookEvent.data.id,
        dataType: webhookEvent.data.type,
        fullMeta: webhookEvent.meta,
      });

      // Handle different event types
      // All errors will bubble up to handlingErrors wrapper which will:
      // 1. Boomify the error
      // 2. Report to Sentry with full HTTP request context
      // 3. Return boom error payload as response
      console.log(`[Webhook] Processing event type: ${eventName} with handler`);
      switch (eventName) {
        case "subscription_created":
          console.log(
            `[Webhook] Calling handleSubscriptionCreated for subscription ${webhookEvent.data.id}`
          );
          await handleSubscriptionCreated(webhookEvent.data, customData);
          console.log(
            `[Webhook] Successfully processed subscription_created event for subscription ${webhookEvent.data.id}`
          );
          break;
        case "subscription_updated":
          await handleSubscriptionUpdated(webhookEvent.data, customData);
          break;
        case "subscription_past_due":
          await handleSubscriptionPastDue(webhookEvent.data, customData);
          break;
        case "subscription_resumed":
          await handleSubscriptionResumed(webhookEvent.data, customData);
          break;
        case "subscription_cancelled":
          await handleSubscriptionCancelled(webhookEvent.data, customData);
          break;
        case "subscription_expired":
          await handleSubscriptionExpired(webhookEvent.data, customData);
          break;
        case "order_created":
          await handleOrderCreated(webhookEvent.data, customData);
          break;
        case "order_refunded":
          await handleOrderRefunded(webhookEvent.data, customData);
          break;
        default:
          console.log(`[Webhook] Unhandled event type: ${eventName}`);
      }

      // Return 200 OK to acknowledge successful processing
      return {
        statusCode: 200,
        body: JSON.stringify({ received: true }),
      };
    }
  )
);
