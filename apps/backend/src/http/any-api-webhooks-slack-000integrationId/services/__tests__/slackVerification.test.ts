import { createHmac } from "crypto";

import { describe, it, expect } from "vitest";

import { createAPIGatewayEventV2 } from "../../../utils/__tests__/test-helpers";
import { verifySlackSignature } from "../slackVerification";

describe("verifySlackSignature", () => {
  const signingSecret = "test-signing-secret";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({ type: "event_callback", event: { type: "message" } });

  function createValidSignature(secret: string, ts: string, bodyText: string): string {
    const sigBaseString = `v0:${ts}:${bodyText}`;
    const hmac = createHmac("sha256", secret);
    hmac.update(sigBaseString);
    return `v0=${hmac.digest("hex")}`;
  }

  it("should verify valid signature with correct HMAC SHA256", () => {
    const signature = createValidSignature(signingSecret, timestamp, body);
    const event = createAPIGatewayEventV2({
      headers: {
        "x-slack-signature": signature,
        "x-slack-request-timestamp": timestamp,
      },
      body,
    });

    const result = verifySlackSignature(event, signingSecret);
    expect(result).toBe(true);
  });

  it("should reject invalid signature with wrong secret", () => {
    const signature = createValidSignature("wrong-secret", timestamp, body);
    const event = createAPIGatewayEventV2({
      headers: {
        "x-slack-signature": signature,
        "x-slack-request-timestamp": timestamp,
      },
      body,
    });

    const result = verifySlackSignature(event, signingSecret);
    expect(result).toBe(false);
  });

  it("should reject request with missing X-Slack-Signature header", () => {
    const event = createAPIGatewayEventV2({
      headers: {
        "x-slack-request-timestamp": timestamp,
      },
      body,
    });

    const result = verifySlackSignature(event, signingSecret);
    expect(result).toBe(false);
  });

  it("should reject request with missing X-Slack-Request-Timestamp header", () => {
    const signature = createValidSignature(signingSecret, timestamp, body);
    const event = createAPIGatewayEventV2({
      headers: {
        "x-slack-signature": signature,
      },
      body,
    });

    const result = verifySlackSignature(event, signingSecret);
    expect(result).toBe(false);
  });

  it("should reject replay attack (timestamp > 5 minutes old)", () => {
    const oldTimestamp = Math.floor((Date.now() / 1000) - 301).toString(); // 301 seconds ago
    const signature = createValidSignature(signingSecret, oldTimestamp, body);
    const event = createAPIGatewayEventV2({
      headers: {
        "x-slack-signature": signature,
        "x-slack-request-timestamp": oldTimestamp,
      },
      body,
    });

    const result = verifySlackSignature(event, signingSecret);
    expect(result).toBe(false);
  });

  it("should accept request with timestamp exactly 5 minutes old", () => {
    const fiveMinutesAgo = Math.floor((Date.now() / 1000) - 300).toString(); // exactly 300 seconds
    const signature = createValidSignature(signingSecret, fiveMinutesAgo, body);
    const event = createAPIGatewayEventV2({
      headers: {
        "x-slack-signature": signature,
        "x-slack-request-timestamp": fiveMinutesAgo,
      },
      body,
    });

    const result = verifySlackSignature(event, signingSecret);
    expect(result).toBe(true);
  });

  it("should accept request with timestamp just under 5 minutes old", () => {
    const justUnder = Math.floor((Date.now() / 1000) - 299).toString(); // 299 seconds ago
    const signature = createValidSignature(signingSecret, justUnder, body);
    const event = createAPIGatewayEventV2({
      headers: {
        "x-slack-signature": signature,
        "x-slack-request-timestamp": justUnder,
      },
      body,
    });

    const result = verifySlackSignature(event, signingSecret);
    expect(result).toBe(true);
  });

  it("should reject signature with length mismatch", () => {
    const event = createAPIGatewayEventV2({
      headers: {
        "x-slack-signature": "v0=short",
        "x-slack-request-timestamp": timestamp,
      },
      body,
    });

    const result = verifySlackSignature(event, signingSecret);
    expect(result).toBe(false);
  });

  it("should handle case-insensitive headers", () => {
    const signature = createValidSignature(signingSecret, timestamp, body);
    const event = createAPIGatewayEventV2({
      headers: {
        "X-Slack-Signature": signature, // uppercase
        "X-Slack-Request-Timestamp": timestamp, // uppercase
      },
      body,
    });

    const result = verifySlackSignature(event, signingSecret);
    expect(result).toBe(true);
  });

  it("should handle mixed case headers", () => {
    const signature = createValidSignature(signingSecret, timestamp, body);
    const event = createAPIGatewayEventV2({
      headers: {
        "X-Slack-Signature": signature,
        "x-slack-request-timestamp": timestamp,
      },
      body,
    });

    const result = verifySlackSignature(event, signingSecret);
    expect(result).toBe(true);
  });

  it("should handle malformed timestamp (non-numeric)", () => {
    const signature = createValidSignature(signingSecret, timestamp, body);
    const event = createAPIGatewayEventV2({
      headers: {
        "x-slack-signature": signature,
        "x-slack-request-timestamp": "not-a-number",
      },
      body,
    });

    const result = verifySlackSignature(event, signingSecret);
    expect(result).toBe(false);
  });

  it("should handle invalid signature format (not v0=...)", () => {
    const event = createAPIGatewayEventV2({
      headers: {
        "x-slack-signature": "invalid-format",
        "x-slack-request-timestamp": timestamp,
      },
      body,
    });

    const result = verifySlackSignature(event, signingSecret);
    expect(result).toBe(false);
  });

  it("should handle empty body", () => {
    const emptyBody = "";
    const signature = createValidSignature(signingSecret, timestamp, emptyBody);
    const event = createAPIGatewayEventV2({
      headers: {
        "x-slack-signature": signature,
        "x-slack-request-timestamp": timestamp,
      },
      body: emptyBody,
    });

    const result = verifySlackSignature(event, signingSecret);
    expect(result).toBe(true);
  });

  it("should handle undefined body", () => {
    const emptyBody = "";
    const signature = createValidSignature(signingSecret, timestamp, emptyBody);
    const event = createAPIGatewayEventV2({
      headers: {
        "x-slack-signature": signature,
        "x-slack-request-timestamp": timestamp,
      },
      body: undefined,
    });

    const result = verifySlackSignature(event, signingSecret);
    expect(result).toBe(true);
  });

  it("should handle very long body", () => {
    const longBody = "x".repeat(100000);
    const signature = createValidSignature(signingSecret, timestamp, longBody);
    const event = createAPIGatewayEventV2({
      headers: {
        "x-slack-signature": signature,
        "x-slack-request-timestamp": timestamp,
      },
      body: longBody,
    });

    const result = verifySlackSignature(event, signingSecret);
    expect(result).toBe(true);
  });
});

