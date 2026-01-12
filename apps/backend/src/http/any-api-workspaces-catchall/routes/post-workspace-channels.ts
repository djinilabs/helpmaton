import { randomUUID } from "crypto";

import { badRequest, unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import {
  checkSubscriptionLimits,
  ensureWorkspaceSubscription,
} from "../../../utils/subscriptionUtils";
import { trackBusinessEvent } from "../../../utils/tracking";
import { validateBody } from "../../utils/bodyValidation";
import { createChannelSchema } from "../../utils/schemas/workspaceSchemas";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/channels:
 *   post:
 *     summary: Create workspace channel
 *     description: Creates a new notification channel for a workspace
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - name
 *               - config
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [discord, slack]
 *                 description: Channel type
 *               name:
 *                 type: string
 *                 description: Channel name
 *               config:
 *                 type: object
 *                 description: Channel-specific configuration
 *                 properties:
 *                   botToken:
 *                     type: string
 *                     description: Discord bot token (required for discord type)
 *                   discordChannelId:
 *                     type: string
 *                     description: Discord channel ID (required for discord type)
 *                   webhookUrl:
 *                     type: string
 *                     description: Slack webhook URL (required for slack type)
 *     responses:
 *       201:
 *         description: Channel created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 name:
 *                   type: string
 *                 type:
 *                   type: string
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPostWorkspaceChannels = (app: express.Application) => {
  app.post(
    "/api/workspaces/:workspaceId/channels",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const body = validateBody(req.body, createChannelSchema);
        const { type, name, config } = body;

        // Validate type-specific config
        if (type === "discord") {
          if (!config.botToken || typeof config.botToken !== "string") {
            throw badRequest(
              "config.botToken is required for Discord channels"
            );
          }
          if (
            !config.discordChannelId ||
            typeof config.discordChannelId !== "string"
          ) {
            throw badRequest(
              "config.discordChannelId is required for Discord channels"
            );
          }
          // Validate bot token format (Discord tokens contain dots and are typically 59+ characters)
          // Format: [base64].[timestamp].[hmac] - typically 59-70 characters
          if (!/^[A-Za-z0-9._-]{59,}$/.test(config.botToken)) {
            throw badRequest("Invalid Discord bot token format");
          }
        } else if (type === "slack") {
          if (!config.webhookUrl || typeof config.webhookUrl !== "string") {
            throw badRequest(
              "config.webhookUrl is required for Slack channels"
            );
          }
          // Validate webhook URL format (must be from hooks.slack.com)
          if (!config.webhookUrl.startsWith("https://hooks.slack.com/services/")) {
            throw badRequest("Invalid Slack webhook URL format. Must start with https://hooks.slack.com/services/");
          }
        } else {
          throw badRequest(`Unsupported channel type: ${type}`);
        }

        const db = await database();
        const workspaceResource = req.workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const currentUserRef = req.userRef;
        if (!currentUserRef) {
          throw unauthorized();
        }
        const workspaceId = req.params.workspaceId;

        // Ensure workspace has a subscription and check channel limit
        const userId = currentUserRef.replace("users/", "");
        const subscriptionId = await ensureWorkspaceSubscription(
          workspaceId,
          userId
        );
        await checkSubscriptionLimits(subscriptionId, "channel", 1);

        const channelId = randomUUID();
        const channelPk = `output-channels/${workspaceId}/${channelId}`;
        const channelSk = "channel";

        // Create channel entity
        const channel = await db["output_channel"].create({
          pk: channelPk,
          sk: channelSk,
          workspaceId,
          channelId,
          type,
          name,
          config,
          createdBy: currentUserRef,
        });

        // Track channel creation
        trackBusinessEvent(
          "channel",
          "created",
          {
            workspace_id: workspaceId,
            channel_id: channel.channelId,
            channel_type: type,
          },
          req
        );

        res.status(201).json({
          id: channel.channelId,
          name: channel.name,
          type: channel.type,
          createdAt: channel.createdAt,
        });
      } catch (error) {
        handleError(error, next, "POST /api/workspaces/:workspaceId/channels");
      }
    }
  );
};
