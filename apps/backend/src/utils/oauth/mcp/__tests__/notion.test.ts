import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  generateNotionAuthUrl,
  exchangeNotionCode,
  refreshNotionToken,
} from "../notion";

// Mock fetch
global.fetch = vi.fn();

// Mock environment variables
const originalEnv = process.env;

describe("Notion OAuth Utilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      NOTION_OAUTH_CLIENT_ID: "notion-client-id-123",
      NOTION_OAUTH_CLIENT_SECRET: "notion-client-secret-456",
      OAUTH_REDIRECT_BASE_URL: "https://app.helpmaton.com",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("generateNotionAuthUrl", () => {
    it("should generate authorization URL with correct parameters", () => {
      const workspaceId = "workspace-1";
      const serverId = "server-1";

      const authUrl = generateNotionAuthUrl(workspaceId, serverId);

      expect(authUrl).toContain("https://api.notion.com/v1/oauth/authorize");
      expect(authUrl).toContain("client_id=notion-client-id-123");
      expect(authUrl).toContain("response_type=code");
      expect(authUrl).toContain("owner=user");
      expect(authUrl).toContain("redirect_uri=");
      expect(authUrl).toContain("state=");
    });

    it("should use provided state token if given", () => {
      const workspaceId = "workspace-1";
      const serverId = "server-1";
      const customState = "custom-state-token";

      const authUrl = generateNotionAuthUrl(workspaceId, serverId, customState);

      expect(authUrl).toContain(`state=${customState}`);
    });

    it("should throw error if NOTION_OAUTH_CLIENT_ID is not set", () => {
      delete process.env.NOTION_OAUTH_CLIENT_ID;

      expect(() => {
        generateNotionAuthUrl("workspace-1", "server-1");
      }).toThrow("NOTION_OAUTH_CLIENT_ID is not set");
    });
  });

  describe("exchangeNotionCode", () => {
    it("should exchange authorization code for tokens", async () => {
      const code = "auth-code-123";
      const mockTokenResponse = {
        access_token: "notion-access-token",
        token_type: "bearer",
        owner: {
          type: "user",
          user: {
            object: "user",
            id: "user-123",
            type: "person",
            person: {
              email: "user@example.com",
            },
          },
        },
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockTokenResponse),
      } as Partial<Response> as Response);

      const result = await exchangeNotionCode(code);

      expect(fetch).toHaveBeenCalledWith(
        "https://api.notion.com/v1/oauth/token",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Authorization: expect.stringMatching(/^Basic /),
          }),
          body: expect.stringContaining("grant_type"),
        })
      );

      // Verify body doesn't contain client_id or client_secret (they're in Authorization header)
      const callArgs = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(callArgs[1]?.body as string);
      expect(body).not.toHaveProperty("client_id");
      expect(body).not.toHaveProperty("client_secret");
      expect(body).toHaveProperty("grant_type", "authorization_code");
      expect(body).toHaveProperty("code", code);
      expect(body).toHaveProperty("redirect_uri");

      expect(result.accessToken).toBe("notion-access-token");
      expect(result.refreshToken).toBe("notion-access-token"); // Notion uses access token as refresh token
      expect(result.email).toBe("user@example.com");
      expect(result.expiresAt).toBeDefined();
    });

    it("should handle token response without email", async () => {
      const code = "auth-code-123";
      const mockTokenResponse = {
        access_token: "notion-access-token",
        token_type: "bearer",
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockTokenResponse),
      } as Partial<Response> as Response);

      const result = await exchangeNotionCode(code);

      expect(result.accessToken).toBe("notion-access-token");
      expect(result.email).toBeUndefined();
    });

    it("should throw error if token exchange fails", async () => {
      const code = "invalid-code";

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: vi.fn().mockResolvedValue("Invalid code"),
      } as Partial<Response> as Response);

      await expect(exchangeNotionCode(code)).rejects.toThrow(
        "Failed to exchange Notion code"
      );
    });

    it("should throw error if NOTION_OAUTH_CLIENT_ID is not set", async () => {
      delete process.env.NOTION_OAUTH_CLIENT_ID;

      await expect(exchangeNotionCode("code")).rejects.toThrow(
        "NOTION_OAUTH_CLIENT_ID is not set"
      );
    });

    it("should throw error if NOTION_OAUTH_CLIENT_SECRET is not set", async () => {
      delete process.env.NOTION_OAUTH_CLIENT_SECRET;

      await expect(exchangeNotionCode("code")).rejects.toThrow(
        "NOTION_OAUTH_CLIENT_SECRET is not set"
      );
    });
  });

  describe("refreshNotionToken", () => {
    it("should return same token (Notion tokens don't expire)", async () => {
      const refreshToken = "notion-access-token";

      const result = await refreshNotionToken(refreshToken);

      expect(result.accessToken).toBe(refreshToken);
      expect(result.refreshToken).toBe(refreshToken);
      expect(result.expiresAt).toBeDefined();
      // ExpiresAt should be far in the future (1 year)
      const expiresAtDate = new Date(result.expiresAt);
      const now = new Date();
      const oneYearFromNow = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
      expect(expiresAtDate.getTime()).toBeGreaterThan(now.getTime());
      expect(expiresAtDate.getTime()).toBeLessThanOrEqual(oneYearFromNow.getTime());
    });
  });
});
