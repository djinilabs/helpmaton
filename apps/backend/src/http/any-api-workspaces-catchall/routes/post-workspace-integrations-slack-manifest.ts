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
export const registerPostWorkspaceIntegrationsSlackManifest = (
  app: express.Application
) => {
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
        const webhookBaseFromEnv = process.env.WEBHOOK_BASE_URL?.trim();
        const baseUrlFromEnv = process.env.BASE_URL?.trim();
        let baseUrl: string;

        if (webhookBaseFromEnv && webhookBaseFromEnv.length > 0) {
          baseUrl = webhookBaseFromEnv.replace(/\/+$/, "");
        } else if (baseUrlFromEnv && baseUrlFromEnv.length > 0) {
          baseUrl = baseUrlFromEnv.replace(/\/+$/, "");
        } else if (process.env.ARC_ENV === "production") {
          baseUrl = "https://api.helpmaton.com";
        } else if (process.env.ARC_ENV === "staging") {
          baseUrl = "https://staging-api.helpmaton.com";
        } else {
          throw new Error(
            "WEBHOOK_BASE_URL or BASE_URL environment variable must be set for non-production/non-staging environments"
          );
        }
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
          settings: {
            event_subscriptions: {
              request_url: webhookUrl,
              bot_events: [
                "app_mention",
                "message.channels",
                "message.groups",
                "message.im",
                "message.mpim",
              ],
            },
            interactivity: {
              is_enabled: true,
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
            "4. Paste the manifest JSON and click 'Create'",
            "5. Install the app to your workspace (in 'Install App' → 'Install to Workspace')",
            "6. After installing, copy the Bot User OAuth Token (from 'OAuth & Permissions') and Signing Secret (from 'Basic Information' → 'App Credentials')",
            "7. Return here and click 'Continue to Credentials' to create the integration",
            "8. ⚠️ IMPORTANT: After creating the integration, you'll see the real webhook URL. You MUST update the webhook URL in your Slack app's 'Event Subscriptions' settings with the real URL (it will replace the placeholder URL from the manifest)",
          ],
        });
      } catch (error) {
        handleError(
          error,
          next,
          "POST /api/workspaces/:workspaceId/integrations/slack/manifest"
        );
      }
    }
  );
};
