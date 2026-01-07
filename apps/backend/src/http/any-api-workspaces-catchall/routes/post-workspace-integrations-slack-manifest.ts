import { badRequest, unauthorized } from "@hapi/boom";
import express from "express";

import { PERMISSION_LEVELS } from "../../../tables/schema";
import { trackBusinessEvent } from "../../../utils/tracking";
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
            app_home: {
              messages_tab_enabled: true,
              messages_tab_read_only_enabled: false,
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
                "im:read",
                "im:write",
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

        // Track Slack manifest generation
        trackBusinessEvent(
          "slack_manifest",
          "generated",
          {
            workspace_id: workspaceId,
            agent_id: agentId,
            agent_name: agentName,
          },
          req
        );

        res.json({
          manifest,
          webhookUrl,
          instructions: [
            "1. Copy the manifest JSON above",
            "2. Go to https://api.slack.com/apps",
            "3. Click 'Create New App' → 'From Manifest'",
            "4. Paste the manifest JSON and click 'Create'",
            "5. ⚠️ NOTE: Slack will show an error for the webhook URL - this is EXPECTED. The URL contains a placeholder that will be replaced after you create the integration.",
            "6. Install the app to your workspace (in 'Install App' → 'Install to Workspace')",
            "7. After installing, copy the Bot User OAuth Token (from 'OAuth & Permissions') and Signing Secret (from 'Basic Information' → 'App Credentials')",
            "8. Return here and click 'Continue to Credentials' to create the integration",
            "9. ⚠️ CRITICAL: After creating the integration, you'll see the REAL webhook URL. You MUST:",
            "   a) Go to your Slack app → 'Event Subscriptions'",
            "   b) Replace the webhook URL in the 'Request URL' field with the real URL shown after integration creation",
            "   c) Click 'Save Changes'",
            "   d) Wait for Slack to verify the URL (you should see a green checkmark ✅)",
            "10. Only after the URL is verified will the bot respond to messages",
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
