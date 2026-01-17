import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  generateLinearAuthUrl,
  exchangeLinearCode,
  refreshLinearToken,
} from "../linear";

// Mock fetch
global.fetch = vi.fn();

const originalEnv = process.env;

describe("Linear OAuth Utilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      LINEAR_OAUTH_CLIENT_ID: "linear-client-id-123",
      LINEAR_OAUTH_CLIENT_SECRET: "linear-client-secret-456",
      OAUTH_REDIRECT_BASE_URL: "https://app.helpmaton.com",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("generateLinearAuthUrl", () => {
    it("should generate authorization URL with correct parameters", () => {
      const authUrl = generateLinearAuthUrl("workspace-1", "server-1");

      expect(authUrl).toContain("https://linear.app/oauth/authorize");
      expect(authUrl).toContain("client_id=linear-client-id-123");
      expect(authUrl).toContain("response_type=code");
      expect(authUrl).toContain("scope=read");
      expect(authUrl).toContain("actor=app");
      expect(authUrl).toContain("redirect_uri=");
      expect(authUrl).toContain("state=");
    });

    it("should use provided state token if given", () => {
      const authUrl = generateLinearAuthUrl(
        "workspace-1",
        "server-1",
        "custom-state-token"
      );

      expect(authUrl).toContain("state=custom-state-token");
    });

    it("should throw error if LINEAR_OAUTH_CLIENT_ID is not set", () => {
      delete process.env.LINEAR_OAUTH_CLIENT_ID;

      expect(() => {
        generateLinearAuthUrl("workspace-1", "server-1");
      }).toThrow("LINEAR_OAUTH_CLIENT_ID is not set");
    });
  });

  describe("exchangeLinearCode", () => {
    it("should exchange authorization code for tokens", async () => {
      const mockTokenResponse = {
        access_token: "linear-access-token",
        token_type: "bearer",
        scope: "read",
        refresh_token: "linear-refresh-token",
        expires_in: 3600,
      };

      const mockViewerResponse = {
        data: {
          viewer: {
            email: "viewer@example.com",
          },
        },
      };

      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue(mockTokenResponse),
        } as Partial<Response> as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue(mockViewerResponse),
        } as Partial<Response> as Response);

      const result = await exchangeLinearCode("auth-code-123");

      expect(fetch).toHaveBeenCalledWith(
        "https://api.linear.app/oauth/token",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: expect.stringMatching(/^Basic /),
          }),
        })
      );

      const callArgs = vi.mocked(fetch).mock.calls[0];
      const body = callArgs[1]?.body as URLSearchParams;
      expect(body.toString()).toContain("grant_type=authorization_code");

      expect(result.accessToken).toBe("linear-access-token");
      expect(result.refreshToken).toBe("linear-refresh-token");
      expect(result.email).toBe("viewer@example.com");
      expect(result.expiresAt).toBeDefined();
    });

    it("should handle missing refresh token by falling back to access token", async () => {
      const mockTokenResponse = {
        access_token: "linear-access-token",
        token_type: "bearer",
        scope: "read",
      };

      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue(mockTokenResponse),
        } as Partial<Response> as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          json: vi.fn().mockResolvedValue({}),
        } as Partial<Response> as Response);

      const result = await exchangeLinearCode("auth-code-123");

      expect(result.refreshToken).toBe("linear-access-token");
    });

    it("should throw error when token exchange fails", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: vi.fn().mockResolvedValue("Invalid code"),
      } as Partial<Response> as Response);

      await expect(exchangeLinearCode("bad-code")).rejects.toThrow(
        "Failed to exchange Linear code"
      );
    });
  });

  describe("refreshLinearToken", () => {
    it("should refresh tokens successfully", async () => {
      const mockResponse = {
        access_token: "new-access-token",
        token_type: "bearer",
        refresh_token: "new-refresh-token",
        expires_in: 7200,
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockResponse),
      } as Partial<Response> as Response);

      const result = await refreshLinearToken("old-refresh-token");

      expect(fetch).toHaveBeenCalledWith(
        "https://api.linear.app/oauth/token",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: expect.stringMatching(/^Basic /),
          }),
        })
      );
      expect(result.accessToken).toBe("new-access-token");
      expect(result.refreshToken).toBe("new-refresh-token");
      expect(result.expiresAt).toBeDefined();
    });
  });
});
