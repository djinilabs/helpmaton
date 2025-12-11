/**
 * Lemon Squeezy Webhook Handler
 * Handles webhook events from Lemon Squeezy for subscriptions and orders
 */

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
    const userId = await findUserIdByEmail(attributes.user_email);
    if (!userId) {
      console.error(
        `[Webhook] User not found for email ${attributes.user_email}`
      );
      return;
    }
    subscription = await getUserSubscription(userId);
  }

  const subscriptionId = subscription.pk.replace("subscriptions/", "");

  // Determine plan from variant ID
  const plan = variantIdToPlan(String(attributes.variant_id));

  // Update subscription with Lemon Squeezy data
  await db.subscription.update({
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
    lastSyncedAt: new Date().toISOString(),
  });

  console.log(
    `[Webhook] Updated subscription ${subscriptionId} with Lemon Squeezy data`
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
      console.error(`[Webhook] User not found for email ${userEmail}`);
      return;
    }

    subscription = await getUserSubscription(userId);
  }
  const plan = variantIdToPlan(String(attributes.variant_id));

  // Update subscription
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
    lastSyncedAt: new Date().toISOString(),
  });

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
      console.error(`[Webhook] User not found for email ${userEmail}`);
      return;
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
      console.error(`[Webhook] User not found for email ${userEmail}`);
      return;
    }

    subscription = await getUserSubscription(userId);
  }

  await db.subscription.update({
    ...subscription,
    status: "active",
    gracePeriodEndsAt: undefined,
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
  if (!subscription) {
    const lemonSqueezySub = await getLemonSqueezySubscription(
      subscriptionData.id
    );
    const userEmail = lemonSqueezySub.attributes.user_email;

    const userId = await findUserIdByEmail(userEmail);
    if (!userId) {
      console.error(`[Webhook] User not found for email ${userEmail}`);
      return;
    }

    subscription = await getUserSubscription(userId);
  }

  const lemonSqueezySub = await getLemonSqueezySubscription(
    subscriptionData.id
  );
  const userEmail = lemonSqueezySub.attributes.user_email;

  await db.subscription.update({
    ...subscription,
    status: "cancelled",
    endsAt: lemonSqueezySub.attributes.ends_at || undefined,
    lastSyncedAt: new Date().toISOString(),
  });

  // Send cancellation email
  try {
    await sendSubscriptionCancelledEmail(subscription, userEmail);
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
      console.error(`[Webhook] User not found for email ${userEmail}`);
      return;
    }

    subscription = await getUserSubscription(userId);
  }

  // Downgrade to free plan
  await db.subscription.update({
    ...subscription,
    plan: "free",
    status: "expired",
    gracePeriodEndsAt: undefined,
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
    console.error(
      `[Webhook] No workspace ID in order custom data for order ${orderData.id}. Custom data:`,
      JSON.stringify(customData)
    );
    // Try to get from order attributes as fallback
    // Note: Lemon Squeezy might store custom data differently
    return;
  }

  // Get workspace
  const workspacePk = `workspaces/${workspaceId}`;
  const workspace = await db.workspace.get(workspacePk, "workspace");
  if (!workspace) {
    console.error(`[Webhook] Workspace ${workspaceId} not found`);
    return;
  }

  // Extract credit amount from order total (in cents, convert to currency units)
  const creditAmount = attributes.total / 100; // Lemon Squeezy stores amounts in cents

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
  orderData: LemonSqueezyWebhookEvent["data"]
): Promise<void> {
  // Find workspace by order ID
  // For now, we'll need to store workspace ID in the order custom data
  // This is a limitation - we should improve this
  console.warn(
    `[Webhook] Order refunded for ${orderData.id}, but workspace lookup not implemented`
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
      });

      // Handle different event types
      try {
        switch (eventName) {
          case "subscription_created":
            await handleSubscriptionCreated(webhookEvent.data, customData);
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
            await handleOrderRefunded(webhookEvent.data);
            break;
          default:
            console.log(`[Webhook] Unhandled event type: ${eventName}`);
        }
      } catch (error) {
        console.error(`[Webhook] Error handling event ${eventName}:`, error);
        // Still return 200 to prevent Lemon Squeezy from retrying
        // We'll handle errors in scheduled sync
      }

      // Always return 200 OK to acknowledge receipt
      return {
        statusCode: 200,
        body: JSON.stringify({ received: true }),
      };
    }
  )
);
