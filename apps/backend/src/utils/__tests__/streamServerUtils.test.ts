import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDatabase } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
  };
});

// Mock the database module
vi.mock("../../tables", () => ({
  database: mockDatabase,
}));

import type { AgentStreamServerRecord } from "../../tables/schema";
import {
  generateSecret,
  validateSecret,
  getAllowedOrigins,
  getStreamServerConfig,
  createStreamServerConfig,
  updateStreamServerConfig,
  deleteStreamServerConfig,
} from "../streamServerUtils";

describe("streamServerUtils", () => {
  const mockDb = {
    "agent-stream-servers": {
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabase.mockResolvedValue(mockDb as never);
  });

  describe("generateSecret", () => {
    it("should generate a base64-encoded secret", () => {
      const secret = generateSecret();

      expect(secret).toBeDefined();
      expect(typeof secret).toBe("string");
      // Base64 encoding of 32 bytes = 44 characters (with padding)
      expect(secret.length).toBe(44);
      // Should be valid base64
      expect(() => Buffer.from(secret, "base64")).not.toThrow();
    });

    it("should generate unique secrets on each call", () => {
      const secret1 = generateSecret();
      const secret2 = generateSecret();

      expect(secret1).not.toBe(secret2);
    });

    it("should generate secrets with sufficient entropy", () => {
      const secrets = new Set();
      // Generate 100 secrets and check they're all unique
      for (let i = 0; i < 100; i++) {
        secrets.add(generateSecret());
      }

      expect(secrets.size).toBe(100);
    });

    it("should generate secrets that decode to 32 bytes", () => {
      const secret = generateSecret();
      const decoded = Buffer.from(secret, "base64");

      expect(decoded.length).toBe(32);
    });
  });

  describe("validateSecret", () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const validSecret = "valid-secret-123";

    it("should return true for valid secret", async () => {
      const mockConfig: AgentStreamServerRecord = {
        pk: `stream-servers/${workspaceId}/${agentId}`,
        sk: "config",
        workspaceId,
        agentId,
        secret: validSecret,
        allowedOrigins: ["*"],
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockDb["agent-stream-servers"].get.mockResolvedValue(mockConfig);

      const result = await validateSecret(workspaceId, agentId, validSecret);

      expect(result).toBe(true);
      expect(mockDb["agent-stream-servers"].get).toHaveBeenCalledWith(
        `stream-servers/${workspaceId}/${agentId}`,
        "config"
      );
    });

    it("should return false for invalid secret", async () => {
      const mockConfig: AgentStreamServerRecord = {
        pk: `stream-servers/${workspaceId}/${agentId}`,
        sk: "config",
        workspaceId,
        agentId,
        secret: validSecret,
        allowedOrigins: ["*"],
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockDb["agent-stream-servers"].get.mockResolvedValue(mockConfig);

      const result = await validateSecret(
        workspaceId,
        agentId,
        "wrong-secret"
      );

      expect(result).toBe(false);
    });

    it("should return false when config does not exist", async () => {
      mockDb["agent-stream-servers"].get.mockResolvedValue(null);

      const result = await validateSecret(workspaceId, agentId, validSecret);

      expect(result).toBe(false);
    });

    it("should return false when config is undefined", async () => {
      mockDb["agent-stream-servers"].get.mockResolvedValue(undefined);

      const result = await validateSecret(workspaceId, agentId, validSecret);

      expect(result).toBe(false);
    });
  });

  describe("getAllowedOrigins", () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    it("should return allowed origins when config exists", async () => {
      const allowedOrigins = ["https://example.com", "https://app.example.com"];
      const mockConfig: AgentStreamServerRecord = {
        pk: `stream-servers/${workspaceId}/${agentId}`,
        sk: "config",
        workspaceId,
        agentId,
        secret: "secret-123",
        allowedOrigins,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockDb["agent-stream-servers"].get.mockResolvedValue(mockConfig);

      const result = await getAllowedOrigins(workspaceId, agentId);

      expect(result).toEqual(allowedOrigins);
    });

    it("should return null when config does not exist", async () => {
      mockDb["agent-stream-servers"].get.mockResolvedValue(null);

      const result = await getAllowedOrigins(workspaceId, agentId);

      expect(result).toBeNull();
    });

    it("should handle wildcard origin", async () => {
      const mockConfig: AgentStreamServerRecord = {
        pk: `stream-servers/${workspaceId}/${agentId}`,
        sk: "config",
        workspaceId,
        agentId,
        secret: "secret-123",
        allowedOrigins: ["*"],
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockDb["agent-stream-servers"].get.mockResolvedValue(mockConfig);

      const result = await getAllowedOrigins(workspaceId, agentId);

      expect(result).toEqual(["*"]);
    });
  });

  describe("getStreamServerConfig", () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    it("should return config when it exists", async () => {
      const mockConfig: AgentStreamServerRecord = {
        pk: `stream-servers/${workspaceId}/${agentId}`,
        sk: "config",
        workspaceId,
        agentId,
        secret: "secret-123",
        allowedOrigins: ["*"],
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockDb["agent-stream-servers"].get.mockResolvedValue(mockConfig);

      const result = await getStreamServerConfig(workspaceId, agentId);

      expect(result).toEqual(mockConfig);
    });

    it("should return null when config does not exist", async () => {
      mockDb["agent-stream-servers"].get.mockResolvedValue(null);

      const result = await getStreamServerConfig(workspaceId, agentId);

      expect(result).toBeNull();
    });
  });

  describe("createStreamServerConfig", () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const allowedOrigins = ["https://example.com"];

    it("should create a new stream server config with generated secret", async () => {
      const createdConfig: AgentStreamServerRecord = {
        pk: `stream-servers/${workspaceId}/${agentId}`,
        sk: "config",
        workspaceId,
        agentId,
        secret: "generated-secret-123",
        allowedOrigins,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockDb["agent-stream-servers"].create.mockResolvedValue(createdConfig);

      const result = await createStreamServerConfig(
        workspaceId,
        agentId,
        allowedOrigins
      );

      expect(result).toBeDefined();
      expect(result.workspaceId).toBe(workspaceId);
      expect(result.agentId).toBe(agentId);
      expect(result.allowedOrigins).toEqual(allowedOrigins);
      expect(result.secret).toBeDefined();
      expect(typeof result.secret).toBe("string");
      expect(mockDb["agent-stream-servers"].create).toHaveBeenCalledWith(
        expect.objectContaining({
          pk: `stream-servers/${workspaceId}/${agentId}`,
          sk: "config",
          workspaceId,
          agentId,
          allowedOrigins,
        })
      );
      // Verify that a secret was generated (should be base64, 44 chars)
      const createCall = mockDb["agent-stream-servers"].create.mock
        .calls[0][0] as AgentStreamServerRecord;
      expect(createCall.secret).toBeDefined();
      expect(createCall.secret.length).toBe(44);
    });

    it("should handle wildcard origins", async () => {
      const createdConfig: AgentStreamServerRecord = {
        pk: `stream-servers/${workspaceId}/${agentId}`,
        sk: "config",
        workspaceId,
        agentId,
        secret: "generated-secret-123",
        allowedOrigins: ["*"],
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockDb["agent-stream-servers"].create.mockResolvedValue(createdConfig);

      const result = await createStreamServerConfig(workspaceId, agentId, [
        "*",
      ]);

      expect(result.allowedOrigins).toEqual(["*"]);
    });

    it("should handle multiple origins", async () => {
      const multipleOrigins = [
        "https://example.com",
        "https://app.example.com",
        "https://staging.example.com",
      ];
      const createdConfig: AgentStreamServerRecord = {
        pk: `stream-servers/${workspaceId}/${agentId}`,
        sk: "config",
        workspaceId,
        agentId,
        secret: "generated-secret-123",
        allowedOrigins: multipleOrigins,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockDb["agent-stream-servers"].create.mockResolvedValue(createdConfig);

      const result = await createStreamServerConfig(
        workspaceId,
        agentId,
        multipleOrigins
      );

      expect(result.allowedOrigins).toEqual(multipleOrigins);
    });
  });

  describe("updateStreamServerConfig", () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const newAllowedOrigins = ["https://new-example.com"];

    it("should update allowed origins", async () => {
      const updatedConfig: AgentStreamServerRecord = {
        pk: `stream-servers/${workspaceId}/${agentId}`,
        sk: "config",
        workspaceId,
        agentId,
        secret: "existing-secret-123",
        allowedOrigins: newAllowedOrigins,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockDb["agent-stream-servers"].update.mockResolvedValue(updatedConfig);

      const result = await updateStreamServerConfig(
        workspaceId,
        agentId,
        newAllowedOrigins
      );

      expect(result).toEqual(updatedConfig);
      expect(result.allowedOrigins).toEqual(newAllowedOrigins);
      expect(mockDb["agent-stream-servers"].update).toHaveBeenCalledWith({
        pk: `stream-servers/${workspaceId}/${agentId}`,
        sk: "config",
        allowedOrigins: newAllowedOrigins,
      });
    });
  });

  describe("deleteStreamServerConfig", () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    it("should delete stream server config", async () => {
      mockDb["agent-stream-servers"].delete.mockResolvedValue(undefined);

      await deleteStreamServerConfig(workspaceId, agentId);

      expect(mockDb["agent-stream-servers"].delete).toHaveBeenCalledWith(
        `stream-servers/${workspaceId}/${agentId}`,
        "config"
      );
    });
  });
});

