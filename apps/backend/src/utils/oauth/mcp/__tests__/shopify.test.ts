/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { database } from "../../../../tables";
import {
  generateShopifyAuthUrl,
  exchangeShopifyCode,
  refreshShopifyToken,
} from "../shopify";

// Mock fetch
global.fetch = vi.fn();

vi.mock("../../../../tables", () => ({
  database: vi.fn(),
}));

const originalEnv = process.env;

describe("Shopify OAuth Utilities", () => {
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
      SHOPIFY_OAUTH_CLIENT_ID: "shopify-client-id",
      SHOPIFY_OAUTH_CLIENT_SECRET: "shopify-client-secret",
    };
    vi.mocked(database).mockResolvedValue(mockDb as any);
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      serviceType: "shopify",
      config: {
        shopDomain: "cool-store.myshopify.com",
      },
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("generateShopifyAuthUrl", () => {
    it("should generate authorization URL with correct parameters", async () => {
      const authUrl = await generateShopifyAuthUrl(workspaceId, serverId);

      expect(authUrl).toContain(
        "https://cool-store.myshopify.com/admin/oauth/authorize"
      );
      expect(authUrl).toContain("client_id=shopify-client-id");
      expect(authUrl).toContain("scope=read_orders");
      expect(authUrl).toContain("access_mode=offline");
      expect(authUrl).toContain("state=");
    });

    it("should use provided state token if given", async () => {
      const authUrl = await generateShopifyAuthUrl(
        workspaceId,
        serverId,
        "custom-state-token"
      );

      expect(authUrl).toContain("state=custom-state-token");
    });
  });

  describe("exchangeShopifyCode", () => {
    it("should exchange authorization code for tokens", async () => {
      const mockTokenResponse = {
        access_token: "shopify-access-token",
        scope: "read_orders,read_products,read_customers",
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockTokenResponse),
      } as Partial<Response> as Response);

      const result = await exchangeShopifyCode(
        workspaceId,
        serverId,
        "auth-code-123"
      );

      const callArgs = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(callArgs[1]?.body as string);
      expect(callArgs[0]).toBe(
        "https://cool-store.myshopify.com/admin/oauth/access_token"
      );
      expect(body).toMatchObject({
        client_id: "shopify-client-id",
        client_secret: "shopify-client-secret",
        code: "auth-code-123",
      });

      expect(result.accessToken).toBe("shopify-access-token");
      expect(result.refreshToken).toBe("shopify-access-token");
      expect(result.expiresAt).toBeDefined();
    });

    it("should throw if no access token is returned", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({}),
      } as Partial<Response> as Response);

      await expect(
        exchangeShopifyCode(workspaceId, serverId, "auth-code-123")
      ).rejects.toThrow("No access token received from Shopify");
    });
  });

  describe("refreshShopifyToken", () => {
    it("should throw since refresh is unsupported", async () => {
      await expect(refreshShopifyToken()).rejects.toThrow(
        "Shopify OAuth does not support refresh tokens"
      );
    });
  });
});
