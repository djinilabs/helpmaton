import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  getOAuthTokens,
  updateOAuthTokens,
  isTokenExpired,
  ensureValidToken,
  type OAuthTokens,
} from "../oauth";

// Mock the database
const { mockDatabase } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
  };
});

vi.mock("../../../tables", () => ({
  database: mockDatabase,
}));

describe("Google API OAuth Utilities", () => {
  const mockDb = {
    "mcp-server": {
      get: vi.fn(),
      update: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockDatabase.mockResolvedValue(mockDb as any);
  });

  describe("getOAuthTokens", () => {
    it("should retrieve OAuth tokens from mcp-server config", async () => {
      const workspaceId = "workspace-1";
      const serverId = "server-1";
      const pk = `mcp-servers/${workspaceId}/${serverId}`;

      const mockServer = {
        pk,
        sk: "server",
        authType: "oauth",
        config: {
          accessToken: "access-token-123",
          refreshToken: "refresh-token-456",
          expiresAt: "2024-12-31T23:59:59.000Z",
        },
      };

      mockDb["mcp-server"].get.mockResolvedValue(mockServer);

      const tokens = await getOAuthTokens(workspaceId, serverId);

      expect(mockDb["mcp-server"].get).toHaveBeenCalledWith(pk, "server");
      expect(tokens).toEqual({
        accessToken: "access-token-123",
        refreshToken: "refresh-token-456",
        expiresAt: "2024-12-31T23:59:59.000Z",
      });
    });

    it("should throw error if server not found", async () => {
      mockDb["mcp-server"].get.mockResolvedValue(null);

      await expect(
        getOAuthTokens("workspace-1", "server-1")
      ).rejects.toThrow("MCP server server-1 not found");
    });

    it("should throw error if server is not OAuth type", async () => {
      const mockServer = {
        pk: "mcp-servers/workspace-1/server-1",
        sk: "server",
        authType: "header",
        config: {},
      };

      mockDb["mcp-server"].get.mockResolvedValue(mockServer);

      await expect(
        getOAuthTokens("workspace-1", "server-1")
      ).rejects.toThrow("is not an OAuth server");
    });

    it("should throw error if tokens are missing", async () => {
      const mockServer = {
        pk: "mcp-servers/workspace-1/server-1",
        sk: "server",
        authType: "oauth",
        config: {},
      };

      mockDb["mcp-server"].get.mockResolvedValue(mockServer);

      await expect(
        getOAuthTokens("workspace-1", "server-1")
      ).rejects.toThrow("OAuth tokens not found");
    });

    it("should use current time as default expiresAt if missing", async () => {
      const mockServer = {
        pk: "mcp-servers/workspace-1/server-1",
        sk: "server",
        authType: "oauth",
        config: {
          accessToken: "access-token-123",
          refreshToken: "refresh-token-456",
        },
      };

      mockDb["mcp-server"].get.mockResolvedValue(mockServer);

      const tokens = await getOAuthTokens("workspace-1", "server-1");

      expect(tokens.expiresAt).toBeDefined();
      expect(new Date(tokens.expiresAt).getTime()).toBeLessThanOrEqual(
        Date.now()
      );
    });
  });

  describe("updateOAuthTokens", () => {
    it("should update OAuth tokens in mcp-server config", async () => {
      const workspaceId = "workspace-1";
      const serverId = "server-1";
      const pk = `mcp-servers/${workspaceId}/${serverId}`;

      const mockServer = {
        pk,
        sk: "server",
        authType: "oauth",
        config: {
          accessToken: "old-access-token",
          refreshToken: "old-refresh-token",
          expiresAt: "2024-01-01T00:00:00.000Z",
        },
      };

      mockDb["mcp-server"].get.mockResolvedValue(mockServer);
      mockDb["mcp-server"].update.mockResolvedValue(undefined);

      const newTokens = {
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
        expiresAt: "2024-12-31T23:59:59.000Z",
      };

      await updateOAuthTokens(workspaceId, serverId, newTokens);

      expect(mockDb["mcp-server"].update).toHaveBeenCalledWith({
        pk,
        sk: "server",
        config: {
          ...mockServer.config,
          ...newTokens,
        },
        updatedAt: expect.any(String),
      });
    });

    it("should throw error if server not found", async () => {
      mockDb["mcp-server"].get.mockResolvedValue(null);

      await expect(
        updateOAuthTokens("workspace-1", "server-1", {
          accessToken: "token",
          refreshToken: "refresh",
          expiresAt: "2024-12-31T23:59:59.000Z",
        })
      ).rejects.toThrow("MCP server server-1 not found");
    });
  });

  describe("isTokenExpired", () => {
    it("should return false for future expiration", () => {
      const future = new Date(Date.now() + 2 * 60 * 1000).toISOString(); // 2 minutes from now
      expect(isTokenExpired(future)).toBe(false);
    });

    it("should return true for past expiration", () => {
      const past = new Date(Date.now() - 60 * 1000).toISOString(); // 1 minute ago
      expect(isTokenExpired(past)).toBe(true);
    });

    it("should return true for expiration within 1 minute buffer", () => {
      const soon = new Date(Date.now() + 30 * 1000).toISOString(); // 30 seconds from now
      expect(isTokenExpired(soon)).toBe(true);
    });

    it("should return false for expiration beyond 1 minute buffer", () => {
      const later = new Date(Date.now() + 90 * 1000).toISOString(); // 90 seconds from now
      expect(isTokenExpired(later)).toBe(false);
    });
  });

  describe("ensureValidToken", () => {
    it("should return existing token if not expired", async () => {
      const tokens: OAuthTokens = {
        accessToken: "valid-token",
        refreshToken: "refresh-token",
        expiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(), // 2 minutes from now
      };

      const refreshTokenFn = vi.fn();

      const result = await ensureValidToken(
        "workspace-1",
        "server-1",
        tokens,
        refreshTokenFn
      );

      expect(result).toBe("valid-token");
      expect(refreshTokenFn).not.toHaveBeenCalled();
    });

    it("should refresh token if expired", async () => {
      const tokens: OAuthTokens = {
        accessToken: "expired-token",
        refreshToken: "refresh-token",
        expiresAt: new Date(Date.now() - 60 * 1000).toISOString(), // 1 minute ago
      };

      const refreshedTokens = {
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      };

      const refreshTokenFn = vi.fn().mockResolvedValue(refreshedTokens);

      mockDb["mcp-server"].get.mockResolvedValue({
        pk: "mcp-servers/workspace-1/server-1",
        sk: "server",
        authType: "oauth",
        config: tokens,
      });
      mockDb["mcp-server"].update.mockResolvedValue(undefined);

      const result = await ensureValidToken(
        "workspace-1",
        "server-1",
        tokens,
        refreshTokenFn
      );

      expect(result).toBe("new-access-token");
      expect(refreshTokenFn).toHaveBeenCalledWith("refresh-token");
      expect(mockDb["mcp-server"].update).toHaveBeenCalled();
    });

    it("should throw error if token refresh fails", async () => {
      const tokens: OAuthTokens = {
        accessToken: "expired-token",
        refreshToken: "refresh-token",
        expiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
      };

      const refreshTokenFn = vi
        .fn()
        .mockRejectedValue(new Error("Refresh failed"));

      await expect(
        ensureValidToken("workspace-1", "server-1", tokens, refreshTokenFn)
      ).rejects.toThrow("Failed to refresh token");
    });
  });
});
