import { randomUUID } from "crypto";

import type { HttpAsyncHandler } from "@architect/functions";
import { badRequest, unauthorized } from "@hapi/boom";

import { database } from "../../tables";
import { handlingHttpAsyncErrors } from "../../utils/handlingErrors";

/**
 * Dummy validation function for webhook key
 * TODO: Implement actual validation logic
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function validateWebhookKey(_userId: string, _key: string): boolean {
  // Dummy validation - always returns true for now
  return true;
}

export const handler: HttpAsyncHandler = handlingHttpAsyncErrors(
  async (req) => {
    // Extract userId and key from URL path parameters
    const userId = req.pathParameters?.userId;
    const key = req.pathParameters?.key;

    if (!userId || !key) {
      throw badRequest("userId and key are required in the URL path");
    }

    // Read request body as free text
    // Handle body as string, buffer, or object
    let bodyText = "";
    if (req.body) {
      if (typeof req.body === "string") {
        bodyText = req.body;
      } else if (Buffer.isBuffer(req.body)) {
        bodyText = req.body.toString("utf-8");
      } else {
        bodyText = JSON.stringify(req.body);
      }
    }

    // Validate the webhook key
    if (!validateWebhookKey(userId, key)) {
      throw unauthorized("Invalid webhook key");
    }

    // Get database instance
    const db = await database();

    // Generate unique request ID for the webhook log
    const requestId = randomUUID();

    // Calculate TTL (30 days from now in seconds)
    const expires = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

    // Create webhook log entry
    await db["webhook-logs"].create({
      pk: requestId,
      userId,
      key,
      body: bodyText,
      expires,
    });

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: "Webhook received and logged successfully",
        requestId,
      }),
    };
  }
);
