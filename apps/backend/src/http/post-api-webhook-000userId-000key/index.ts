import type { HttpAsyncHandler } from "@architect/functions";
import { badRequest, unauthorized } from "@hapi/boom";

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

    // Validate the webhook key
    if (!validateWebhookKey(userId, key)) {
      throw unauthorized("Invalid webhook key");
    }

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: "Webhook received successfully",
      }),
    };
  }
);
