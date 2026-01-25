import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  generateTodoistAuthUrl,
  exchangeTodoistCode,
  refreshTodoistToken,
} from "../todoist";

// Mock fetch
global.fetch = vi.fn();

const originalEnv = process.env;

describe("Todoist OAuth Utilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      TODOIST_OAUTH_CLIENT_ID: "todoist-client-id",
      TODOIST_OAUTH_CLIENT_SECRET: "todoist-client-secret",
      OAUTH_REDIRECT_BASE_URL: "https://app.helpmaton.com",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("generateTodoistAuthUrl", () => {
    it("should generate authorization URL with correct parameters", () => {
      const authUrl = generateTodoistAuthUrl("workspace-1", "server-1");

      expect(authUrl).toContain("https://api.todoist.com/oauth/authorize");
      expect(authUrl).toContain("client_id=todoist-client-id");
      expect(authUrl).toContain("scope=data%3Aread_write");
      expect(authUrl).toContain("state=");
    });

    it("should use provided state token if given", () => {
      const authUrl = generateTodoistAuthUrl(
        "workspace-1",
        "server-1",
        "custom-state-token"
      );

      expect(authUrl).toContain("state=custom-state-token");
    });

    it("should throw error if TODOIST_OAUTH_CLIENT_ID is not set", () => {
      delete process.env.TODOIST_OAUTH_CLIENT_ID;

      expect(() => {
        generateTodoistAuthUrl("workspace-1", "server-1");
      }).toThrow("TODOIST_OAUTH_CLIENT_ID is not set");
    });
  });

  describe("exchangeTodoistCode", () => {
    it("should exchange authorization code for tokens", async () => {
      const mockTokenResponse = {
        access_token: "todoist-access-token",
        token_type: "Bearer",
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockTokenResponse),
      } as Partial<Response> as Response);

      const result = await exchangeTodoistCode("auth-code-123");

      const callArgs = vi.mocked(fetch).mock.calls[0];
      const body = callArgs[1]?.body as URLSearchParams;
      expect(body.toString()).toContain("code=auth-code-123");
      expect(body.toString()).toContain("client_id=todoist-client-id");
      expect(body.toString()).toContain("client_secret=todoist-client-secret");
      expect(body.toString()).toContain(
        "redirect_uri=https%3A%2F%2Fapp.helpmaton.com%2Fapi%2Fmcp%2Foauth%2Ftodoist%2Fcallback"
      );

      expect(result.accessToken).toBe("todoist-access-token");
      expect(result.refreshToken).toBe("todoist-access-token");
      expect(result.expiresAt).toBeDefined();
    });

    it("should throw if no access token is returned", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({}),
      } as Partial<Response> as Response);

      await expect(exchangeTodoistCode("auth-code-123")).rejects.toThrow(
        "No access token received from Todoist"
      );
    });
  });

  describe("refreshTodoistToken", () => {
    it("should throw since refresh is unsupported", async () => {
      await expect(refreshTodoistToken()).rejects.toThrow(
        "Todoist OAuth does not support refresh tokens"
      );
    });
  });
});
