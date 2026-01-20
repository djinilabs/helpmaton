import { describe, expect, it } from "vitest";

import {
  buildOAuthConfig,
  buildWorkspaceCallbackUrl,
} from "../mcp-oauth-app";

describe("buildWorkspaceCallbackUrl", () => {
  it("builds a workspace redirect with encoded error", () => {
    const url = buildWorkspaceCallbackUrl({
      redirectBaseUrl: "https://example.com",
      workspaceId: "ws-123",
      serverId: "srv-456",
      serviceType: "slack",
      success: false,
      errorMsg: "error%20message",
    });

    expect(url).toBe(
      "https://example.com/workspaces/ws-123/mcp-servers/srv-456/oauth-callback?success=false&error=error%20message&serviceType=slack"
    );
  });
});

describe("buildOAuthConfig", () => {
  it("merges server config for Shopify OAuth", () => {
    const config = buildOAuthConfig({
      tokenInfo: {
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: "2026-01-01T00:00:00.000Z",
      },
      serviceType: "shopify",
      serverConfig: { shopDomain: "test.myshopify.com" },
    });

    expect(config).toEqual({
      shopDomain: "test.myshopify.com",
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("adds optional OAuth fields when provided", () => {
    const config = buildOAuthConfig({
      tokenInfo: {
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: "2026-01-01T00:00:00.000Z",
        email: "hello@example.com",
        instanceUrl: "https://salesforce.example",
        adminId: "admin-123",
      },
      serviceType: "salesforce",
    });

    expect(config).toEqual({
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: "2026-01-01T00:00:00.000Z",
      email: "hello@example.com",
      instanceUrl: "https://salesforce.example",
      adminId: "admin-123",
    });
  });
});
