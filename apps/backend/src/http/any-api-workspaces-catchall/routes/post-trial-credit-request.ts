import { badRequest, resourceGone, unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { validateCloudflareTurnstile } from "../../../utils/captcha";
import { trackBusinessEvent } from "../../../utils/tracking";
import { sendTrialCreditRequestNotification } from "../../../utils/trialCreditNotifications";
import { isUserInTrialPeriod } from "../../../utils/trialPeriod";
import { validateBody } from "../../utils/bodyValidation";
import { trialCreditRequestSchema } from "../../utils/schemas/workspaceSchemas";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/trial-credit-request:
 *   post:
 *     summary: Request trial credits
 *     description: Submits a request for trial credits for a workspace. Requires CAPTCHA validation (Cloudflare Turnstile token) and the user must be within the 7-day trial period from account creation. Only one request can be made per workspace. The request is sent to administrators for approval. Requires WRITE permission or higher.
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - captchaToken
 *               - reason
 *             properties:
 *               captchaToken:
 *                 type: string
 *                 description: Cloudflare Turnstile CAPTCHA token
 *               reason:
 *                 type: string
 *                 description: Reason for requesting trial credits
 *     responses:
 *       201:
 *         description: Trial credit request submitted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
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
export const registerPostTrialCreditRequest = (app: express.Application) => {
  app.post(
    "/api/workspaces/:workspaceId/trial-credit-request",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    asyncHandler(async (req, res) => {
      const db = await database();
      const workspaceId = req.params.workspaceId;
      const workspaceResource = req.workspaceResource;
      if (!workspaceResource) {
        throw badRequest("Workspace resource not found");
      }

      const session = req.session;
      if (!session?.user?.id || !session?.user?.email) {
        throw unauthorized("User session required");
      }

      const userId = session.user.id;
      const userEmail = session.user.email;

      // Validate user is in trial period
      // TEMPORARY: Can be disabled via DISABLE_TRIAL_PERIOD_CHECK env var
      const disableTrialPeriodCheck =
        process.env.DISABLE_TRIAL_PERIOD_CHECK === "true";
      if (!disableTrialPeriodCheck) {
        const inTrial = await isUserInTrialPeriod(userId);
        if (!inTrial) {
          throw badRequest(
            "Trial period has expired. Trial credits are only available within 7 days of account creation."
          );
        }
      }

      // Get workspace
      const workspace = await db.workspace.get(workspaceResource, "workspace");
      if (!workspace) {
        throw resourceGone("Workspace not found");
      }

      // Check if user has already requested credits for this workspace
      if (workspace.trialCreditRequested) {
        throw badRequest(
          "Trial credits have already been requested for this workspace."
        );
      }

      // Validate CAPTCHA token
      const body = validateBody(req.body, trialCreditRequestSchema);
      const { captchaToken, reason } = body;

      // Get user IP from request
      const userIp = req.ip || req.socket.remoteAddress || "unknown";
      const captchaValid = await validateCloudflareTurnstile(
        captchaToken,
        userIp
      );
      if (!captchaValid) {
        throw badRequest("CAPTCHA validation failed. Please try again.");
      }

      // Create trial credit request record
      const requestPk = `trial-credit-requests/${workspaceId}`;
      const requestSk = "request";

      await db["trial-credit-requests"].create({
        pk: requestPk,
        sk: requestSk,
        workspaceId,
        userId,
        userEmail,
        reason,
        currency: workspace.currency || "usd",
        requestedAt: new Date().toISOString(),
        status: "pending",
      });

      // Update workspace to mark that credits have been requested
      await db.workspace.update({
        pk: workspaceResource,
        sk: "workspace",
        trialCreditRequested: true,
        trialCreditRequestedAt: new Date().toISOString(),
      });

      // Send Discord notification
      await sendTrialCreditRequestNotification(
        workspaceId,
        userEmail,
        reason
      );

      // Track trial credit request
      trackBusinessEvent(
        "trial_credit",
        "requested",
        {
          workspace_id: workspaceId,
        },
        req
      );

      res.status(201).json({
        success: true,
        message:
          "Trial credit request submitted successfully. You will be notified once approved.",
      });
    })
  );
};
