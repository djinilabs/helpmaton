import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  generateSalesforceAuthUrl,
  exchangeSalesforceCode,
  refreshSalesforceToken,
} from "../salesforce";

// Mock fetch
global.fetch = vi.fn();

const originalEnv = process.env;

describe("Salesforce OAuth Utilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      SALESFORCE_OAUTH_CLIENT_ID: "salesforce-client-id",
      SALESFORCE_OAUTH_CLIENT_SECRET: "salesforce-client-secret",
      OAUTH_REDIRECT_BASE_URL: "https://app.helpmaton.com",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("generateSalesforceAuthUrl", () => {
    it("should generate authorization URL with correct parameters", () => {
      const authUrl = generateSalesforceAuthUrl("workspace-1", "server-1");

      expect(authUrl).toContain(
        "https://login.salesforce.com/services/oauth2/authorize"
      );
      expect(authUrl).toContain("client_id=salesforce-client-id");
      expect(authUrl).toContain("response_type=code");
      expect(authUrl).toContain("scope=api");
      expect(authUrl).toContain("state=");
    });

    it("should use provided state token if given", () => {
      const authUrl = generateSalesforceAuthUrl(
        "workspace-1",
        "server-1",
        "custom-state-token"
      );

      expect(authUrl).toContain("state=custom-state-token");
    });

    it("should throw error if SALESFORCE_OAUTH_CLIENT_ID is not set", () => {
      delete process.env.SALESFORCE_OAUTH_CLIENT_ID;

      expect(() => {
        generateSalesforceAuthUrl("workspace-1", "server-1");
      }).toThrow("SALESFORCE_OAUTH_CLIENT_ID is not set");
    });
  });

  describe("exchangeSalesforceCode", () => {
    it("should exchange authorization code for tokens", async () => {
      const mockTokenResponse = {
        access_token: "salesforce-access-token",
        refresh_token: "salesforce-refresh-token",
        instance_url: "https://na1.salesforce.com",
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockTokenResponse),
      } as Partial<Response> as Response);

      const result = await exchangeSalesforceCode("auth-code-123");

      expect(fetch).toHaveBeenCalledWith(
        "https://login.salesforce.com/services/oauth2/token",
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

      expect(result.accessToken).toBe("salesforce-access-token");
      expect(result.refreshToken).toBe("salesforce-refresh-token");
      expect(result.instanceUrl).toBe("https://na1.salesforce.com");
      expect(result.expiresAt).toBeDefined();
    });

    it("should handle missing refresh token by falling back to access token", async () => {
      const mockTokenResponse = {
        access_token: "salesforce-access-token",
        instance_url: "https://na1.salesforce.com",
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockTokenResponse),
      } as Partial<Response> as Response);

      const result = await exchangeSalesforceCode("auth-code-123");

      expect(result.refreshToken).toBe("salesforce-access-token");
    });
  });

  describe("refreshSalesforceToken", () => {
    it("should refresh tokens successfully", async () => {
      const mockResponse = {
        access_token: "new-access-token",
        refresh_token: "new-refresh-token",
        instance_url: "https://na2.salesforce.com",
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockResponse),
      } as Partial<Response> as Response);

      const result = await refreshSalesforceToken("old-refresh-token");

      expect(fetch).toHaveBeenCalledWith(
        "https://login.salesforce.com/services/oauth2/token",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/x-www-form-urlencoded",
          }),
        })
      );
      expect(result.accessToken).toBe("new-access-token");
      expect(result.refreshToken).toBe("new-refresh-token");
      expect(result.instanceUrl).toBe("https://na2.salesforce.com");
      expect(result.expiresAt).toBeDefined();
    });
  });
});
