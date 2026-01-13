import { describe, it, expect } from "vitest";

import {
  generateMcpOAuthStateToken,
  validateAndExtractMcpOAuthStateToken,
} from "../common";

describe("MCP OAuth Common Utilities", () => {
  describe("generateMcpOAuthStateToken", () => {
    it("should generate a valid state token", () => {
      const workspaceId = "workspace-123";
      const serverId = "server-456";
      const token = generateMcpOAuthStateToken(workspaceId, serverId);

      expect(token).toBeDefined();
      expect(typeof token).toBe("string");
      expect(token.length).toBeGreaterThan(0);
    });

    it("should generate different tokens for different inputs", () => {
      const token1 = generateMcpOAuthStateToken("workspace-1", "server-1");
      const token2 = generateMcpOAuthStateToken("workspace-2", "server-2");

      expect(token1).not.toBe(token2);
    });
  });

  describe("validateAndExtractMcpOAuthStateToken", () => {
    it("should validate and extract valid state token", () => {
      const workspaceId = "workspace-123";
      const serverId = "server-456";
      const token = generateMcpOAuthStateToken(workspaceId, serverId);

      const result = validateAndExtractMcpOAuthStateToken(token);

      expect(result).not.toBeNull();
      expect(result?.workspaceId).toBe(workspaceId);
      expect(result?.serverId).toBe(serverId);
    });

    it("should return null for invalid token", () => {
      const result = validateAndExtractMcpOAuthStateToken("invalid-token");

      expect(result).toBeNull();
    });

    it("should return null for expired token", () => {
      // Create an old token by manipulating the timestamp
      const oldPayload = {
        workspaceId: "workspace-123",
        serverId: "server-456",
        timestamp: (Date.now() - 2 * 60 * 60 * 1000).toString(36), // 2 hours ago
        random: "test",
      };
      const oldToken = Buffer.from(JSON.stringify(oldPayload)).toString(
        "base64url"
      );

      const result = validateAndExtractMcpOAuthStateToken(oldToken);

      expect(result).toBeNull();
    });
  });
});
