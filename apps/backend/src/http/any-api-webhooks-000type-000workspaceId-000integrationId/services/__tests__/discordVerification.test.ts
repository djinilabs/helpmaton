import * as nacl from "tweetnacl";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { createAPIGatewayEventV2 } from "../../../utils/__tests__/test-helpers";
import { verifyDiscordSignature } from "../discordVerification";

describe("verifyDiscordSignature", () => {
  // Generate a valid Ed25519 keypair for testing
  const keypair = nacl.sign.keyPair();
  const publicKeyHex = Buffer.from(keypair.publicKey).toString("hex");
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({ type: 1 }); // PING interaction

  function createValidSignature(
    privateKey: Uint8Array,
    ts: string,
    bodyText: string
  ): string {
    const message = ts + bodyText;
    const messageBuffer = Buffer.from(message, "utf8");
    const signature = nacl.sign.detached(
      new Uint8Array(messageBuffer),
      privateKey
    );
    return Buffer.from(signature).toString("hex");
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should verify valid Ed25519 signature", () => {
    const signature = createValidSignature(keypair.secretKey, timestamp, body);
    const event = createAPIGatewayEventV2({
      headers: {
        "x-signature-ed25519": signature,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const result = verifyDiscordSignature(event, publicKeyHex);
    expect(result).toBe(true);
  });

  it("should reject invalid signature with wrong public key", () => {
    const wrongKeypair = nacl.sign.keyPair();
    const wrongPublicKeyHex = Buffer.from(wrongKeypair.publicKey).toString("hex");
    const signature = createValidSignature(keypair.secretKey, timestamp, body);
    const event = createAPIGatewayEventV2({
      headers: {
        "x-signature-ed25519": signature,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const result = verifyDiscordSignature(event, wrongPublicKeyHex);
    expect(result).toBe(false);
  });

  it("should reject request with missing X-Signature-Ed25519 header", () => {
    const event = createAPIGatewayEventV2({
      headers: {
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const result = verifyDiscordSignature(event, publicKeyHex);
    expect(result).toBe(false);
  });

  it("should reject request with missing X-Signature-Timestamp header", () => {
    const signature = createValidSignature(keypair.secretKey, timestamp, body);
    const event = createAPIGatewayEventV2({
      headers: {
        "x-signature-ed25519": signature,
      },
      body,
    });

    const result = verifyDiscordSignature(event, publicKeyHex);
    expect(result).toBe(false);
  });

  it("should reject replay attack (timestamp > 5 minutes old)", () => {
    const oldTimestamp = Math.floor((Date.now() / 1000) - 301).toString(); // 301 seconds ago
    const signature = createValidSignature(keypair.secretKey, oldTimestamp, body);
    const event = createAPIGatewayEventV2({
      headers: {
        "x-signature-ed25519": signature,
        "x-signature-timestamp": oldTimestamp,
      },
      body,
    });

    const result = verifyDiscordSignature(event, publicKeyHex);
    expect(result).toBe(false);
  });

  it("should accept request with timestamp exactly 5 minutes old", () => {
    const fiveMinutesAgo = Math.floor((Date.now() / 1000) - 300).toString();
    const signature = createValidSignature(keypair.secretKey, fiveMinutesAgo, body);
    const event = createAPIGatewayEventV2({
      headers: {
        "x-signature-ed25519": signature,
        "x-signature-timestamp": fiveMinutesAgo,
      },
      body,
    });

    const result = verifyDiscordSignature(event, publicKeyHex);
    expect(result).toBe(true);
  });

  it("should reject invalid public key length (not 32 bytes / 64 hex chars)", () => {
    const invalidKey = "1234567890abcdef"; // 16 hex chars = 8 bytes, should be 64 hex chars
    const signature = createValidSignature(keypair.secretKey, timestamp, body);
    const event = createAPIGatewayEventV2({
      headers: {
        "x-signature-ed25519": signature,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const result = verifyDiscordSignature(event, invalidKey);
    expect(result).toBe(false);
  });

  it("should reject invalid hex format in public key", () => {
    const invalidKey = "x".repeat(64); // 64 chars but not valid hex
    const signature = createValidSignature(keypair.secretKey, timestamp, body);
    const event = createAPIGatewayEventV2({
      headers: {
        "x-signature-ed25519": signature,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const result = verifyDiscordSignature(event, invalidKey);
    expect(result).toBe(false);
  });

  it("should reject invalid hex format in signature", () => {
    const event = createAPIGatewayEventV2({
      headers: {
        "x-signature-ed25519": "invalid-hex-format",
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const result = verifyDiscordSignature(event, publicKeyHex);
    expect(result).toBe(false);
  });

  it("should handle case-insensitive headers", () => {
    const signature = createValidSignature(keypair.secretKey, timestamp, body);
    const event = createAPIGatewayEventV2({
      headers: {
        "X-Signature-Ed25519": signature, // uppercase
        "X-Signature-Timestamp": timestamp, // uppercase
      },
      body,
    });

    const result = verifyDiscordSignature(event, publicKeyHex);
    expect(result).toBe(true);
  });

  it("should handle mixed case headers", () => {
    const signature = createValidSignature(keypair.secretKey, timestamp, body);
    const event = createAPIGatewayEventV2({
      headers: {
        "X-Signature-Ed25519": signature,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const result = verifyDiscordSignature(event, publicKeyHex);
    expect(result).toBe(true);
  });

  it("should handle empty body", () => {
    const emptyBody = "";
    const signature = createValidSignature(keypair.secretKey, timestamp, emptyBody);
    const event = createAPIGatewayEventV2({
      headers: {
        "x-signature-ed25519": signature,
        "x-signature-timestamp": timestamp,
      },
      body: emptyBody,
    });

    const result = verifyDiscordSignature(event, publicKeyHex);
    expect(result).toBe(true);
  });

  it("should handle undefined body", () => {
    const emptyBody = "";
    const signature = createValidSignature(keypair.secretKey, timestamp, emptyBody);
    const event = createAPIGatewayEventV2({
      headers: {
        "x-signature-ed25519": signature,
        "x-signature-timestamp": timestamp,
      },
      body: undefined,
    });

    const result = verifyDiscordSignature(event, publicKeyHex);
    expect(result).toBe(true);
  });

  it("should handle very long body", () => {
    const longBody = "x".repeat(100000);
    const signature = createValidSignature(keypair.secretKey, timestamp, longBody);
    const event = createAPIGatewayEventV2({
      headers: {
        "x-signature-ed25519": signature,
        "x-signature-timestamp": timestamp,
      },
      body: longBody,
    });

    const result = verifyDiscordSignature(event, publicKeyHex);
    expect(result).toBe(true);
  });

  it("should handle malformed timestamp (non-numeric)", () => {
    const signature = createValidSignature(keypair.secretKey, timestamp, body);
    const event = createAPIGatewayEventV2({
      headers: {
        "x-signature-ed25519": signature,
        "x-signature-timestamp": "not-a-number",
      },
      body,
    });

    const result = verifyDiscordSignature(event, publicKeyHex);
    expect(result).toBe(false);
  });
});

