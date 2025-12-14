import { unauthorized } from "@hapi/boom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  generateAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  validateRefreshToken,
  verifyAccessToken,
} from "../tokenUtils";

// Mock jose using vi.hoisted
const { mockSignJWT, mockJwtVerify } = vi.hoisted(() => {
  const signJWT = vi.fn();
  const jwtVerify = vi.fn();
  return {
    mockSignJWT: signJWT,
    mockJwtVerify: jwtVerify,
  };
});

vi.mock("jose", () => {
  const mockSignJWTImpl = mockSignJWT;
  const mockJwtVerifyImpl = mockJwtVerify;
  return {
    SignJWT: class {
      setProtectedHeader = vi.fn().mockReturnThis();
      setIssuedAt = vi.fn().mockReturnThis();
      setExpirationTime = vi.fn().mockReturnThis();
      setIssuer = vi.fn().mockReturnThis();
      setAudience = vi.fn().mockReturnThis();
      sign = mockSignJWTImpl;
    },
    jwtVerify: mockJwtVerifyImpl,
  };
});

// Mock crypto - use vi.hoisted to ensure it's available
const { mockRandomBytes } = vi.hoisted(() => {
  return {
    mockRandomBytes: vi.fn(),
  };
});

vi.mock("crypto", async () => {
  const actual = await vi.importActual<typeof import("crypto")>("crypto");
  return {
    ...actual,
    randomBytes: mockRandomBytes,
  };
});

// Mock environment
const originalEnv = process.env;

describe("tokenUtils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      AUTH_SECRET: "test-secret-key-for-jwt-signing",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("generateAccessToken", () => {
    it("should generate a JWT access token", async () => {
      const mockToken = "mock.jwt.token";
      mockSignJWT.mockResolvedValue(mockToken);

      const token = await generateAccessToken("user-123", "test@example.com");

      expect(token).toBe(mockToken);
      expect(mockSignJWT).toHaveBeenCalled();
    });
  });

  describe("verifyAccessToken", () => {
    it("should verify and decode a valid JWT token", async () => {
      const mockPayload = {
        userId: "user-123",
        email: "test@example.com",
      };
      mockJwtVerify.mockResolvedValue({ payload: mockPayload });

      const result = await verifyAccessToken("valid.jwt.token");

      expect(result).toEqual({
        userId: "user-123",
        email: "test@example.com",
      });
      expect(mockJwtVerify).toHaveBeenCalled();
    });

    it("should throw unauthorized for invalid token", async () => {
      mockJwtVerify.mockRejectedValue(new Error("Invalid token"));

      await expect(verifyAccessToken("invalid.token")).rejects.toThrow(
        unauthorized("Invalid or expired access token")
      );
    });

    it("should throw unauthorized for token with missing userId or email", async () => {
      mockJwtVerify.mockResolvedValue({
        payload: { userId: "user-123" }, // Missing email
      });

      await expect(verifyAccessToken("token")).rejects.toThrow(
        unauthorized("Invalid access token: missing required claims")
      );
    });
  });

  describe("generateRefreshToken", () => {
    it("should generate a refresh token with correct prefix", () => {
      const mockBytes = Buffer.from("a".repeat(64), "hex");
      mockRandomBytes.mockReturnValue(mockBytes);

      const token = generateRefreshToken();

      expect(token).toMatch(/^hmat_refresh_/);
      expect(token.length).toBeGreaterThan(14); // prefix + hex chars
      expect(mockRandomBytes).toHaveBeenCalledWith(32);
    });
  });

  describe("hashRefreshToken", () => {
    it("should hash a refresh token and return hash and salt", async () => {
      // We need to mock the scrypt function, but it's complex
      // For now, just verify the function exists and returns the right structure
      const token = "hmat_refresh_test123";
      const result = await hashRefreshToken(token);

      expect(result).toHaveProperty("hash");
      expect(result).toHaveProperty("salt");
      expect(typeof result.hash).toBe("string");
      expect(typeof result.salt).toBe("string");
    });
  });

  describe("validateRefreshToken", () => {
    it("should validate a refresh token against stored hash", async () => {
      const token = "hmat_refresh_test123";
      // Generate actual hash for testing
      const { hash, salt } = await hashRefreshToken(token);

      const isValid = await validateRefreshToken(token, hash, salt);

      expect(isValid).toBe(true);
    });

    it("should return false for invalid token", async () => {
      const token = "hmat_refresh_test123";
      const { hash, salt } = await hashRefreshToken(token);
      const wrongToken = "hmat_refresh_wrong";

      const isValid = await validateRefreshToken(wrongToken, hash, salt);

      expect(isValid).toBe(false);
    });
  });
});
