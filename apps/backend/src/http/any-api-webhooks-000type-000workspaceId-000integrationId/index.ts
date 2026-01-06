import { WebClient } from "@slack/web-api";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";

import { database } from "../../tables";
import type { BotIntegrationRecord } from "../../tables/schema";
import { enqueueBotWebhookTask } from "../../utils/botWebhookQueue";
import { handlingErrors } from "../../utils/handlingErrors";
import { adaptHttpHandler } from "../../utils/httpEventAdapter";

import {
  createDiscordDeferredResponse,
  createDiscordInteractionResponse,
} from "./services/discordResponse";
import { verifyDiscordSignature } from "./services/discordVerification";
import { postSlackMessage } from "./services/slackResponse";
import { verifySlackSignature } from "./services/slackVerification";

/**
 * Decodes the request body if it's base64 encoded by API Gateway
 * Returns the decoded body as a string, ready for JSON parsing or signature verification
 */
function decodeRequestBody(event: APIGatewayProxyEventV2): string {
  let body = event.body || "";
  if (event.isBase64Encoded && body) {
    try {
      body = Buffer.from(body, "base64").toString("utf8");
    } catch (error) {
      console.error("Failed to decode base64 body:", error);
      return "";
    }
  }
  return body;
}

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

interface DiscordInteraction {
  type: number;
  data?: {
    name?: string;
    options?: Array<{
      name: string;
      value: string;
    }>;
  };
  token?: string;
  member?: {
    user?: {
      id: string;
      username: string;
    };
  };
  user?: {
    id: string;
    username: string;
  };
  channel_id?: string;
  guild_id?: string;
}

export const handler = adaptHttpHandler(
  handlingErrors(
    async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
      // Extract type, workspaceId and integrationId from path parameters
      const type = event.pathParameters?.type;
      const workspaceId = event.pathParameters?.workspaceId;
      const integrationId = event.pathParameters?.integrationId;

      if (!type || !workspaceId || !integrationId) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: "Missing type, workspaceId or integrationId",
          }),
          headers: { "Content-Type": "application/json" },
        };
      }

      // Validate type parameter
      if (type !== "slack" && type !== "discord") {
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: "Invalid type. Must be 'slack' or 'discord'",
          }),
          headers: { "Content-Type": "application/json" },
        };
      }

      // For Discord, handle PING (type 1) requests early for endpoint verification
      // Discord sends PING requests during endpoint verification, and these must be handled
      // even if the integration doesn't exist yet or isn't active
      if (type === "discord") {
        const bodyText = decodeRequestBody(event);
        let body: DiscordInteraction | undefined;
        try {
          body = JSON.parse(bodyText);
        } catch {
          // If we can't parse the body, continue to normal flow which will return an error
          body = undefined;
        }

        // If it's a PING request, handle it immediately
        if (body && body.type === 1) {
          const db = await database();
          const integrationPk = `bot-integrations/${workspaceId}/${integrationId}`;
          const integration = await db["bot-integration"].get(
            integrationPk,
            "integration"
          );

          // If integration exists, verify platform matches and signature
          if (integration) {
            if (integration.platform !== "discord") {
              // Integration exists but platform doesn't match - return 404
              return {
                statusCode: 404,
                body: JSON.stringify({ error: "Integration not found" }),
                headers: { "Content-Type": "application/json" },
              };
            }

            // Integration exists and platform matches - verify signature is required
            const config = integration.config as {
              botToken?: string;
              publicKey?: string;
              applicationId?: string;
            };
            if (config.publicKey) {
              const signatureValid = verifyDiscordSignature(
                event,
                config.publicKey
              );
              if (!signatureValid) {
                // Discord requires signature verification to pass for endpoint verification
                console.warn(
                  "Discord PING received but signature verification failed"
                );
                return {
                  statusCode: 401,
                  body: JSON.stringify({ error: "Invalid signature" }),
                  headers: { "Content-Type": "application/json" },
                };
              }
            } else {
              // Integration exists but no public key - this shouldn't happen
              console.error(
                "Discord PING received but integration missing public key"
              );
              return {
                statusCode: 500,
                body: JSON.stringify({
                  error: "Integration configuration error",
                }),
                headers: { "Content-Type": "application/json" },
              };
            }
          } else {
            // Integration doesn't exist - Discord requires signature verification
            // We can't verify without the public key, so return 404
            // The integration must exist before Discord can verify the endpoint
            console.warn(
              "Discord PING received but integration not found - integration must exist for verification"
            );
            return {
              statusCode: 404,
              body: JSON.stringify({ error: "Integration not found" }),
              headers: { "Content-Type": "application/json" },
            };
          }

          // Return PONG for PING requests with valid signature
          return {
            statusCode: 200,
            body: JSON.stringify({ type: 1 }),
            headers: { "Content-Type": "application/json" },
          };
        }
      }

      const db = await database();

      const integrationPk = `bot-integrations/${workspaceId}/${integrationId}`;
      const integration = await db["bot-integration"].get(
        integrationPk,
        "integration"
      );

      if (!integration || integration.platform !== type) {
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

      // Route to platform-specific handlers
      if (type === "slack") {
        return handleSlackWebhook(event, integration, integrationId);
      } else {
        return handleDiscordWebhook(event, integration, integrationId);
      }
    }
  )
);

/**
 * Handle Slack webhook events
 */
async function handleSlackWebhook(
  event: APIGatewayProxyEventV2,
  integration: BotIntegrationRecord,
  integrationId: string
): Promise<APIGatewayProxyResultV2> {
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
  const bodyText = decodeRequestBody(event);
  let body: SlackEvent;
  try {
    body = JSON.parse(bodyText);
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
      (slackEvent.type === "app_mention" || slackEvent.type === "message") &&
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
        console.error("[Slack Webhook] Error posting initial message:", error);
        // If we can't post the initial message, we can't proceed
        // Return error response
        return {
          statusCode: 500,
          body: JSON.stringify({
            ok: false,
            error:
              error instanceof Error ? error.message : "Failed to post message",
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

/**
 * Handle Discord webhook interactions
 */
async function handleDiscordWebhook(
  event: APIGatewayProxyEventV2,
  integration: BotIntegrationRecord,
  integrationId: string
): Promise<APIGatewayProxyResultV2> {
  // Extract config
  const config = integration.config as {
    botToken: string;
    publicKey: string;
    applicationId?: string;
  };

  // Parse request body first to check if it's a PING
  const bodyText = decodeRequestBody(event);
  let body: DiscordInteraction;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid JSON" }),
      headers: { "Content-Type": "application/json" },
    };
  }

  // Handle PING (type 1) - Discord verification (before signature check)
  // Discord sends PING requests during endpoint verification, and these must be handled
  // even if signature verification fails (which can happen during initial setup)
  if (body.type === 1) {
    // Still verify signature if possible, but don't fail on PING
    const signatureValid = verifyDiscordSignature(event, config.publicKey);
    if (!signatureValid) {
      console.warn(
        "Discord PING received but signature verification failed - allowing for endpoint verification"
      );
    }
    return {
      statusCode: 200,
      body: JSON.stringify({ type: 1 }),
      headers: { "Content-Type": "application/json" },
    };
  }

  // For all other interaction types, verify signature
  if (!verifyDiscordSignature(event, config.publicKey)) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: "Invalid signature" }),
      headers: { "Content-Type": "application/json" },
    };
  }

  // Handle APPLICATION_COMMAND (type 2) - Slash commands
  if (body.type === 2 && body.data) {
    const commandName = body.data.name || "";
    const options = body.data.options || [];

    // Extract message from command options
    let messageText = "";
    if (commandName === "ask" || commandName === "chat") {
      const messageOption = options.find((opt) => opt.name === "message");
      if (messageOption && typeof messageOption.value === "string") {
        messageText = messageOption.value;
      }
    } else if (commandName) {
      // For other commands, use command name as message
      messageText = commandName;
    }

    if (!messageText) {
      return {
        statusCode: 200,
        body: JSON.stringify(
          createDiscordInteractionResponse(
            "Please provide a message to send to the agent.",
            true
          )
        ),
        headers: { "Content-Type": "application/json" },
      };
    }

    // Validate required fields before proceeding
    if (!body.token) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing interaction token" }),
        headers: { "Content-Type": "application/json" },
      };
    }

    if (!config.applicationId) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Integration missing applicationId",
        }),
        headers: { "Content-Type": "application/json" },
      };
    }

    // Return deferred response immediately (Discord requires response within 3 seconds)
    // This acknowledges the interaction and allows up to 15 minutes for follow-up
    const deferredResponse = createDiscordDeferredResponse();

    // Enqueue task for async processing
    try {
      await enqueueBotWebhookTask(
        "discord",
        integrationId,
        integration.workspaceId,
        integration.agentId,
        messageText,
        {
          interactionToken: body.token,
          applicationId: config.applicationId,
          channelId: body.channel_id,
          botToken: config.botToken,
        },
        body.channel_id
      );
    } catch (error) {
      console.error("[Discord Webhook] Error enqueueing task:", error);
      // Still return deferred response - queue handler will handle errors
    }

    // Return deferred response immediately (within 3 seconds)
    return {
      statusCode: 200,
      body: JSON.stringify(deferredResponse),
      headers: { "Content-Type": "application/json" },
    };
  }

  // Unknown interaction type
  return {
    statusCode: 200,
    body: JSON.stringify(
      createDiscordInteractionResponse("Unknown interaction type.", true)
    ),
    headers: { "Content-Type": "application/json" },
  };
}
