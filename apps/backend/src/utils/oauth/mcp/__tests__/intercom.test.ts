import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  generateIntercomAuthUrl,
  exchangeIntercomCode,
  refreshIntercomToken,
} from "../intercom";

// Mock fetch
global.fetch = vi.fn();

const originalEnv = process.env;

describe("Intercom OAuth Utilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      INTERCOM_OAUTH_CLIENT_ID: "intercom-client-id",
      INTERCOM_OAUTH_CLIENT_SECRET: "intercom-client-secret",
      OAUTH_REDIRECT_BASE_URL: "https://app.helpmaton.com",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("generateIntercomAuthUrl", () => {
    it("should generate authorization URL with correct parameters", () => {
      const authUrl = generateIntercomAuthUrl("workspace-1", "server-1");

      expect(authUrl).toContain("https://app.intercom.io/oauth");
      expect(authUrl).toContain("client_id=intercom-client-id");
      expect(authUrl).toContain("response_type=code");
      expect(authUrl).toContain("scope=read_conversations");
      expect(authUrl).toContain("state=");
    });

    it("should use provided state token if given", () => {
      const authUrl = generateIntercomAuthUrl(
        "workspace-1",
        "server-1",
        "custom-state-token"
      );

      expect(authUrl).toContain("state=custom-state-token");
    });

    it("should throw error if INTERCOM_OAUTH_CLIENT_ID is not set", () => {
      delete process.env.INTERCOM_OAUTH_CLIENT_ID;

      expect(() => {
        generateIntercomAuthUrl("workspace-1", "server-1");
      }).toThrow("INTERCOM_OAUTH_CLIENT_ID is not set");
    });
  });

  describe("exchangeIntercomCode", () => {
    it("should exchange authorization code for tokens and admin ID", async () => {
      const mockTokenResponse = {
        access_token: "intercom-access-token",
        token_type: "Bearer",
      };
      const mockMeResponse = { id: "admin-123", type: "admin" };

      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue(mockTokenResponse),
        } as Partial<Response> as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue(mockMeResponse),
        } as Partial<Response> as Response);

      const result = await exchangeIntercomCode("auth-code-123");

      const callArgs = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(callArgs[1]?.body as string);
      expect(body).toMatchObject({
        code: "auth-code-123",
        client_id: "intercom-client-id",
        client_secret: "intercom-client-secret",
        redirect_uri: "https://app.helpmaton.com/api/mcp/oauth/intercom/callback",
      });

      expect(result.accessToken).toBe("intercom-access-token");
      expect(result.refreshToken).toBe("intercom-access-token");
      expect(result.expiresAt).toBeDefined();
      expect(result.adminId).toBe("admin-123");
    });

    it("should throw if no access token is returned", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({}),
      } as Partial<Response> as Response);

      await expect(exchangeIntercomCode("auth-code-123")).rejects.toThrow(
        "No access token received from Intercom"
      );
    });
  });

  describe("refreshIntercomToken", () => {
    it("should throw since refresh is unsupported", async () => {
      await expect(refreshIntercomToken()).rejects.toThrow(
        "Intercom OAuth does not support refresh tokens"
      );
    });
  });
});
