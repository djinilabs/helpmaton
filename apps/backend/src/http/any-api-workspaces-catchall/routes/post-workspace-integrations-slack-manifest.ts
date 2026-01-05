import { badRequest, unauthorized } from "@hapi/boom";
import express from "express";

import { PERMISSION_LEVELS } from "../../../tables/schema";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/integrations/slack/manifest:
 *   post:
 *     summary: Generate Slack app manifest
 *     description: Generates a Slack app manifest JSON with pre-filled webhook URL
 *     tags:
 *       - Integrations
 *     security:
 *       - bearerAuth: []
 */
export const registerPostWorkspaceIntegrationsSlackManifest = (app: express.Application) => {
  app.post(
    "/api/workspaces/:workspaceId/integrations/slack/manifest",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const { workspaceId } = req.params;
        const { agentId, agentName } = req.body;

        if (!agentId || typeof agentId !== "string") {
          throw badRequest("agentId is required and must be a string");
        }

        const currentUserRef = req.userRef;
        if (!currentUserRef) {
          throw unauthorized();
        }

        // Generate a placeholder integration ID for the webhook URL
        // The actual integration will be created after the user sets up the Slack app
        const placeholderIntegrationId = "PLACEHOLDER_INTEGRATION_ID";

        // Construct webhook URL
        const baseUrl = process.env.ARC_ENV === "production"
          ? "https://api.helpmaton.com"
          : process.env.ARC_ENV === "staging"
          ? "https://staging-api.helpmaton.com"
          : "http://localhost:3333";
        const webhookUrl = `${baseUrl}/api/webhooks/slack/${workspaceId}/${placeholderIntegrationId}`;

        // Generate Slack app manifest
        const manifest = {
          display_information: {
            name: agentName || "Helpmaton Agent",
            description: "AI agent powered by Helpmaton",
            background_color: "#2c2d30",
          },
          features: {
            bot_user: {
              display_name: agentName || "Helpmaton Agent",
              always_online: true,
            },
          },
          oauth_config: {
            scopes: {
              bot: [
                "app_mentions:read",
                "chat:write",
                "channels:history",
                "groups:history",
                "im:history",
                "mpim:history",
              ],
            },
          },
          event_subscriptions: {
            request_url: webhookUrl,
            bot_events: ["app_mentions", "message.channels", "message.groups", "message.im", "message.mpim"],
          },
          settings: {
            event_subscriptions: {
              request_url: webhookUrl,
            },
            interactivity: {
              request_url: webhookUrl,
            },
          },
        };

        res.json({
          manifest,
          webhookUrl,
          instructions: [
            "1. Copy the manifest JSON above",
            "2. Go to https://api.slack.com/apps",
            "3. Click 'Create New App' → 'From Manifest'",
            "4. Paste the manifest JSON",
            "5. After creating the app, copy the Bot User OAuth Token and Signing Secret",
            "6. Return to this page and create the integration with those credentials",
          ],
        });
      } catch (error) {
        handleError(error, next, "POST /api/workspaces/:workspaceId/integrations/slack/manifest");
      }
    }
  );
};

