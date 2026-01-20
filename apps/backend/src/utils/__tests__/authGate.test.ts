import { describe, it, expect, beforeEach } from "vitest";

import {
  createAuthGateToken,
  normalizeAuthCallbackUrl,
  verifyAuthGateToken,
} from "../authGate";

describe("authGate utilities", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "test-auth-secret";
  });

  it("normalizes callback URLs and strips gate tokens", () => {
    const url = normalizeAuthCallbackUrl(
      "http://localhost:5173/api/auth/callback/email?token=abc&email=test@example.com&gateToken=skip",
      "http://localhost:5173"
    );

    expect(url.origin).toBe("http://localhost:5173");
    expect(url.pathname).toBe("/api/auth/callback/email");
    expect(url.searchParams.get("gateToken")).toBeNull();
    expect(url.searchParams.get("email")).toBe("test@example.com");
  });

  it("rejects callback URLs on different hosts", () => {
    expect(() =>
      normalizeAuthCallbackUrl(
        "https://evil.com/api/auth/callback/email?token=abc&email=test@example.com",
        "http://localhost:5173",
        ["http://localhost:5173"]
      )
    ).toThrow("Invalid callback URL");
  });

  it("creates and verifies gate tokens", async () => {
    const callbackUrl =
      "http://localhost:5173/api/auth/callback/email?token=abc&email=test@example.com";
    const token = await createAuthGateToken({
      email: "test@example.com",
      callbackUrl,
    });

    const payload = await verifyAuthGateToken(token);
    expect(payload.email).toBe("test@example.com");
    expect(payload.callbackUrl).toBe(callbackUrl);
  });
});
