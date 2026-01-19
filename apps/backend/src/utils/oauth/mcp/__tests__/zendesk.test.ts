/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { database } from "../../../../tables";
import {
  generateZendeskAuthUrl,
  exchangeZendeskCode,
  refreshZendeskToken,
} from "../zendesk";

// Mock fetch
global.fetch = vi.fn();

vi.mock("../../../../tables", () => ({
  database: vi.fn(),
}));

const originalEnv = process.env;

describe("Zendesk OAuth Utilities", () => {
  const workspaceId = "workspace-1";
  const serverId = "server-1";
  const mockDb = {
    "mcp-server": {
      get: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      OAUTH_REDIRECT_BASE_URL: "https://app.helpmaton.com",
    };
    vi.mocked(database).mockResolvedValue(mockDb as any);
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      serviceType: "zendesk",
      config: {
        subdomain: "acme",
        clientId: "zendesk-client-id",
        clientSecret: "zendesk-client-secret",
      },
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("generateZendeskAuthUrl", () => {
    it("should generate authorization URL with correct parameters", async () => {
      const authUrl = await generateZendeskAuthUrl(workspaceId, serverId);

      expect(authUrl).toContain("https://acme.zendesk.com/oauth/authorizations/new");
      expect(authUrl).toContain("client_id=zendesk-client-id");
      expect(authUrl).toContain("response_type=code");
      expect(authUrl).toContain("scope=tickets%3Aread");
      expect(authUrl).toContain("state=");
    });

    it("should use provided state token if given", async () => {
      const authUrl = await generateZendeskAuthUrl(
        workspaceId,
        serverId,
        "custom-state-token"
      );

      expect(authUrl).toContain("state=custom-state-token");
    });
  });

  describe("exchangeZendeskCode", () => {
    it("should exchange authorization code for tokens", async () => {
      const mockTokenResponse = {
        access_token: "zendesk-access-token",
        refresh_token: "zendesk-refresh-token",
        expires_in: 3600,
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockTokenResponse),
      } as Partial<Response> as Response);

      const result = await exchangeZendeskCode(
        workspaceId,
        serverId,
        "auth-code-123"
      );

      const callArgs = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(callArgs[1]?.body as string);
      expect(callArgs[0]).toBe("https://acme.zendesk.com/oauth/tokens");
      expect(body).toMatchObject({
        grant_type: "authorization_code",
        code: "auth-code-123",
        client_id: "zendesk-client-id",
        client_secret: "zendesk-client-secret",
        redirect_uri: "https://app.helpmaton.com/api/mcp/oauth/zendesk/callback",
      });

      expect(result.accessToken).toBe("zendesk-access-token");
      expect(result.refreshToken).toBe("zendesk-refresh-token");
      expect(result.expiresAt).toBeDefined();
    });

    it("should throw if no access token is returned", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({}),
      } as Partial<Response> as Response);

      await expect(
        exchangeZendeskCode(workspaceId, serverId, "auth-code-123")
      ).rejects.toThrow("No access token received from Zendesk");
    });
  });

  describe("refreshZendeskToken", () => {
    it("should refresh access token using refresh token", async () => {
      const mockTokenResponse = {
        access_token: "zendesk-access-token",
        refresh_token: "new-refresh-token",
        expires_in: 3600,
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockTokenResponse),
      } as Partial<Response> as Response);

      const result = await refreshZendeskToken(
        workspaceId,
        serverId,
        "refresh-token-123"
      );

      const callArgs = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(callArgs[1]?.body as string);
      expect(callArgs[0]).toBe("https://acme.zendesk.com/oauth/tokens");
      expect(body).toMatchObject({
        grant_type: "refresh_token",
        refresh_token: "refresh-token-123",
        client_id: "zendesk-client-id",
        client_secret: "zendesk-client-secret",
      });

      expect(result.accessToken).toBe("zendesk-access-token");
      expect(result.refreshToken).toBe("new-refresh-token");
      expect(result.expiresAt).toBeDefined();
    });
  });
});
