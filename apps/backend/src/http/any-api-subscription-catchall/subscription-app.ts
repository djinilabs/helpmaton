import {
  badRequest,
  boomify,
  forbidden,
  notFound,
  unauthorized,
} from "@hapi/boom";
import express from "express";

import { database } from "../../tables";
import {
  createCheckout,
  cancelSubscription as cancelLemonSqueezySubscription,
  getCustomerPortalUrl,
  getSubscription as getLemonSqueezySubscription,
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

      // Get effective plan (returns "free" if subscription is cancelled/expired)
      const effectivePlan = getEffectivePlan(subscription);

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
      const subscription = await getUserSubscription(currentUserId);
      const subscriptionId = subscription.pk.replace("subscriptions/", "");

      // Log for debugging
      console.log(
        `[POST /api/subscription/checkout] Creating checkout for ${plan} plan:`,
        {
          storeId,
          variantId,
          userId: currentUserId,
          subscriptionId,
        }
      );

      // Create checkout
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
        throw badRequest(`You are already on the ${plan} plan`);
      }

      console.log(
        `[POST /api/subscription/change-plan] Changing plan for subscription ${subscription.lemonSqueezySubscriptionId} from variant ${currentVariantId} to ${variantId}`
      );

      // Update subscription variant in Lemon Squeezy
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

      res.json({
        success: true,
        message: `Plan changed to ${plan}. The change will take effect on your next billing cycle.`,
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

      if (!subscription.lemonSqueezyCustomerId) {
        throw badRequest("Subscription is not associated with Lemon Squeezy");
      }

      // Get customer portal URL
      const portalUrl = await getCustomerPortalUrl(
        subscription.lemonSqueezyCustomerId
      );

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
        `[POST /api/subscription/sync] Syncing subscription for user ${currentUserId}`
      );

      const subscription = await getUserSubscription(currentUserId);

      if (!subscription.lemonSqueezySubscriptionId) {
        // No Lemon Squeezy subscription to sync
        res.json({
          message: "Subscription is not associated with Lemon Squeezy",
          synced: false,
        });
        return;
      }

      const db = await database();

      try {
        // Fetch latest data from Lemon Squeezy
        const lemonSqueezySub = await getLemonSqueezySubscription(
          subscription.lemonSqueezySubscriptionId
        );
        const attributes = lemonSqueezySub.attributes;

        // Map variant ID to plan
        const starterVariantId = process.env.LEMON_SQUEEZY_STARTER_VARIANT_ID;
        const proVariantId = process.env.LEMON_SQUEEZY_PRO_VARIANT_ID;
        const variantId = String(attributes.variant_id);
        const plan =
          variantId === starterVariantId
            ? "starter"
            : variantId === proVariantId
            ? "pro"
            : "starter"; // Default fallback

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
          lemonSqueezyVariantId: variantId,
          lemonSqueezySyncKey: subscription.lemonSqueezySubscriptionId
            ? "ACTIVE"
            : undefined, // Maintain GSI key if subscription has Lemon Squeezy ID
          lastSyncedAt: new Date().toISOString(),
        });

        // Check grace period if needed
        const updatedSubscription = await db.subscription.get(
          subscription.pk,
          subscription.sk
        );
        if (updatedSubscription) {
          await checkGracePeriod(updatedSubscription);
        }

        console.log(
          `[POST /api/subscription/sync] Successfully synced subscription ${subscription.pk}`
        );

        res.json({
          message: "Subscription synced successfully",
          synced: true,
        });
      } catch (error) {
        console.error(
          `[POST /api/subscription/sync] Error syncing subscription:`,
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
