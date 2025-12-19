import { badRequest } from "@hapi/boom";
import express from "express";

import { PERMISSION_LEVELS } from "../../../tables/schema";
import { getPlanLimits } from "../../../utils/subscriptionPlans";
import {
  getWorkspaceSubscription,
  getSubscriptionUniqueUsers,
} from "../../../utils/subscriptionUtils";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/user-limit:
 *   get:
 *     summary: Get workspace user limit
 *     description: Returns the current user count, maximum users allowed based on the workspace's subscription plan, plan name, and whether more users can be invited. Useful for checking if the workspace has reached its user limit before inviting new members. Requires READ permission or higher.
 *     tags:
 *       - Workspace Members
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: workspaceId
 *         in: path
 *         required: true
 *         description: Workspace ID
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User limit information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 currentUserCount:
 *                   type: integer
 *                   description: Current number of users in workspace
 *                 maxUsers:
 *                   type: integer
 *                   description: Maximum users allowed by subscription plan
 *                 plan:
 *                   type: string
 *                   description: Subscription plan name
 *                 canInvite:
 *                   type: boolean
 *                   description: Whether more users can be invited
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetWorkspaceUserLimit = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/user-limit",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.READ),
    asyncHandler(async (req, res) => {
      const { workspaceId } = req.params;

      // Get workspace subscription
      const subscription = await getWorkspaceSubscription(workspaceId);
      if (!subscription) {
        throw badRequest("Workspace has no subscription");
      }

      const subscriptionId = subscription.pk.replace("subscriptions/", "");
      const plan = subscription.plan;

      // Get plan limits
      const limits = getPlanLimits(plan);
      if (!limits) {
        throw badRequest(`Invalid subscription plan: ${plan}`);
      }

      // Get current user count
      const { count } = await getSubscriptionUniqueUsers(subscriptionId);

      // Check if can invite (current count is less than max)
      const canInvite = count < limits.maxUsers;

      // Log for debugging E2E tests
      if (process.env.E2E_OVERRIDE_MAX_USERS) {
        console.log(
          `[E2E] User limit check: plan=${plan}, count=${count}, maxUsers=${limits.maxUsers}, canInvite=${canInvite}, E2E_OVERRIDE_MAX_USERS=${process.env.E2E_OVERRIDE_MAX_USERS}`
        );
      }

      res.json({
        currentUserCount: count,
        maxUsers: limits.maxUsers,
        plan,
        canInvite,
      });
    })
  );
};
