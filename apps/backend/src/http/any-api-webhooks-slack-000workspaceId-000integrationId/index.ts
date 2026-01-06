import { WebClient } from "@slack/web-api";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";

import { database } from "../../tables";
import { enqueueBotWebhookTask } from "../../utils/botWebhookQueue";
import { handlingErrors } from "../../utils/handlingErrors";
import { adaptHttpHandler } from "../../utils/httpEventAdapter";

import { postSlackMessage } from "./services/slackResponse";
import { verifySlackSignature } from "./services/slackVerification";

interface SlackEvent {
  type: string;
  event?: {
    type: string;
    text?: string;
    channel?: string;
    user?: string;
    ts?: string;
    thread_ts?: string;
  };
  challenge?: string;
}

export const handler = adaptHttpHandler(
  handlingErrors(
    async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
      // Extract workspaceId and integrationId from path parameters
      const workspaceId = event.pathParameters?.workspaceId;
      const integrationId = event.pathParameters?.integrationId;
      
      if (!workspaceId || !integrationId) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "Missing workspaceId or integrationId" }),
          headers: { "Content-Type": "application/json" },
        };
      }

      const db = await database();

      const integrationPk = `bot-integrations/${workspaceId}/${integrationId}`;
      const integration = await db["bot-integration"].get(
        integrationPk,
        "integration"
      );

      if (!integration || integration.platform !== "slack") {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: "Integration not found" }),
          headers: { "Content-Type": "application/json" },
        };
      }

      if (integration.status !== "active") {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "Integration is not active" }),
          headers: { "Content-Type": "application/json" },
        };
      }

      // Extract config
      const config = integration.config as {
        botToken: string;
        signingSecret: string;
        teamId?: string;
        teamName?: string;
      };

      // Verify signature
      if (!verifySlackSignature(event, config.signingSecret)) {
        return {
          statusCode: 401,
          body: JSON.stringify({ error: "Invalid signature" }),
          headers: { "Content-Type": "application/json" },
        };
      }

      // Parse request body
      let body: SlackEvent;
      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "Invalid JSON" }),
          headers: { "Content-Type": "application/json" },
        };
      }

      // Handle URL verification challenge
      if (body.type === "url_verification" && body.challenge) {
        return {
          statusCode: 200,
          body: JSON.stringify({ challenge: body.challenge }),
          headers: { "Content-Type": "application/json" },
        };
      }

      // Handle event callback
      if (body.type === "event_callback" && body.event) {
        const slackEvent = body.event;

        // Handle app_mention and message events
        if (
          (slackEvent.type === "app_mention" ||
            slackEvent.type === "message") &&
          slackEvent.text &&
          slackEvent.channel &&
          slackEvent.user
        ) {
          // Extract message text (remove bot mention if present)
          let messageText = slackEvent.text.trim();
          // Remove <@BOT_ID> mentions
          messageText = messageText.replace(/<@[A-Z0-9]+>/g, "").trim();

          if (!messageText) {
            return {
              statusCode: 200,
              body: JSON.stringify({ ok: true }),
              headers: { "Content-Type": "application/json" },
            };
          }

          // Initialize Slack client
          const client = new WebClient(config.botToken);

          // Post initial "thinking" message (for immediate feedback)
          let initialMessage: { ts: string; channel: string };
          try {
            initialMessage = await postSlackMessage(
              client,
              slackEvent.channel,
              "Agent is thinking...",
              slackEvent.thread_ts
            );
          } catch (error) {
            console.error(
              "[Slack Webhook] Error posting initial message:",
              error
            );
            // If we can't post the initial message, we can't proceed
            // Return error response
            return {
              statusCode: 500,
              body: JSON.stringify({
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "Failed to post message",
              }),
              headers: { "Content-Type": "application/json" },
            };
          }

          // Enqueue task for async processing
          try {
            await enqueueBotWebhookTask(
              "slack",
              integrationId,
              integration.workspaceId,
              integration.agentId,
              messageText,
              {
                botToken: config.botToken,
                channel: slackEvent.channel,
                messageTs: initialMessage.ts,
                threadTs: slackEvent.thread_ts,
              },
              slackEvent.thread_ts || slackEvent.ts
            );
          } catch (error) {
            console.error("[Slack Webhook] Error enqueueing task:", error);
            // Update message with error
            try {
              await postSlackMessage(
                client,
                slackEvent.channel,
                `❌ Error: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
                slackEvent.thread_ts
              );
            } catch (updateError) {
              console.error(
                "[Slack Webhook] Error posting error message:",
                updateError
              );
            }
            // Don't throw - we've already returned ok response
          }
        }
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true }),
        headers: { "Content-Type": "application/json" },
      };
    }
  )
);
