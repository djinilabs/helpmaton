import { WebClient } from "@slack/web-api";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";

import { database } from "../../tables";
import { handlingErrors } from "../../utils/handlingErrors";
import { adaptHttpHandler } from "../../utils/httpEventAdapter";
import { getContextFromRequestId } from "../../utils/workspaceCreditContext";
import { callAgentNonStreaming } from "../utils/agentCallNonStreaming";

import { postSlackMessage, updateSlackMessage } from "./services/slackResponse";
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
      // Extract request ID for context
      const awsRequestId = event.requestContext?.requestId;
      const context = getContextFromRequestId(awsRequestId);

      // Extract integrationId from path - format: {workspaceId}/{integrationId}
      const integrationId = event.pathParameters?.integrationId;
      if (!integrationId) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "Missing integrationId" }),
          headers: { "Content-Type": "application/json" },
        };
      }

      const db = await database();

      // Parse integrationId - format: {workspaceId}/{integrationId}
      const parts = integrationId.split("/");
      if (parts.length !== 2) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "Invalid integrationId format" }),
          headers: { "Content-Type": "application/json" },
        };
      }
      const [workspaceId, actualIntegrationId] = parts;
      const integrationPk = `bot-integrations/${workspaceId}/${actualIntegrationId}`;
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

          // Post initial "thinking" message
          const initialMessage = await postSlackMessage(
            client,
            slackEvent.channel,
            "Agent is thinking...",
            slackEvent.thread_ts
          );

          try {
            // Call agent (non-streaming, but we'll simulate streaming with throttled edits)
            const agentResultPromise = callAgentNonStreaming(
              integration.workspaceId,
              integration.agentId,
              messageText,
              {
                modelReferer: "http://localhost:3000/api/webhooks/slack",
                conversationId: slackEvent.thread_ts || slackEvent.ts,
                context,
              }
            );

            // Start a background task to update the message periodically
            // This simulates streaming by showing progressively more text
            const updateInterval = setInterval(() => {
              // Use void to explicitly ignore the promise
              void (async () => {
                try {
                  // Check if agent call is complete
                  const isComplete = await Promise.race([
                    agentResultPromise.then(() => true),
                    new Promise<boolean>((resolve) =>
                      setTimeout(() => resolve(false), 100)
                    ),
                  ]);

                  if (isComplete) {
                    clearInterval(updateInterval);
                    const agentResult = await agentResultPromise;
                    const responseText = agentResult.text;

                    // Update with complete response
                    if (slackEvent.channel) {
                      await updateSlackMessage(
                        client,
                        slackEvent.channel,
                        initialMessage.ts,
                        responseText || "No response generated."
                      );
                    }
                  } else {
                    // Still processing - update with "thinking" indicator
                    if (slackEvent.channel) {
                      // Slack timestamps are Unix timestamps (e.g., "1234567890.123456")
                      // Convert to milliseconds: parseFloat(ts) * 1000
                      const messageTimestamp =
                        parseFloat(initialMessage.ts) * 1000;
                      const elapsed = Math.floor(
                        (Date.now() - messageTimestamp) / 1000
                      );
                      await updateSlackMessage(
                        client,
                        slackEvent.channel,
                        initialMessage.ts,
                        `Agent is thinking... (${elapsed}s)`
                      );
                    }
                  }
                } catch (error) {
                  console.error(
                    "[Slack Streaming] Error in update interval:",
                    error
                  );
                }
              })();
            }, 1500); // Update every 1.5 seconds

            // Wait for agent result
            const agentResult = await agentResultPromise;
            clearInterval(updateInterval);

            // Final update with complete response
            const responseText = agentResult.text;
            await updateSlackMessage(
              client,
              slackEvent.channel,
              initialMessage.ts,
              responseText || "No response generated."
            );

            // Update lastUsedAt
            await db["bot-integration"].update({
              ...integration,
              lastUsedAt: new Date().toISOString(),
            });
          } catch (error) {
            // Update message with error
            await updateSlackMessage(
              client,
              slackEvent.channel,
              initialMessage.ts,
              `❌ Error: ${
                error instanceof Error ? error.message : "Unknown error"
              }`
            );
            throw error;
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
