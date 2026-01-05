import { badRequest, forbidden, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { trackBusinessEvent } from "../../../utils/tracking";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/channels/{channelId}:
 *   delete:
 *     summary: Delete workspace channel
 *     description: Deletes a notification channel. Cannot delete if any agents are using it.
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
 *       204:
 *         description: Channel deleted successfully
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
export const registerDeleteWorkspaceChannel = (app: express.Application) => {
  app.delete(
    "/api/workspaces/:workspaceId/channels/:channelId",
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

        // Check if any agents are using this channel
        const agentsResult = await db.agent.query({
          IndexName: "byWorkspaceId",
          KeyConditionExpression: "workspaceId = :workspaceId",
          ExpressionAttributeValues: {
            ":workspaceId": workspaceId,
          },
        });

        const agentsUsingChannel = agentsResult.items.filter(
          (agent) => agent.notificationChannelId === channelId
        );

        if (agentsUsingChannel.length > 0) {
          const agentNames = agentsUsingChannel.map((a) => a.name).join(", ");
          throw badRequest(
            `Cannot delete channel: it is being used by ${agentsUsingChannel.length} agent(s): ${agentNames}. Please remove the channel from these agents first.`
          );
        }

        // Delete channel
        await db["output_channel"].delete(channelPk, "channel");

        // Track channel deletion
        trackBusinessEvent(
          "channel",
          "deleted",
          {
            workspace_id: workspaceId,
            channel_id: channelId,
            channel_type: channel.type,
          },
          req
        );

        res.status(204).send();
      } catch (error) {
        handleError(
          error,
          next,
          "DELETE /api/workspaces/:workspaceId/channels/:channelId"
        );
      }
    }
  );
};
