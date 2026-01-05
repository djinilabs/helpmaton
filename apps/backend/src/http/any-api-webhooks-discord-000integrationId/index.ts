import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

import { database } from "../../tables";
import { handlingErrors } from "../../utils/handlingErrors";
import { adaptHttpHandler } from "../../utils/httpEventAdapter";
import { getContextFromRequestId } from "../../utils/workspaceCreditContext";
import { callAgentNonStreaming } from "../utils/agentCallNonStreaming";

import { createDiscordInteractionResponse , updateDiscordMessage } from "./services/discordResponse";
import { verifyDiscordSignature } from "./services/discordVerification";

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
      const integration = await db["bot-integration"].get(integrationPk, "integration");

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

      // Verify signature
      if (!verifyDiscordSignature(event, config.publicKey)) {
        return {
          statusCode: 401,
          body: JSON.stringify({ error: "Invalid signature" }),
          headers: { "Content-Type": "application/json" },
        };
      }

      // Parse request body
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

      // Handle PING (type 1) - Discord verification
      if (body.type === 1) {
        return {
          statusCode: 200,
          body: JSON.stringify({ type: 1 }),
          headers: { "Content-Type": "application/json" },
        };
      }

      // Handle APPLICATION_COMMAND (type 2) - Slash commands
      if (body.type === 2 && body.data && body.token) {
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

        // Post initial "thinking" response
        const initialResponse = createDiscordInteractionResponse(
          "Agent is thinking...",
          false
        );

        // Start background task to update message periodically
        const updateInterval = setInterval(() => {
          // Use void to explicitly ignore the promise
          void (async () => {
            try {
              if (body.token && config.applicationId) {
                const elapsed = Math.floor((Date.now() - Date.now()) / 1000);
                await updateDiscordMessage(
                  config.botToken,
                  config.applicationId,
                  body.token,
                  `Agent is thinking... (${elapsed}s)`
                );
              }
            } catch (error) {
              console.error("[Discord Streaming] Error in update interval:", error);
            }
          })();
        }, 1500);

        try {
          // Call agent
          const agentResult = await callAgentNonStreaming(
            integration.workspaceId,
            integration.agentId,
            messageText,
            {
              modelReferer: "http://localhost:3000/api/webhooks/discord",
              conversationId: body.channel_id,
              context,
            }
          );

          clearInterval(updateInterval);

          // Update with complete response
          if (body.token && config.applicationId) {
            await updateDiscordMessage(
              config.botToken,
              config.applicationId,
              body.token,
              agentResult.text || "No response generated."
            );
          }

          // Update lastUsedAt
          await db["bot-integration"].update({
            ...integration,
            lastUsedAt: new Date().toISOString(),
          });
        } catch (error) {
          clearInterval(updateInterval);
          // Update with error
          if (body.token && config.applicationId) {
            await updateDiscordMessage(
              config.botToken,
              config.applicationId,
              body.token,
              `❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`
            );
          }
          throw error;
        }

        // Return initial response (Discord requires immediate response)
        return {
          statusCode: 200,
          body: JSON.stringify(initialResponse),
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

