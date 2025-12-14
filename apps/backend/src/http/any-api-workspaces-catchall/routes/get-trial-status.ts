import { badRequest, resourceGone, unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import {
  getTrialDaysRemaining,
  isUserInTrialPeriod,
} from "../../../utils/trialPeriod";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/trial-status:
 *   get:
 *     summary: Get trial status
 *     description: Returns comprehensive trial period status and credit usage information for a workspace, including whether the user is still in the trial period, days remaining, whether credits have been requested, approval status, initial credit amount, and current usage percentage. Useful for displaying trial information in the UI. Requires READ permission or higher.
 *     tags:
 *       - Trial Credits
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
 *         description: Trial status information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 isInTrialPeriod:
 *                   type: boolean
 *                 daysRemaining:
 *                   type: integer
 *                 hasRequestedCredits:
 *                   type: boolean
 *                 creditsApproved:
 *                   type: boolean
 *                 initialCreditAmount:
 *                   type: number
 *                 currentUsage:
 *                   type: number
 *                   description: Percentage of credits used (0-100)
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       410:
 *         description: Workspace not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetTrialStatus = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/trial-status",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.READ),
    asyncHandler(async (req, res) => {
      const db = await database();
      const workspaceResource = req.workspaceResource;
      if (!workspaceResource) {
        throw badRequest("Workspace resource not found");
      }

      const session = req.session;
      if (!session?.user?.id) {
        throw unauthorized("User session required");
      }

      const userId = session.user.id;

      // Get workspace
      const workspace = await db.workspace.get(workspaceResource, "workspace");
      if (!workspace) {
        throw resourceGone("Workspace not found");
      }

      // Check trial period
      // TEMPORARY: Can be disabled via DISABLE_TRIAL_PERIOD_CHECK env var
      const disableTrialPeriodCheck =
        process.env.DISABLE_TRIAL_PERIOD_CHECK === "true";
      const inTrial = disableTrialPeriodCheck
        ? true
        : await isUserInTrialPeriod(userId);
      const daysRemaining = await getTrialDaysRemaining(userId);

      // Calculate usage if credits were approved
      let currentUsage = 0;
      let initialCreditAmount = 0;

      if (workspace.trialCreditApproved && workspace.trialCreditAmount) {
        initialCreditAmount = workspace.trialCreditAmount;
        const currentBalance = workspace.creditBalance ?? 0;
        const used = initialCreditAmount - currentBalance;
        currentUsage = Math.min(
          100,
          Math.max(0, (used / initialCreditAmount) * 100)
        );
      }

      res.json({
        isInTrialPeriod: inTrial,
        daysRemaining: Math.max(0, daysRemaining),
        hasRequestedCredits: workspace.trialCreditRequested || false,
        creditsApproved: workspace.trialCreditApproved || false,
        initialCreditAmount: workspace.trialCreditApproved
          ? workspace.trialCreditAmount || 0
          : 0,
        currentUsage: Math.round(currentUsage * 100) / 100, // Round to 2 decimal places
      });
    })
  );
};
