import { createHmac } from "crypto";

import type { APIGatewayProxyEventV2 } from "aws-lambda";

/**
 * Verifies Slack webhook signature using HMAC SHA256
 * Format: v0={hex(hmac_sha256(timestamp + body))}
 */
export function verifySlackSignature(
  event: APIGatewayProxyEventV2,
  signingSecret: string
): boolean {
  // API Gateway normalizes headers to lowercase, but handle both cases
  const headers = Object.keys(event.headers).reduce((acc, key) => {
    acc[key.toLowerCase()] = event.headers[key];
    return acc;
  }, {} as Record<string, string | undefined>);

  const signature = headers["x-slack-signature"];
  const timestamp = headers["x-slack-request-timestamp"];
  const body = event.body || "";

  if (!signature || !timestamp) {
    console.warn("Missing Slack signature headers");
    return false;
  }

  try {
    // Check timestamp to prevent replay attacks
    const currentTime = Math.floor(Date.now() / 1000);
    const requestTime = parseInt(timestamp, 10);

    // Reject requests older than 5 minutes
    if (currentTime - requestTime > 300) {
      console.warn("Slack request too old");
      return false;
    }

    // Create signature base string: version + timestamp + body
    const sigBaseString = `v0:${timestamp}:${body}`;

    // Compute HMAC SHA256
    const hmac = createHmac("sha256", signingSecret);
    hmac.update(sigBaseString);
    const computedSignature = `v0=${hmac.digest("hex")}`;

    // Use timing-safe comparison to prevent timing attacks
    if (signature.length !== computedSignature.length) {
      console.warn("Slack signature length mismatch");
      return false;
    }

    let isValid = true;
    for (let i = 0; i < signature.length; i++) {
      if (signature[i] !== computedSignature[i]) {
        isValid = false;
      }
    }

    if (!isValid) {
      console.warn("Slack signature verification failed");
      return false;
    }

    console.log("Slack signature verified successfully");
    return true;
  } catch (error) {
    console.error("Error verifying Slack signature:", error);
    return false;
  }
}

