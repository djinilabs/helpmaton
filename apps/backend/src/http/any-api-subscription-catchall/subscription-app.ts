import {
  badRequest,
  boomify,
  forbidden,
  internal,
  notFound,
  unauthorized,
} from "@hapi/boom";
import express from "express";

import { database } from "../../tables";
import {
  createCheckout,
  cancelSubscription as cancelLemonSqueezySubscription,
  getSubscription as getLemonSqueezySubscription,
  listSubscriptionsByCustomer,
  updateSubscriptionVariant,
} from "../../utils/lemonSqueezy";
import { getPlanLimits } from "../../utils/subscriptionPlans";
import {
  checkGracePeriod,
  getEffectivePlan,
} from "../../utils/subscriptionStatus";
import {
  getUserSubscription,
  isSubscriptionManager,
  addSubscriptionManager,
  removeSubscriptionManager,
  validateCanAddAsManager,
  validateCanRemoveManager,
  getSubscriptionManagers,
  getUserEmailById,
  getUserByEmail,
  getSubscriptionWorkspaces,
  getSubscriptionDocuments,
  getSubscriptionAgents,
  getSubscriptionUniqueUsers,
  getSubscriptionAgentKeys,
  getSubscriptionChannels,
  getSubscriptionMcpServers,
} from "../../utils/subscriptionUtils";
import { verifyAccessToken } from "../../utils/tokenUtils";
import { expressErrorHandler } from "../utils/errorHandler";
import { userRef } from "../utils/session";

// Helper to handle errors: boomify, log, then pass to next
const handleError = (
  error: unknown,
  next: express.NextFunction,
  context?: string
) => {
  // First, boomify the error
  const boomError = boomify(error as Error);

  // Then, log the error
  const logContext = context ? `[${context}]` : "";
  console.error(`${logContext} Error caught:`, {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    boom: {
      statusCode: boomError.output.statusCode,
      message: boomError.message,
      isServer: boomError.isServer,
    },
  });

  // Pass to next middleware
  next(boomError);
};

// Helper to wrap async handlers with error handling
const asyncHandler = (
  fn: (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => Promise<void>
) => {
  return (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      handleError(error, next, `${req.method} ${req.path}`);
    });
  };
};

export const createApp: () => express.Application = () => {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());

  // Add request logging middleware
  app.use((req, res, next) => {
    console.log(`[${req.method}] ${req.path}`);
    next();
  });

  const requireAuth = async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    try {
      // Extract Bearer token from Authorization header
      const authHeader = req.headers.authorization || req.headers.Authorization;
      if (!authHeader || typeof authHeader !== "string") {
        throw unauthorized("Bearer token required");
      }

      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (!match) {
        throw unauthorized("Invalid authorization header format");
      }

      const token = match[1];

      // Verify JWT access token
      const tokenPayload = await verifyAccessToken(token);

      // Set user information on request
      req.userRef = userRef(tokenPayload.userId);
      req.session = {
        user: {
          id: tokenPayload.userId,
          email: tokenPayload.email,
        },
        expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour from now
      };

      next();
    } catch (error) {
      handleError(error, next, "requireAuth");
    }
  };

  // GET /api/subscription - Get current user's subscription details with managers
  app.get(
    "/api/subscription",
    requireAuth,
    asyncHandler(async (req, res) => {
      const currentUserRef = req.userRef;
      if (!currentUserRef) {
        throw unauthorized();
      }
      const currentUserId = currentUserRef.replace("users/", "");

      console.log(
        `[GET /api/subscription] Getting subscription for user ${currentUserId}`
      );

      // Get user's subscription (this will auto-create a free subscription if none exists)
      let subscription;
      try {
        subscription = await getUserSubscription(currentUserId);
        console.log(
          `[GET /api/subscription] Got subscription: ${subscription?.pk}, plan: ${subscription?.plan}`
        );
      } catch (error) {
        console.error(
          `[GET /api/subscription] Error getting subscription for user ${currentUserId}:`,
          error
        );
        throw error;
      }

      if (!subscription) {
        // This should never happen as getUserSubscription always returns a subscription,
        // but add defensive check just in case
        console.error(
          `[GET /api/subscription] Subscription is null for user ${currentUserId}`
        );
        throw new Error("Failed to get or create subscription");
      }

      const subscriptionId = subscription.pk.replace("subscriptions/", "");
      console.log(`[GET /api/subscription] Subscription ID: ${subscriptionId}`);

      // Get all managers (with error handling in case of issues)
      let managers: Array<{ userId: string; email: string | null }> = [];
      try {
        const managerIds = await getSubscriptionManagers(subscriptionId);
        console.log(
          `[GET /api/subscription] Found ${managerIds.length} managers`
        );

        // Get emails for all managers
        managers = await Promise.all(
          managerIds.map(async (userId) => {
            try {
              const email = await getUserEmailById(userId);
              return {
                userId,
                email: email || null,
              };
            } catch (error) {
              console.error(
                `[GET /api/subscription] Error getting email for user ${userId}:`,
                error
              );
              return {
                userId,
                email: null,
              };
            }
          })
        );
      } catch (error) {
        console.error(
          `[GET /api/subscription] Error getting managers for subscription ${subscriptionId}:`,
          error
        );
        // Continue with empty managers array rather than failing the whole request
        managers = [];
      }

      // Clean up free plans that have incorrect data (cancelled status, renewsAt, etc.)
      // Free plans should not have Lemon Squeezy data or cancelled status
      if (
        subscription.plan === "free" &&
        !subscription.lemonSqueezySubscriptionId &&
        (subscription.status === "cancelled" ||
          subscription.status === "expired" ||
          subscription.renewsAt ||
          subscription.endsAt)
      ) {
        console.log(
          `[GET /api/subscription] Cleaning up free plan with incorrect data:`,
          {
            subscriptionId,
            status: subscription.status,
            renewsAt: subscription.renewsAt,
            endsAt: subscription.endsAt,
          }
        );
        const db = await database();
        subscription = await db.subscription.update({
          ...subscription,
          status: "active", // Free plans are always active
          renewsAt: undefined, // Free plans don't renew
          endsAt: undefined, // Free plans don't end
          gracePeriodEndsAt: undefined, // Free plans don't have grace periods
        });
        console.log(
          `[GET /api/subscription] Cleaned up free plan subscription ${subscriptionId}`
        );
      }

      // Get effective plan (returns "free" if subscription is cancelled/expired)
      const effectivePlan = getEffectivePlan(subscription);

      console.log(`[GET /api/subscription] Subscription plan details:`, {
        subscriptionId,
        rawPlan: subscription.plan,
        effectivePlan,
        status: subscription.status,
        lemonSqueezySubscriptionId: subscription.lemonSqueezySubscriptionId,
        lemonSqueezyVariantId: subscription.lemonSqueezyVariantId,
        lemonSqueezyCustomerId: subscription.lemonSqueezyCustomerId,
        endsAt: subscription.endsAt,
        lastSyncedAt: subscription.lastSyncedAt,
        isActive:
          subscription.status === "active" ||
          subscription.status === "on_trial",
        isCancelled: subscription.status === "cancelled",
        hasEndsAt: !!subscription.endsAt,
        willShowAsFree: effectivePlan === "free",
        reasonForFree:
          effectivePlan === "free"
            ? subscription.status === "cancelled"
              ? "cancelled"
              : !subscription.lemonSqueezySubscriptionId
              ? "no_lemon_squeezy_id"
              : "inactive"
            : "none",
      });

      // Get plan limits based on effective plan
      const limits = getPlanLimits(effectivePlan);
      if (!limits) {
        console.error(`[GET /api/subscription] Invalid plan: ${effectivePlan}`);
        throw new Error(`Invalid subscription plan: ${effectivePlan}`);
      }

      // Get usage statistics
      let usage;
      try {
        const workspaces = await getSubscriptionWorkspaces(subscriptionId);
        const { documents, totalSize } = await getSubscriptionDocuments(
          subscriptionId
        );
        const agents = await getSubscriptionAgents(subscriptionId);
        const { count: uniqueUsers } = await getSubscriptionUniqueUsers(
          subscriptionId
        );
        const agentKeys = await getSubscriptionAgentKeys(subscriptionId);
        const channels = await getSubscriptionChannels(subscriptionId);
        const mcpServers = await getSubscriptionMcpServers(subscriptionId);

        usage = {
          workspaces: workspaces.length,
          documents: documents.length,
          documentSizeBytes: totalSize,
          agents,
          users: uniqueUsers,
          agentKeys,
          channels,
          mcpServers,
        };
      } catch (error) {
        console.error(
          `[GET /api/subscription] Error getting usage statistics for subscription ${subscriptionId}:`,
          error
        );
        // Continue with default usage values rather than failing the whole request
        usage = {
          workspaces: 0,
          documents: 0,
          documentSizeBytes: 0,
          agents: 0,
          users: 0,
          agentKeys: 0,
          channels: 0,
          mcpServers: 0,
        };
      }

      const response = {
        subscriptionId,
        plan: effectivePlan,
        expiresAt: subscription.expiresAt || null,
        createdAt: subscription.createdAt,
        // Lemon Squeezy fields
        status: subscription.status || "active",
        renewsAt: subscription.renewsAt || null,
        endsAt: subscription.endsAt || null,
        gracePeriodEndsAt: subscription.gracePeriodEndsAt || null,
        managers,
        limits: {
          maxWorkspaces: limits.maxWorkspaces,
          maxDocuments: limits.maxDocuments,
          maxDocumentSizeBytes: limits.maxDocumentSizeBytes,
          maxAgents: limits.maxAgents,
          maxUsers: limits.maxUsers,
          maxManagers: limits.maxManagers,
          maxDailyRequests: limits.maxDailyRequests,
          maxAgentKeys: limits.maxAgentKeys,
          maxChannels: limits.maxChannels,
          maxMcpServers: limits.maxMcpServers,
        },
        usage,
      };

      console.log(
        `[GET /api/subscription] Returning subscription data for user ${currentUserId}:`,
        JSON.stringify(response)
      );

      // Send the response
      res.json(response);
    })
  );

  // GET /api/users/by-email/:email - Find user by email address
  app.get(
    "/api/users/by-email/:email",
    requireAuth,
    asyncHandler(async (req, res) => {
      const email = decodeURIComponent(req.params.email);

      const user = await getUserByEmail(email);
      if (!user) {
        throw notFound("User not found");
      }

      res.json({
        userId: user.userId,
        email: user.email,
      });
    })
  );

  // POST /api/subscription/managers/:userId - Add manager to current user's subscription
  app.post(
    "/api/subscription/managers/:userId",
    requireAuth,
    asyncHandler(async (req, res) => {
      const targetUserId = req.params.userId;
      const currentUserRef = req.userRef;
      if (!currentUserRef) {
        throw unauthorized();
      }
      const currentUserId = currentUserRef.replace("users/", "");

      // Get current user's subscription
      const subscription = await getUserSubscription(currentUserId);
      const subscriptionId = subscription.pk.replace("subscriptions/", "");

      // Check if current user is a manager of the subscription
      const isManager = await isSubscriptionManager(
        currentUserId,
        subscriptionId
      );
      if (!isManager) {
        throw forbidden(
          "You must be a manager of this subscription to add other managers"
        );
      }

      // Validate that target user can be added as manager
      await validateCanAddAsManager(targetUserId, subscriptionId);

      // Add manager
      await addSubscriptionManager(subscriptionId, targetUserId, currentUserId);

      res.status(201).json({
        message: "Manager added successfully",
        subscriptionId,
        userId: targetUserId,
      });
    })
  );

  // DELETE /api/subscription/managers/:userId - Remove manager from current user's subscription
  app.delete(
    "/api/subscription/managers/:userId",
    requireAuth,
    asyncHandler(async (req, res) => {
      const targetUserId = req.params.userId;
      const currentUserRef = req.userRef;
      if (!currentUserRef) {
        throw unauthorized();
      }
      const currentUserId = currentUserRef.replace("users/", "");

      // Get current user's subscription
      const subscription = await getUserSubscription(currentUserId);
      const subscriptionId = subscription.pk.replace("subscriptions/", "");

      // Check if current user is a manager of the subscription
      const isManager = await isSubscriptionManager(
        currentUserId,
        subscriptionId
      );
      if (!isManager) {
        throw forbidden(
          "You must be a manager of this subscription to remove managers"
        );
      }

      // Validate that manager can be removed (not the last one)
      await validateCanRemoveManager(subscriptionId);

      // Remove manager
      await removeSubscriptionManager(subscriptionId, targetUserId);

      res.status(204).send();
    })
  );

  // POST /api/subscriptions/:subscriptionId/managers/:userId - Add manager to subscription
  app.post(
    "/api/subscriptions/:subscriptionId/managers/:userId",
    requireAuth,
    asyncHandler(async (req, res) => {
      const subscriptionId = req.params.subscriptionId;
      const targetUserId = req.params.userId;
      const currentUserRef = req.userRef;
      if (!currentUserRef) {
        throw unauthorized();
      }
      const currentUserId = currentUserRef.replace("users/", "");

      // Check if current user is a manager of the subscription
      const isManager = await isSubscriptionManager(
        currentUserId,
        subscriptionId
      );
      if (!isManager) {
        throw forbidden(
          "You must be a manager of this subscription to add other managers"
        );
      }

      // Validate that target user can be added as manager
      await validateCanAddAsManager(targetUserId, subscriptionId);

      // Add manager
      await addSubscriptionManager(subscriptionId, targetUserId, currentUserId);

      res.status(201).json({
        message: "Manager added successfully",
        subscriptionId,
        userId: targetUserId,
      });
    })
  );

  // DELETE /api/subscriptions/:subscriptionId/managers/:userId - Remove manager from subscription
  app.delete(
    "/api/subscriptions/:subscriptionId/managers/:userId",
    requireAuth,
    asyncHandler(async (req, res) => {
      const subscriptionId = req.params.subscriptionId;
      const targetUserId = req.params.userId;
      const currentUserRef = req.userRef;
      if (!currentUserRef) {
        throw unauthorized();
      }
      const currentUserId = currentUserRef.replace("users/", "");

      // Check if current user is a manager of the subscription
      const isManager = await isSubscriptionManager(
        currentUserId,
        subscriptionId
      );
      if (!isManager) {
        throw forbidden(
          "You must be a manager of this subscription to remove managers"
        );
      }

      // Validate that manager can be removed (not the last one)
      await validateCanRemoveManager(subscriptionId);

      // Remove manager
      await removeSubscriptionManager(subscriptionId, targetUserId);

      res.status(204).send();
    })
  );

  // POST /api/subscription/checkout - Create Lemon Squeezy checkout for plan upgrade
  // Note: API Gateway strips /api/subscription prefix for catchall routes, so we use /checkout
  app.post(
    "/checkout",
    requireAuth,
    asyncHandler(async (req, res) => {
      const currentUserRef = req.userRef;
      if (!currentUserRef) {
        throw unauthorized();
      }
      const currentUserId = currentUserRef.replace("users/", "");

      const { plan } = req.body;
      if (plan !== "starter" && plan !== "pro") {
        throw badRequest('Plan must be "starter" or "pro"');
      }

      // Get variant ID for the plan
      const variantId =
        plan === "starter"
          ? process.env.LEMON_SQUEEZY_STARTER_VARIANT_ID
          : process.env.LEMON_SQUEEZY_PRO_VARIANT_ID;

      if (!variantId) {
        throw badRequest(
          `LEMON_SQUEEZY_${plan.toUpperCase()}_VARIANT_ID is not configured`
        );
      }

      // Get store ID
      const storeId = process.env.LEMON_SQUEEZY_STORE_ID;
      if (!storeId) {
        throw new Error("LEMON_SQUEEZY_STORE_ID is not configured");
      }

      // Get user's subscription to include subscription ID in checkout
      console.log(
        `[POST /api/subscription/checkout] Getting subscription for user ${currentUserId}`
      );
      const subscription = await getUserSubscription(currentUserId);
      const subscriptionId = subscription.pk.replace("subscriptions/", "");

      console.log(
        `[POST /api/subscription/checkout] Current subscription state:`,
        {
          subscriptionId,
          currentPlan: subscription.plan,
          status: subscription.status,
          lemonSqueezySubscriptionId: subscription.lemonSqueezySubscriptionId,
          lemonSqueezyVariantId: subscription.lemonSqueezyVariantId,
          requestedPlan: plan,
        }
      );

      // Check if user has a cancelled subscription with the same plan
      // If so, we should reactivate it instead of creating a new checkout
      if (
        subscription.lemonSqueezySubscriptionId &&
        subscription.status === "cancelled"
      ) {
        // Check if the cancelled subscription is for the same plan
        const starterVariantId = process.env.LEMON_SQUEEZY_STARTER_VARIANT_ID;
        const proVariantId = process.env.LEMON_SQUEEZY_PRO_VARIANT_ID;
        const currentVariantId = subscription.lemonSqueezyVariantId;
        const targetVariantId =
          plan === "starter" ? starterVariantId : proVariantId;

        if (!targetVariantId) {
          throw badRequest(
            `LEMON_SQUEEZY_${plan.toUpperCase()}_VARIANT_ID is not configured`
          );
        }

        // If same plan, try to reactivate by updating the variant (this reactivates the subscription)
        if (currentVariantId === targetVariantId) {
          console.log(
            `[POST /api/subscription/checkout] Reactivating cancelled subscription ${subscription.lemonSqueezySubscriptionId} for ${plan} plan`
          );

          try {
            // Update the variant to reactivate the subscription
            await updateSubscriptionVariant(
              subscription.lemonSqueezySubscriptionId,
              targetVariantId
            );

            // Sync the subscription to verify the variant and get updated status
            const db = await database();
            const lemonSqueezySub = await getLemonSqueezySubscription(
              subscription.lemonSqueezySubscriptionId
            );
            const attributes = lemonSqueezySub.attributes;
            const actualVariantId = String(attributes.variant_id);

            console.log(
              `[POST /api/subscription/checkout] Variant update verification:`,
              {
                requestedVariantId: targetVariantId,
                actualVariantId,
                variantChanged: actualVariantId === targetVariantId,
                status: attributes.status,
                renewsAt: attributes.renews_at,
                endsAt: attributes.ends_at,
              }
            );

            // If variant didn't change, Lemon Squeezy likely requires payment confirmation
            // Fall through to create a checkout URL
            if (actualVariantId !== targetVariantId) {
              console.log(
                `[POST /api/subscription/checkout] Variant did not change (${actualVariantId} !== ${targetVariantId}). ` +
                  `Lemon Squeezy likely requires payment confirmation. Creating checkout URL.`
              );
              // Fall through to create a new checkout
            } else if (
              attributes.status === "cancelled" ||
              attributes.status === "expired"
            ) {
              // Variant changed but status is still cancelled/expired
              // This means Lemon Squeezy requires payment confirmation to reactivate
              // If we update with cancelled status, getEffectivePlan will return "free"
              // So we need to create a checkout URL instead
              console.log(
                `[POST /api/subscription/checkout] Variant changed but status is still ${attributes.status}. ` +
                  `Lemon Squeezy requires payment confirmation to reactivate. ` +
                  `If we update now, subscription will show as "free" due to cancelled status. Creating checkout URL.`
              );
              // Fall through to create a new checkout
            } else {
              // Variant is correct and status is active, update subscription record
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
                lemonSqueezyVariantId: actualVariantId,
                lemonSqueezySyncKey: "ACTIVE", // Restore GSI key
                lastSyncedAt: new Date().toISOString(),
              });

              // Update API Gateway usage plan association
              const { associateSubscriptionWithPlan } = await import(
                "../../utils/apiGatewayUsagePlans"
              );
              await associateSubscriptionWithPlan(subscriptionId, plan);

              console.log(
                `[POST /api/subscription/checkout] Successfully reactivated subscription for ${plan} plan`
              );

              res.json({
                success: true,
                message: `Subscription reactivated successfully. You are now on the ${plan} plan.`,
                reactivated: true,
              });
              return;
            }
          } catch (error) {
            console.error(
              `[POST /api/subscription/checkout] Error reactivating subscription:`,
              error
            );
            // If reactivation fails, fall through to create a new checkout
          }
        } else {
          // Different plan - update the variant to change plan and reactivate
          console.log(
            `[POST /api/subscription/checkout] Reactivating cancelled subscription and changing to ${plan} plan`
          );

          try {
            await updateSubscriptionVariant(
              subscription.lemonSqueezySubscriptionId,
              targetVariantId
            );

            // Sync the subscription to verify the variant actually changed
            const db = await database();
            const lemonSqueezySub = await getLemonSqueezySubscription(
              subscription.lemonSqueezySubscriptionId
            );
            const attributes = lemonSqueezySub.attributes;
            const actualVariantId = String(attributes.variant_id);

            console.log(
              `[POST /api/subscription/checkout] Variant update verification:`,
              {
                requestedVariantId: targetVariantId,
                actualVariantId,
                variantChanged: actualVariantId === targetVariantId,
                status: attributes.status,
                renewsAt: attributes.renews_at,
                endsAt: attributes.ends_at,
              }
            );

            // If variant didn't change, Lemon Squeezy likely requires payment confirmation
            // Fall through to create a checkout URL
            if (actualVariantId !== targetVariantId) {
              console.log(
                `[POST /api/subscription/checkout] Variant did not change (${actualVariantId} !== ${targetVariantId}). ` +
                  `Lemon Squeezy likely requires payment confirmation. Creating checkout URL.`
              );
              // Fall through to create a new checkout
            } else if (
              attributes.status === "cancelled" ||
              attributes.status === "expired"
            ) {
              // Variant changed but status is still cancelled/expired
              // This means Lemon Squeezy requires payment confirmation to reactivate
              // If we update with cancelled status, getEffectivePlan will return "free"
              // So we need to create a checkout URL instead
              console.log(
                `[POST /api/subscription/checkout] Variant changed but status is still ${attributes.status}. ` +
                  `Lemon Squeezy requires payment confirmation to reactivate. ` +
                  `If we update now, subscription will show as "free" due to cancelled status. Creating checkout URL.`
              );
              // Fall through to create a new checkout
            } else {
              // Variant changed successfully and status is active, update local database
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
                lemonSqueezyVariantId: actualVariantId,
                lemonSqueezySyncKey: "ACTIVE",
                lastSyncedAt: new Date().toISOString(),
              });

              const { associateSubscriptionWithPlan } = await import(
                "../../utils/apiGatewayUsagePlans"
              );
              await associateSubscriptionWithPlan(subscriptionId, plan);

              console.log(
                `[POST /api/subscription/checkout] Successfully reactivated and changed subscription to ${plan} plan`
              );

              res.json({
                success: true,
                message: `Subscription reactivated and changed to ${plan} plan.`,
                reactivated: true,
              });
              return;
            }
          } catch (error) {
            console.error(
              `[POST /api/subscription/checkout] Error reactivating and changing plan:`,
              error
            );
            // Fall through to create a new checkout
          }
        }
      }

      // Log for debugging
      console.log(
        `[POST /api/subscription/checkout] Creating checkout for ${plan} plan:`,
        {
          storeId,
          variantId,
          userId: currentUserId,
          subscriptionId,
          currentPlan: subscription.plan,
          hasLemonSqueezySubscription:
            !!subscription.lemonSqueezySubscriptionId,
        }
      );

      // Create checkout (for new subscriptions or if reactivation failed)
      // Note: For free subscriptions, this will create a new Lemon Squeezy subscription
      // The webhook (subscription_created) will update the subscription when checkout completes
      console.log(
        `[POST /api/subscription/checkout] Calling createCheckout with custom data:`,
        {
          userId: currentUserId,
          subscriptionId,
        }
      );

      const checkout = await createCheckout({
        storeId,
        variantId,
        checkoutData: {
          custom: {
            userId: currentUserId,
            subscriptionId,
          },
          email: req.session?.user?.email || undefined,
        },
        checkoutOptions: {
          embed: false,
          media: false,
        },
      });

      console.log(`[POST /api/subscription/checkout] Checkout created:`, {
        checkoutUrl: checkout.url,
        hasUrl: !!checkout.url,
      });

      if (!checkout.url) {
        console.error(
          `[POST /api/subscription/checkout] ERROR: Checkout URL not returned from Lemon Squeezy`
        );
        throw internal("Checkout URL not returned from Lemon Squeezy");
      }

      console.log(
        `[POST /api/subscription/checkout] Returning checkout URL to user. ` +
          `Subscription will be updated via webhook (subscription_created) when checkout completes.`
      );

      res.json({
        checkoutUrl: checkout.url,
      });
    })
  );

  // POST /api/subscription/change-plan - Change subscription plan (upgrade or downgrade)
  // Note: API Gateway strips /api/subscription prefix for catchall routes, so we use /change-plan
  app.post(
    "/change-plan",
    requireAuth,
    asyncHandler(async (req, res) => {
      const currentUserRef = req.userRef;
      if (!currentUserRef) {
        throw unauthorized();
      }
      const currentUserId = currentUserRef.replace("users/", "");

      const { plan } = req.body;
      if (plan !== "starter" && plan !== "pro") {
        throw badRequest('Plan must be "starter" or "pro"');
      }

      // Get user's subscription
      const subscription = await getUserSubscription(currentUserId);

      // Check if user has an active Lemon Squeezy subscription
      if (!subscription.lemonSqueezySubscriptionId) {
        // No existing subscription, create a checkout instead
        throw badRequest(
          "No active subscription found. Please use the checkout endpoint to create a new subscription."
        );
      }

      // Check if user is on free plan (should use checkout, not change-plan)
      if (
        subscription.plan === "free" ||
        !subscription.status ||
        subscription.status === "expired"
      ) {
        throw badRequest(
          "Cannot change plan for free or expired subscriptions. Please use the checkout endpoint to upgrade."
        );
      }

      // Get variant ID for the new plan
      const variantId =
        plan === "starter"
          ? process.env.LEMON_SQUEEZY_STARTER_VARIANT_ID
          : process.env.LEMON_SQUEEZY_PRO_VARIANT_ID;

      if (!variantId) {
        throw badRequest(
          `LEMON_SQUEEZY_${plan.toUpperCase()}_VARIANT_ID is not configured`
        );
      }

      // Check if already on this plan
      const currentVariantId = subscription.lemonSqueezyVariantId;
      if (currentVariantId === variantId) {
        // If subscription is cancelled, we should reactivate it instead of throwing an error
        if (subscription.status === "cancelled") {
          console.log(
            `[POST /api/subscription/change-plan] Reactivating cancelled subscription ${subscription.lemonSqueezySubscriptionId} for ${plan} plan`
          );

          // Update the variant to reactivate the subscription
          await updateSubscriptionVariant(
            subscription.lemonSqueezySubscriptionId,
            variantId
          );

          // Sync the subscription to get updated status
          const db = await database();
          const lemonSqueezySub = await getLemonSqueezySubscription(
            subscription.lemonSqueezySubscriptionId
          );
          const attributes = lemonSqueezySub.attributes;

          // Update subscription record
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
            lemonSqueezySyncKey: "ACTIVE", // Restore GSI key
            lastSyncedAt: new Date().toISOString(),
          });

          // Update API Gateway usage plan association
          const subscriptionId = subscription.pk.replace("subscriptions/", "");
          const { associateSubscriptionWithPlan } = await import(
            "../../utils/apiGatewayUsagePlans"
          );
          await associateSubscriptionWithPlan(subscriptionId, plan);

          console.log(
            `[POST /api/subscription/change-plan] Successfully reactivated subscription for ${plan} plan`
          );

          res.json({
            success: true,
            message: `Subscription reactivated successfully. You are now on the ${plan} plan.`,
            reactivated: true,
          });
          return;
        } else {
          throw badRequest(`You are already on the ${plan} plan`);
        }
      }

      console.log(
        `[POST /api/subscription/change-plan] Changing plan for subscription ${subscription.lemonSqueezySubscriptionId} from variant ${currentVariantId} to ${variantId}`
      );

      // Update subscription variant in Lemon Squeezy
      // If this fails (e.g., payment required), we still return success
      // as the webhook will update the subscription eventually
      try {
        await updateSubscriptionVariant(
          subscription.lemonSqueezySubscriptionId,
          variantId
        );

        // The webhook will update the subscription when Lemon Squeezy processes the change
        // But we can also sync immediately to get the updated data
        const db = await database();
        try {
          const lemonSqueezySub = await getLemonSqueezySubscription(
            subscription.lemonSqueezySubscriptionId
          );
          const attributes = lemonSqueezySub.attributes;

          // Map variant ID to plan
          const starterVariantId = process.env.LEMON_SQUEEZY_STARTER_VARIANT_ID;
          const proVariantId = process.env.LEMON_SQUEEZY_PRO_VARIANT_ID;
          const newVariantId = String(attributes.variant_id);
          const newPlan =
            newVariantId === starterVariantId
              ? "starter"
              : newVariantId === proVariantId
              ? "pro"
              : "starter"; // Default fallback

          // Update subscription record
          await db.subscription.update({
            ...subscription,
            plan: newPlan,
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
            lemonSqueezyVariantId: newVariantId,
            lemonSqueezySyncKey: subscription.lemonSqueezySubscriptionId
              ? "ACTIVE"
              : undefined,
            lastSyncedAt: new Date().toISOString(),
          });

          // Update API Gateway usage plan association
          const subscriptionId = subscription.pk.replace("subscriptions/", "");
          const { associateSubscriptionWithPlan } = await import(
            "../../utils/apiGatewayUsagePlans"
          );
          await associateSubscriptionWithPlan(subscriptionId, newPlan);

          console.log(
            `[POST /api/subscription/change-plan] Successfully changed plan to ${newPlan}`
          );
        } catch (error) {
          console.error(
            `[POST /api/subscription/change-plan] Error syncing subscription after plan change:`,
            error
          );
          // Don't fail the request - the webhook will update it eventually
        }
      } catch (error) {
        console.error(
          `[POST /api/subscription/change-plan] Error updating subscription variant:`,
          error
        );
        // Don't fail the request - the webhook will update it eventually
        // This handles cases where payment is required or other API errors occur
      }

      res.json({
        success: true,
        message: `Plan changed to ${plan} successfully.`,
      });
    })
  );

  // POST /api/subscription/cancel - Cancel subscription
  // Note: API Gateway strips /api/subscription prefix for catchall routes, so we use /cancel
  app.post(
    "/cancel",
    requireAuth,
    asyncHandler(async (req, res) => {
      const currentUserRef = req.userRef;
      if (!currentUserRef) {
        throw unauthorized();
      }
      const currentUserId = currentUserRef.replace("users/", "");

      const subscription = await getUserSubscription(currentUserId);

      if (!subscription.lemonSqueezySubscriptionId) {
        throw badRequest("Subscription is not associated with Lemon Squeezy");
      }

      // Cancel subscription via Lemon Squeezy
      await cancelLemonSqueezySubscription(
        subscription.lemonSqueezySubscriptionId
      );

      // Fetch updated subscription from Lemon Squeezy to get endsAt date
      const lemonSqueezySub = await getLemonSqueezySubscription(
        subscription.lemonSqueezySubscriptionId
      );

      // Update subscription status (webhook will also update it, but update immediately)
      const db = await database();
      await db.subscription.update({
        ...subscription,
        status: "cancelled",
        endsAt: lemonSqueezySub.attributes.ends_at || undefined,
        lemonSqueezySyncKey: undefined, // Remove from GSI when cancelled
        lastSyncedAt: new Date().toISOString(),
      });

      res.json({ success: true });
    })
  );

  // GET /api/subscription/portal - Get customer portal URL
  // Note: API Gateway strips /api/subscription prefix for catchall routes, so we use /portal
  app.get(
    "/portal",
    requireAuth,
    asyncHandler(async (req, res) => {
      const currentUserRef = req.userRef;
      if (!currentUserRef) {
        throw unauthorized();
      }
      const currentUserId = currentUserRef.replace("users/", "");

      const subscription = await getUserSubscription(currentUserId);

      if (!subscription.lemonSqueezySubscriptionId) {
        throw badRequest("Subscription is not associated with Lemon Squeezy");
      }

      // Use the Lemon Squeezy orders page as the portal URL
      const portalUrl = "https://app.lemonsqueezy.com/my-orders";

      res.json({
        portalUrl,
      });
    })
  );

  // POST /api/subscription/sync - Sync subscription from Lemon Squeezy
  // Note: API Gateway strips /api/subscription prefix for catchall routes, so we use /sync
  app.post(
    "/sync",
    requireAuth,
    asyncHandler(async (req, res) => {
      const currentUserRef = req.userRef;
      if (!currentUserRef) {
        throw unauthorized();
      }
      const currentUserId = currentUserRef.replace("users/", "");

      console.log(
        `[POST /api/subscription/sync] Starting sync for user ${currentUserId}`
      );

      const subscription = await getUserSubscription(currentUserId);
      const subscriptionId = subscription.pk.replace("subscriptions/", "");

      console.log(`[POST /api/subscription/sync] Current subscription state:`, {
        subscriptionId,
        plan: subscription.plan,
        status: subscription.status,
        lemonSqueezySubscriptionId: subscription.lemonSqueezySubscriptionId,
        lemonSqueezyVariantId: subscription.lemonSqueezyVariantId,
        lemonSqueezyCustomerId: subscription.lemonSqueezyCustomerId,
        lastSyncedAt: subscription.lastSyncedAt,
      });

      // Helper to map variant ID to plan
      const variantIdToPlan = (variantId: string): "starter" | "pro" => {
        const starterVariantId = process.env.LEMON_SQUEEZY_STARTER_VARIANT_ID;
        const proVariantId = process.env.LEMON_SQUEEZY_PRO_VARIANT_ID;

        if (variantId === starterVariantId) {
          return "starter";
        }
        if (variantId === proVariantId) {
          return "pro";
        }

        console.warn(
          `[POST /api/subscription/sync] Unknown variant ID ${variantId}, defaulting to starter`
        );
        return "starter";
      };

      if (!subscription.lemonSqueezySubscriptionId) {
        // No Lemon Squeezy subscription to sync
        // This can happen if:
        // 1. User is on free plan and hasn't completed checkout yet
        // 2. User just completed checkout but webhook hasn't processed yet
        // In case 2, we should try to find the subscription by customer ID or email
        console.log(
          `[POST /api/subscription/sync] No Lemon Squeezy subscription ID found for subscription ${subscriptionId}. ` +
            `Attempting to find subscription by customer ID or email...`
        );

        // Try to find subscription by customer ID if we have it
        if (subscription.lemonSqueezyCustomerId) {
          console.log(
            `[POST /api/subscription/sync] Attempting to find subscription by customer ID: ${subscription.lemonSqueezyCustomerId}`
          );
          try {
            const customerSubscriptions = await listSubscriptionsByCustomer(
              subscription.lemonSqueezyCustomerId
            );

            console.log(
              `[POST /api/subscription/sync] Found ${customerSubscriptions.length} subscription(s) for customer ${subscription.lemonSqueezyCustomerId}`
            );

            if (customerSubscriptions.length > 0) {
              // Get the most recent active subscription (not cancelled)
              const activeSubscription =
                customerSubscriptions.find(
                  (sub) => sub.attributes.status !== "cancelled"
                ) || customerSubscriptions[0];

              console.log(
                `[POST /api/subscription/sync] Using subscription ${activeSubscription.id} from customer lookup`
              );

              // Update subscription with the found Lemon Squeezy subscription ID
              const db = await database();
              const attributes = activeSubscription.attributes;
              const plan = variantIdToPlan(String(attributes.variant_id));

              console.log(
                `[POST /api/subscription/sync] Updating subscription ${subscriptionId} with found Lemon Squeezy subscription:`,
                {
                  lemonSqueezySubscriptionId: activeSubscription.id,
                  plan,
                  variantId: attributes.variant_id,
                  status: attributes.status,
                }
              );

              const updatedSubscription = await db.subscription.update({
                ...subscription,
                plan,
                lemonSqueezySubscriptionId: activeSubscription.id,
                lemonSqueezyCustomerId: String(attributes.customer_id),
                lemonSqueezyOrderId: String(attributes.order_id),
                lemonSqueezyVariantId: String(attributes.variant_id),
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
                lemonSqueezySyncKey: "ACTIVE",
                lastSyncedAt: new Date().toISOString(),
              });

              console.log(
                `[POST /api/subscription/sync] Successfully updated subscription ${subscriptionId} from customer lookup:`,
                {
                  oldPlan: subscription.plan,
                  newPlan: updatedSubscription.plan,
                  status: updatedSubscription.status,
                }
              );

              // Update API Gateway usage plan association
              try {
                const { associateSubscriptionWithPlan } = await import(
                  "../../utils/apiGatewayUsagePlans"
                );
                await associateSubscriptionWithPlan(subscriptionId, plan);
                console.log(
                  `[POST /api/subscription/sync] Associated subscription ${subscriptionId} with ${plan} usage plan`
                );
              } catch (error) {
                console.error(
                  `[POST /api/subscription/sync] Error associating subscription with usage plan:`,
                  error
                );
              }

              res.json({
                message:
                  "Subscription synced successfully from customer lookup",
                synced: true,
              });
              return;
            }
          } catch (error) {
            console.error(
              `[POST /api/subscription/sync] Error looking up subscriptions by customer ID:`,
              error
            );
            // Continue to fallback behavior
          }
        }

        // Fallback: Try to find by user email if we have it
        console.log(
          `[POST /api/subscription/sync] Customer ID lookup failed or no customer ID. ` +
            `Subscription may not be associated with Lemon Squeezy yet, or webhook hasn't processed.`
        );

        res.json({
          message:
            "Subscription is not associated with Lemon Squeezy. If you just completed checkout, please wait a moment and refresh.",
          synced: false,
        });
        return;
      }

      const db = await database();

      try {
        console.log(
          `[POST /api/subscription/sync] Fetching subscription from Lemon Squeezy: ${subscription.lemonSqueezySubscriptionId}`
        );
        // Fetch latest data from Lemon Squeezy
        const lemonSqueezySub = await getLemonSqueezySubscription(
          subscription.lemonSqueezySubscriptionId
        );
        const attributes = lemonSqueezySub.attributes;

        console.log(
          `[POST /api/subscription/sync] Lemon Squeezy subscription data:`,
          {
            variant_id: attributes.variant_id,
            status: attributes.status,
            renews_at: attributes.renews_at,
            ends_at: attributes.ends_at,
          }
        );

        // Map variant ID to plan
        const variantId = String(attributes.variant_id);
        const plan = variantIdToPlan(variantId);

        const starterVariantIdEnv =
          process.env.LEMON_SQUEEZY_STARTER_VARIANT_ID;
        const proVariantIdEnv = process.env.LEMON_SQUEEZY_PRO_VARIANT_ID;
        console.log(`[POST /api/subscription/sync] Plan mapping:`, {
          variantId,
          starterVariantId: starterVariantIdEnv,
          proVariantId: proVariantIdEnv,
          mappedPlan: plan,
          currentPlan: subscription.plan,
          planWillChange: plan !== subscription.plan,
        });

        // Update subscription record
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
          lemonSqueezyVariantId: variantId,
          lemonSqueezySyncKey: subscription.lemonSqueezySubscriptionId
            ? "ACTIVE"
            : undefined, // Maintain GSI key if subscription has Lemon Squeezy ID
          lastSyncedAt: new Date().toISOString(),
        });

        console.log(`[POST /api/subscription/sync] Subscription updated:`, {
          subscriptionId,
          oldPlan: subscription.plan,
          newPlan: updatedSubscription.plan,
          status: updatedSubscription.status,
          lemonSqueezyVariantId: updatedSubscription.lemonSqueezyVariantId,
        });

        // Update API Gateway usage plan association
        try {
          const { associateSubscriptionWithPlan } = await import(
            "../../utils/apiGatewayUsagePlans"
          );
          console.log(
            `[POST /api/subscription/sync] Associating subscription ${subscriptionId} with ${plan} usage plan`
          );
          await associateSubscriptionWithPlan(subscriptionId, plan);
          console.log(
            `[POST /api/subscription/sync] Successfully associated subscription ${subscriptionId} with ${plan} usage plan`
          );
        } catch (error) {
          console.error(
            `[POST /api/subscription/sync] Error associating subscription ${subscriptionId} with usage plan:`,
            error
          );
          // Don't throw - subscription is updated, usage plan association can be retried
        }

        // Check grace period if needed
        const subscriptionAfterUpdate = await db.subscription.get(
          subscription.pk,
          subscription.sk
        );
        if (subscriptionAfterUpdate) {
          await checkGracePeriod(subscriptionAfterUpdate);
        }

        console.log(
          `[POST /api/subscription/sync] Successfully synced subscription ${subscriptionId} from ${subscription.plan} to ${plan}`
        );

        res.json({
          message: "Subscription synced successfully",
          synced: true,
        });
      } catch (error) {
        console.error(
          `[POST /api/subscription/sync] Error syncing subscription ${subscriptionId}:`,
          error
        );
        throw error;
      }
    })
  );

  // Error handler must be last
  app.use(expressErrorHandler);

  return app;
};
