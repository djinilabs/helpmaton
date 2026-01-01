import { unauthorized } from "@hapi/boom";
import express from "express";
import { EncryptJWT } from "jose";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  getJwtSecret,
  extractWorkspaceContextFromToken,
} from "../jwtUtils";

describe("jwtUtils", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      AUTH_SECRET: "test-secret-key-for-jwt-encryption",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe("getJwtSecret", () => {
    it("should derive 256-bit key from AUTH_SECRET", () => {
      const secret = getJwtSecret();
      expect(secret).toBeInstanceOf(Uint8Array);
      expect(secret.length).toBe(32); // 256 bits = 32 bytes
    });

    it("should throw error if AUTH_SECRET is not set", () => {
      delete process.env.AUTH_SECRET;
      expect(() => getJwtSecret()).toThrow("AUTH_SECRET is required");
    });

    it("should produce consistent keys for same secret", () => {
      const secret1 = getJwtSecret();
      const secret2 = getJwtSecret();
      expect(secret1).toEqual(secret2);
    });
  });

  describe("extractWorkspaceContextFromToken", () => {
    it("should extract workspace context from valid encrypted JWT", async () => {
      const secret = getJwtSecret();
      const now = Math.floor(Date.now() / 1000);

      const encryptedToken = await new EncryptJWT({
        workspaceId: "workspace-123",
        agentId: "agent-456",
        conversationId: "conversation-789",
      })
        .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
        .setIssuedAt(now)
        .setExpirationTime(now + 1800)
        .setIssuer("helpmaton")
        .setAudience("helpmaton-api")
        .encrypt(secret);

      const req = {
        headers: {
          authorization: `Bearer ${encryptedToken}`,
        },
      } as unknown as express.Request;

      const result = await extractWorkspaceContextFromToken(req);
      expect(result).toEqual({
        workspaceId: "workspace-123",
        agentId: "agent-456",
        conversationId: "conversation-789",
      });
    });

    it("should throw error if Authorization header is missing", async () => {
      const req = {
        headers: {},
      } as unknown as express.Request;

      await expect(extractWorkspaceContextFromToken(req)).rejects.toThrow(
        unauthorized("Authorization header with Bearer token is required")
      );
    });

    it("should throw error if Authorization header format is invalid", async () => {
      const req = {
        headers: {
          authorization: "InvalidFormat token",
        },
      } as unknown as express.Request;

      await expect(extractWorkspaceContextFromToken(req)).rejects.toThrow(
        unauthorized("Invalid Authorization header format. Expected: Bearer <token>")
      );
    });

    it("should throw error if token payload is missing required fields", async () => {
      const secret = getJwtSecret();
      const now = Math.floor(Date.now() / 1000);

      const encryptedToken = await new EncryptJWT({
        workspaceId: "workspace-123",
        // Missing agentId and conversationId
      })
        .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
        .setIssuedAt(now)
        .setExpirationTime(now + 1800)
        .setIssuer("helpmaton")
        .setAudience("helpmaton-api")
        .encrypt(secret);

      const req = {
        headers: {
          authorization: `Bearer ${encryptedToken}`,
        },
      } as unknown as express.Request;

      await expect(extractWorkspaceContextFromToken(req)).rejects.toThrow(
        unauthorized(
          "Token payload must contain workspaceId, agentId, and conversationId as strings"
        )
      );
    });

    it("should throw error if token is invalid or expired", async () => {
      const req = {
        headers: {
          authorization: "Bearer invalid-token",
        },
      } as unknown as express.Request;

      await expect(extractWorkspaceContextFromToken(req)).rejects.toThrow(
        unauthorized("Invalid or expired encrypted token")
      );
    });

    it("should handle case-insensitive Authorization header", async () => {
      const secret = getJwtSecret();
      const now = Math.floor(Date.now() / 1000);

      const encryptedToken = await new EncryptJWT({
        workspaceId: "workspace-123",
        agentId: "agent-456",
        conversationId: "conversation-789",
      })
        .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
        .setIssuedAt(now)
        .setExpirationTime(now + 1800)
        .setIssuer("helpmaton")
        .setAudience("helpmaton-api")
        .encrypt(secret);

      const req = {
        headers: {
          Authorization: `Bearer ${encryptedToken}`, // Capital A
        },
      } as unknown as express.Request;

      const result = await extractWorkspaceContextFromToken(req);
      expect(result).toEqual({
        workspaceId: "workspace-123",
        agentId: "agent-456",
        conversationId: "conversation-789",
      });
    });
  });
});

