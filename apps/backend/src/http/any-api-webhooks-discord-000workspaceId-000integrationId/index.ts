import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";

import { database } from "../../tables";
import { enqueueBotWebhookTask } from "../../utils/botWebhookQueue";
import { handlingErrors } from "../../utils/handlingErrors";
import { adaptHttpHandler } from "../../utils/httpEventAdapter";
import {
  createDiscordDeferredResponse,
  createDiscordInteractionResponse,
} from "../any-api-webhooks-000type-000workspaceId-000integrationId/services/discordResponse";
import { verifyDiscordSignature } from "../any-api-webhooks-000type-000workspaceId-000integrationId/services/discordVerification";

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
      // Extract workspaceId and integrationId from path parameters
      const workspaceId = event.pathParameters?.workspaceId;
      const integrationId = event.pathParameters?.integrationId;

      if (!workspaceId || !integrationId) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: "Missing workspaceId or integrationId",
          }),
          headers: { "Content-Type": "application/json" },
        };
      }

      const db = await database();
      const integrationPk = `bot-integrations/${workspaceId}/${integrationId}`;
      const integration = await db["bot-integration"].get(
        integrationPk,
        "integration"
      );

      if (!integration || integration.platform !== "discord") {
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
        publicKey: string;
        applicationId?: string;
      };

      // Parse request body first to check if it's a PING
      let body: DiscordInteraction;
      try {
        body = JSON.parse(event.body || "{}");
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
  )
);
