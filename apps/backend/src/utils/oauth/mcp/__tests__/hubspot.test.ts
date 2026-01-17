import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  generateHubspotAuthUrl,
  exchangeHubspotCode,
  refreshHubspotToken,
} from "../hubspot";

// Mock fetch
global.fetch = vi.fn();

const originalEnv = process.env;

describe("HubSpot OAuth Utilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      HUBSPOT_OAUTH_CLIENT_ID: "hubspot-client-id",
      HUBSPOT_OAUTH_CLIENT_SECRET: "hubspot-client-secret",
      OAUTH_REDIRECT_BASE_URL: "https://app.helpmaton.com",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("generateHubspotAuthUrl", () => {
    it("should generate authorization URL with correct parameters", () => {
      const authUrl = generateHubspotAuthUrl("workspace-1", "server-1");

      expect(authUrl).toContain("https://app.hubspot.com/oauth/authorize");
      expect(authUrl).toContain("client_id=hubspot-client-id");
      expect(authUrl).toContain("response_type=code");
      expect(authUrl).toContain("scope=crm.objects.contacts.read");
      expect(authUrl).toContain("state=");
    });

    it("should use provided state token if given", () => {
      const authUrl = generateHubspotAuthUrl(
        "workspace-1",
        "server-1",
        "custom-state-token"
      );

      expect(authUrl).toContain("state=custom-state-token");
    });

    it("should throw error if HUBSPOT_OAUTH_CLIENT_ID is not set", () => {
      delete process.env.HUBSPOT_OAUTH_CLIENT_ID;

      expect(() => {
        generateHubspotAuthUrl("workspace-1", "server-1");
      }).toThrow("HUBSPOT_OAUTH_CLIENT_ID is not set");
    });
  });

  describe("exchangeHubspotCode", () => {
    it("should exchange authorization code for tokens", async () => {
      const mockTokenResponse = {
        access_token: "hubspot-access-token",
        refresh_token: "hubspot-refresh-token",
        expires_in: 3600,
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockTokenResponse),
      } as Partial<Response> as Response);

      const result = await exchangeHubspotCode("auth-code-123");

      expect(fetch).toHaveBeenCalledWith(
        "https://api.hubapi.com/oauth/v1/token",
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

      expect(result.accessToken).toBe("hubspot-access-token");
      expect(result.refreshToken).toBe("hubspot-refresh-token");
      expect(result.expiresAt).toBeDefined();
    });

    it("should handle missing refresh token by falling back to access token", async () => {
      const mockTokenResponse = {
        access_token: "hubspot-access-token",
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockTokenResponse),
      } as Partial<Response> as Response);

      const result = await exchangeHubspotCode("auth-code-123");

      expect(result.refreshToken).toBe("hubspot-access-token");
    });
  });

  describe("refreshHubspotToken", () => {
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

      const result = await refreshHubspotToken("old-refresh-token");

      expect(fetch).toHaveBeenCalledWith(
        "https://api.hubapi.com/oauth/v1/token",
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
