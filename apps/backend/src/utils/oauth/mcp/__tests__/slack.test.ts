import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  generateSlackAuthUrl,
  exchangeSlackCode,
  refreshSlackToken,
} from "../slack";

// Mock fetch
global.fetch = vi.fn();

const originalEnv = process.env;

describe("Slack OAuth Utilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      SLACK_OAUTH_CLIENT_ID: "slack-client-id",
      SLACK_OAUTH_CLIENT_SECRET: "slack-client-secret",
      OAUTH_REDIRECT_BASE_URL: "https://app.helpmaton.com",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("generateSlackAuthUrl", () => {
    it("should generate authorization URL with correct parameters", () => {
      const authUrl = generateSlackAuthUrl("workspace-1", "server-1");

      expect(authUrl).toContain("https://slack.com/oauth/v2/authorize");
      expect(authUrl).toContain("client_id=slack-client-id");
      expect(authUrl).toContain("scope=channels%3Aread");
      expect(authUrl).toContain("redirect_uri=");
      expect(authUrl).toContain("state=");
    });

    it("should use provided state token if given", () => {
      const authUrl = generateSlackAuthUrl(
        "workspace-1",
        "server-1",
        "custom-state-token"
      );

      expect(authUrl).toContain("state=custom-state-token");
    });

    it("should use redirectmeto callback in local dev", () => {
      process.env.ARC_ENV = "testing";

      const authUrl = generateSlackAuthUrl("workspace-1", "server-1");

      expect(authUrl).toContain(
        "redirect_uri=https%3A%2F%2Fredirectmeto.com%2Fhttp%3A%2F%2Flocalhost%3A5173%2Fapi%2Fmcp%2Foauth%2Fslack%2Fcallback"
      );
    });

    it("should throw error if SLACK_OAUTH_CLIENT_ID is not set", () => {
      delete process.env.SLACK_OAUTH_CLIENT_ID;

      expect(() => {
        generateSlackAuthUrl("workspace-1", "server-1");
      }).toThrow("SLACK_OAUTH_CLIENT_ID is not set");
    });
  });

  describe("exchangeSlackCode", () => {
    it("should exchange authorization code for tokens", async () => {
      const mockTokenResponse = {
        ok: true,
        access_token: "slack-access-token",
        refresh_token: "slack-refresh-token",
        expires_in: 3600,
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockTokenResponse),
      } as Partial<Response> as Response);

      const result = await exchangeSlackCode("auth-code-123");

      expect(fetch).toHaveBeenCalledWith(
        "https://slack.com/api/oauth.v2.access",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/x-www-form-urlencoded",
          }),
        })
      );

      const callArgs = vi.mocked(fetch).mock.calls[0];
      const body = callArgs[1]?.body as URLSearchParams;
      expect(body.toString()).toContain("code=auth-code-123");
      expect(body.toString()).toContain("client_id=slack-client-id");
      expect(body.toString()).toContain("client_secret=slack-client-secret");

      expect(result.accessToken).toBe("slack-access-token");
      expect(result.refreshToken).toBe("slack-refresh-token");
      expect(result.expiresAt).toBeDefined();
    });

    it("should use redirectmeto callback in local dev", async () => {
      process.env.ARC_ENV = "testing";

      const mockTokenResponse = {
        ok: true,
        access_token: "slack-access-token",
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockTokenResponse),
      } as Partial<Response> as Response);

      await exchangeSlackCode("auth-code-123");

      const callArgs = vi.mocked(fetch).mock.calls[0];
      const body = callArgs[1]?.body as URLSearchParams;
      expect(body.toString()).toContain(
        "redirect_uri=https%3A%2F%2Fredirectmeto.com%2Fhttp%3A%2F%2Flocalhost%3A5173%2Fapi%2Fmcp%2Foauth%2Fslack%2Fcallback"
      );
    });

    it("should handle missing refresh token by falling back to access token", async () => {
      const mockTokenResponse = {
        ok: true,
        access_token: "slack-access-token",
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockTokenResponse),
      } as Partial<Response> as Response);

      const result = await exchangeSlackCode("auth-code-123");

      expect(result.refreshToken).toBe("slack-access-token");
    });

    it("should throw error when Slack returns ok false", async () => {
      const mockTokenResponse = {
        ok: false,
        error: "invalid_code",
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockTokenResponse),
      } as Partial<Response> as Response);

      await expect(exchangeSlackCode("auth-code-123")).rejects.toThrow(
        "invalid_code"
      );
    });
  });

  describe("refreshSlackToken", () => {
    it("should refresh tokens successfully", async () => {
      const mockResponse = {
        ok: true,
        access_token: "new-access-token",
        refresh_token: "new-refresh-token",
        expires_in: 7200,
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockResponse),
      } as Partial<Response> as Response);

      const result = await refreshSlackToken("old-refresh-token");

      expect(fetch).toHaveBeenCalledWith(
        "https://slack.com/api/oauth.v2.access",
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
