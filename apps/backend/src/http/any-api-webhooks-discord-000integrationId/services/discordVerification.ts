import type { APIGatewayProxyEventV2 } from "aws-lambda";
import * as nacl from "tweetnacl";

/**
 * Verifies Discord webhook signature using Ed25519
 * Reuses pattern from existing Discord integration but uses public key from integration config
 */
export function verifyDiscordSignature(
  event: APIGatewayProxyEventV2,
  publicKey: string
): boolean {
  // API Gateway normalizes headers to lowercase, but handle both cases
  const headers = Object.keys(event.headers).reduce((acc, key) => {
    acc[key.toLowerCase()] = event.headers[key];
    return acc;
  }, {} as Record<string, string | undefined>);

  const signature = headers["x-signature-ed25519"];
  const timestamp = headers["x-signature-timestamp"];
  const body = event.body || "";

  if (!signature || !timestamp) {
    console.warn("Missing Discord signature headers");
    return false;
  }

  try {
    // Check timestamp to prevent replay attacks
    const currentTime = Math.floor(Date.now() / 1000);
    const requestTime = parseInt(timestamp, 10);

    // Reject requests older than 5 minutes
    if (currentTime - requestTime > 300) {
      console.warn("Discord request too old");
      return false;
    }

    // Verify Ed25519 signature using tweetnacl
    // Convert hex signature to buffer
    const signatureBuffer = Buffer.from(signature, "hex");

    // Convert hex public key to buffer - ensure it's 32 bytes
    const publicKeyBuffer = Buffer.from(publicKey, "hex");

    // Validate key length
    if (publicKeyBuffer.length !== 32) {
      console.error(
        `Invalid public key length: ${publicKeyBuffer.length}, expected 32`
      );
      return false;
    }

    // Create the message to verify (timestamp + body)
    const message = timestamp + body;
    const messageBuffer = Buffer.from(message, "utf8");

    let isValid = false;

    try {
      isValid = nacl.sign.detached.verify(
        new Uint8Array(messageBuffer),
        new Uint8Array(signatureBuffer),
        new Uint8Array(publicKeyBuffer)
      );
    } catch (error) {
      console.error("tweetnacl verification failed:", error);
      return false;
    }

    if (!isValid) {
      console.warn("Discord signature verification failed");
      return false;
    }

    console.log("Discord signature verified successfully");
    return true;
  } catch (error) {
    console.error("Error verifying Discord signature:", error);
    console.error("Signature verification error details:", {
      signature: signature?.substring(0, 10) + "...",
      timestamp,
      publicKeyLength: publicKey?.length,
      bodyLength: body?.length,
    });
    return false;
  }
}

