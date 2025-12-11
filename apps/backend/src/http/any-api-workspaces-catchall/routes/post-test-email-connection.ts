import { badRequest, forbidden, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/email-connection/test:
 *   post:
 *     summary: Test workspace email connection
 *     description: Sends a test email through the connection to verify configuration
 *     tags:
 *       - Email
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
 *         description: Test email sent successfully
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
 *         description: Email connection not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPostTestEmailConnection = (app: express.Application) => {
  app.post(
    "/api/workspaces/:workspaceId/email-connection/test",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const db = await database();
        const workspaceResource = req.workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const workspaceId = req.params.workspaceId;
        const pk = `email-connections/${workspaceId}`;

        const connection = await db["email-connection"].get(pk, "connection");
        if (!connection) {
          throw resourceGone("Email connection not found");
        }

        if (connection.workspaceId !== workspaceId) {
          throw forbidden("Email connection does not belong to this workspace");
        }

        // Import email sending utility
        const { sendEmailViaConnection } = await import("../../../utils/email");

        // Get user email from session for test email
        const userEmail = req.session?.user?.email;
        if (!userEmail) {
          throw badRequest("User email not found in session");
        }

        // Send test email
        const testSubject = "Test Email from Helpmaton";
        const testText = `✅ Test email from Helpmaton\n\nThis is a test email to verify that your ${connection.name} email connection is configured correctly. If you received this email, your email setup is working!`;

        try {
          await sendEmailViaConnection(workspaceId, {
            to: userEmail,
            subject: testSubject,
            text: testText,
          });
          res.json({
            success: true,
            message: "Test email sent successfully",
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          throw badRequest(`Failed to send test email: ${errorMessage}`);
        }
      } catch (error) {
        handleError(
          error,
          next,
          "POST /api/workspaces/:workspaceId/email-connection/test"
        );
      }
    }
  );
};
