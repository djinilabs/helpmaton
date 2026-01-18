import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  generateStripeAuthUrl,
  exchangeStripeCode,
  refreshStripeToken,
} from "../stripe";

global.fetch = vi.fn();

const originalEnv = process.env;

describe("Stripe OAuth Utilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      STRIPE_OAUTH_CLIENT_ID: "stripe-client-id-123",
      STRIPE_OAUTH_CLIENT_SECRET: "stripe-client-secret-456",
      OAUTH_REDIRECT_BASE_URL: "https://app.helpmaton.com",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("generateStripeAuthUrl", () => {
    it("should generate authorization URL with correct parameters", () => {
      const authUrl = generateStripeAuthUrl("workspace-1", "server-1");

      expect(authUrl).toContain("https://connect.stripe.com/oauth/authorize");
      expect(authUrl).toContain("client_id=stripe-client-id-123");
      expect(authUrl).toContain("response_type=code");
      expect(authUrl).toContain("scope=read_only");
      expect(authUrl).toContain("redirect_uri=");
      expect(authUrl).toContain("state=");
    });

    it("should use provided state token if given", () => {
      const authUrl = generateStripeAuthUrl(
        "workspace-1",
        "server-1",
        "custom-state-token"
      );

      expect(authUrl).toContain("state=custom-state-token");
    });

    it("should throw error if STRIPE_OAUTH_CLIENT_ID is not set", () => {
      delete process.env.STRIPE_OAUTH_CLIENT_ID;

      expect(() => {
        generateStripeAuthUrl("workspace-1", "server-1");
      }).toThrow("STRIPE_OAUTH_CLIENT_ID is not set");
    });
  });

  describe("exchangeStripeCode", () => {
    it("should exchange authorization code for tokens", async () => {
      const mockTokenResponse = {
        access_token: "stripe-access-token",
        refresh_token: "stripe-refresh-token",
        token_type: "bearer",
        scope: "read_only",
        expires_in: 3600,
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockTokenResponse),
      } as Partial<Response> as Response);

      const result = await exchangeStripeCode("auth-code-123");

      expect(fetch).toHaveBeenCalledWith(
        "https://connect.stripe.com/oauth/token",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/x-www-form-urlencoded",
          }),
        })
      );

      const callArgs = vi.mocked(fetch).mock.calls[0];
      const body = callArgs[1]?.body as URLSearchParams;
      expect(body.toString()).toContain("grant_type=authorization_code");
      expect(body.toString()).toContain("code=auth-code-123");

      expect(result.accessToken).toBe("stripe-access-token");
      expect(result.refreshToken).toBe("stripe-refresh-token");
      expect(result.expiresAt).toBeDefined();
    });

    it("should handle missing refresh token by falling back to access token", async () => {
      const mockTokenResponse = {
        access_token: "stripe-access-token",
        token_type: "bearer",
        scope: "read_only",
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockTokenResponse),
      } as Partial<Response> as Response);

      const result = await exchangeStripeCode("auth-code-123");

      expect(result.refreshToken).toBe("stripe-access-token");
    });

    it("should throw error when token exchange fails", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: vi.fn().mockResolvedValue("Invalid code"),
      } as Partial<Response> as Response);

      await expect(exchangeStripeCode("bad-code")).rejects.toThrow(
        "Failed to exchange Stripe code"
      );
    });
  });

  describe("refreshStripeToken", () => {
    it("should refresh tokens successfully", async () => {
      const mockResponse = {
        access_token: "new-access-token",
        refresh_token: "new-refresh-token",
        expires_in: 7200,
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockResponse),
      } as Partial<Response> as Response);

      const result = await refreshStripeToken("old-refresh-token");

      expect(fetch).toHaveBeenCalledWith(
        "https://connect.stripe.com/oauth/token",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/x-www-form-urlencoded",
          }),
        })
      );
      expect(result.accessToken).toBe("new-access-token");
      expect(result.refreshToken).toBe("new-refresh-token");
      expect(result.expiresAt).toBeDefined();
    });
  });
});
