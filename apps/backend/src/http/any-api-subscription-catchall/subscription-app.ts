import { boomify, forbidden, notFound, unauthorized } from "@hapi/boom";
import express from "express";

import { getPlanLimits } from "../../utils/subscriptionPlans";
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

      // Get plan limits
      const limits = getPlanLimits(subscription.plan);
      if (!limits) {
        console.error(
          `[GET /api/subscription] Invalid plan: ${subscription.plan}`
        );
        throw new Error(`Invalid subscription plan: ${subscription.plan}`);
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
        plan: subscription.plan,
        expiresAt: subscription.expiresAt || null,
        createdAt: subscription.createdAt,
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

  // Error handler must be last
  app.use(expressErrorHandler);

  return app;
};
