import { badRequest, methodNotAllowed } from "@hapi/boom";
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

import { handlingErrors } from "../../utils/handlingErrors";
import { adaptHttpHandler } from "../../utils/httpEventAdapter";

import { handleDiscordCommand } from "./services/commandHandler";
import { discordResponse } from "./services/discordResponse";
import {
  verifyDiscordSignature,
  verifyDiscordUser,
} from "./services/discordService";

export const handler = adaptHttpHandler(
  handlingErrors(
  async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    // Handle GET requests (Discord sends GET for endpoint verification)
    if (event.requestContext.http.method === "GET") {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: "Discord endpoint is active" }),
        headers: {
          "Content-Type": "application/json",
        },
      };
    }

    // Only handle POST requests for interactions
    if (event.requestContext.http.method !== "POST") {
      throw methodNotAllowed("Method not allowed");
    }

    // Verify Discord webhook signature
    if (!verifyDiscordSignature(event)) {
      console.warn("Discord signature verification failed");
      return discordResponse(
        "❌ **Error:** Invalid Discord signature. Request could not be verified."
      );
    }

    // Parse Discord webhook payload
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      throw badRequest("Invalid JSON payload. Request could not be parsed.");
    }

    // Handle Discord interaction
    if (body.type === 1) {
      // PING - Discord verification - must return PONG (type: 1)
      return {
        statusCode: 200,
        body: JSON.stringify({ type: 1 }),
        headers: {
          "Content-Type": "application/json",
        },
      };
    }

    if (body.type === 2) {
      // APPLICATION_COMMAND - Handle slash command
      // Verify Discord user is authorized for customer service commands
      // In guild interactions, body.member is present; in DM interactions, body.user is present
      const authorization = body.member || (body.user ? { user: body.user } : {});
      if (!verifyDiscordUser(authorization)) {
        return discordResponse(
          "❌ You are not authorized to use customer service commands."
        );
      }

      return await handleDiscordCommand(body);
    }

    // Unknown interaction type
    return discordResponse("❌ **Error:** Unknown interaction type.", 200);
  })
);

