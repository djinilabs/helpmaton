import { badRequest, forbidden, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { sendNotification } from "../../../utils/notifications";
import { trackBusinessEvent } from "../../../utils/tracking";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/channels/{channelId}/test:
 *   post:
 *     summary: Test workspace channel
 *     description: Sends a test notification through the channel to verify configuration
 *     tags:
 *       - Channels
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: workspaceId
 *         in: path
 *         required: true
 *         description: Workspace ID
 *         schema:
 *           type: string
 *       - name: channelId
 *         in: path
 *         required: true
 *         description: Channel ID
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Test message sent successfully
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
 *         description: Channel not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPostTestChannel = (app: express.Application) => {
  app.post(
    "/api/workspaces/:workspaceId/channels/:channelId/test",
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
        const channelId = req.params.channelId;
        const channelPk = `output-channels/${workspaceId}/${channelId}`;

        const channel = await db["output_channel"].get(channelPk, "channel");
        if (!channel) {
          throw resourceGone("Channel not found");
        }

        if (channel.workspaceId !== workspaceId) {
          throw forbidden("Channel does not belong to this workspace");
        }

        // Send test message
        const testMessage = `✅ Test notification from Helpmaton\n\nThis is a test message to verify that your ${channel.name} channel is configured correctly. If you received this message, your channel setup is working!`;

        try {
          await sendNotification(channel, testMessage);

          // Track channel test
          trackBusinessEvent(
            "channel",
            "tested",
            {
              workspace_id: workspaceId,
              channel_id: channelId,
              channel_type: channel.type,
            },
            req
          );

          res.json({
            success: true,
            message: "Test message sent successfully",
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          throw badRequest(`Failed to send test message: ${errorMessage}`);
        }
      } catch (error) {
        handleError(
          error,
          next,
          "POST /api/workspaces/:workspaceId/channels/:channelId/test"
        );
      }
    }
  );
};
