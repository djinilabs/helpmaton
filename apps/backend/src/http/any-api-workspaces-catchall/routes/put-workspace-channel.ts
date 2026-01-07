import { badRequest, forbidden, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { trackBusinessEvent } from "../../../utils/tracking";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/channels/{channelId}:
 *   put:
 *     summary: Update workspace channel
 *     description: Updates channel name or configuration
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
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: Channel name
 *               config:
 *                 type: object
 *                 description: Channel configuration (merged with existing config)
 *     responses:
 *       200:
 *         description: Channel updated successfully
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
 *                 updatedAt:
 *                   type: string
 *                   format: date-time
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
export const registerPutWorkspaceChannel = (app: express.Application) => {
  app.put(
    "/api/workspaces/:workspaceId/channels/:channelId",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const { name, config } = req.body;
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

        // Validate config if provided
        if (config !== undefined) {
          if (typeof config !== "object") {
            throw badRequest("config must be an object");
          }
          if (channel.type === "discord") {
            if (
              config.botToken !== undefined &&
              typeof config.botToken !== "string"
            ) {
              throw badRequest("config.botToken must be a string");
            }
            if (
              config.discordChannelId !== undefined &&
              typeof config.discordChannelId !== "string"
            ) {
              throw badRequest("config.discordChannelId must be a string");
            }
            // Validate bot token format if provided (Discord tokens contain dots and are typically 59+ characters)
            if (
              config.botToken &&
              !/^[A-Za-z0-9._-]{59,}$/.test(config.botToken)
            ) {
              throw badRequest("Invalid Discord bot token format");
            }
          }
        }

        // Merge config if provided
        const updatedConfig =
          config !== undefined
            ? { ...channel.config, ...config }
            : channel.config;

        // Update channel
        const updated = await db["output_channel"].update({
          pk: channelPk,
          sk: "channel",
          workspaceId,
          channelId,
          type: channel.type,
          name: name !== undefined ? name : channel.name,
          config: updatedConfig,
          updatedBy: req.userRef || "",
          updatedAt: new Date().toISOString(),
        });

        // Track channel update
        trackBusinessEvent(
          "channel",
          "updated",
          {
            workspace_id: workspaceId,
            channel_id: channelId,
            channel_type: channel.type,
          },
          req
        );

        res.json({
          id: updated.channelId,
          name: updated.name,
          type: updated.type,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        });
      } catch (error) {
        handleError(
          error,
          next,
          "PUT /api/workspaces/:workspaceId/channels/:channelId"
        );
      }
    }
  );
};
