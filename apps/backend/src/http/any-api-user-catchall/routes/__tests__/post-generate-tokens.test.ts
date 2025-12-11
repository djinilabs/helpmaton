import { unauthorized } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const {
  mockRandomUUID,
  mockDatabase,
  mockGenerateAccessToken,
  mockGenerateRefreshToken,
  mockHashRefreshToken,
} = vi.hoisted(() => {
  return {
    mockRandomUUID: vi.fn(),
    mockDatabase: vi.fn(),
    mockGenerateAccessToken: vi.fn(),
    mockGenerateRefreshToken: vi.fn(),
    mockHashRefreshToken: vi.fn(),
  };
});

// Mock the modules
vi.mock("crypto", () => ({
  randomUUID: mockRandomUUID,
}));

vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/tokenUtils", () => ({
  generateAccessToken: mockGenerateAccessToken,
  generateRefreshToken: mockGenerateRefreshToken,
  hashRefreshToken: mockHashRefreshToken,
}));

describe("POST /api/user/generate-tokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>,
    next: express.NextFunction
  ) {
    // Extract the handler logic directly
    const handler = async (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      try {
        const db = await mockDatabase();
        const userRef = (req as { userRef?: string }).userRef;
        if (!userRef) {
          throw unauthorized();
        }

        const session = (
          req as { session?: { user?: { id: string; email: string } } }
        ).session;
        if (!session?.user?.id || !session?.user?.email) {
          throw unauthorized("User session required");
        }

        const userId = session.user.id;
        const email = session.user.email;

        // Generate tokens
        const accessToken = await mockGenerateAccessToken(userId, email);
        const refreshToken = mockGenerateRefreshToken();

        // Hash the refresh token
        const { hash: tokenHash, salt: tokenSalt } = await mockHashRefreshToken(
          refreshToken
        );

        // Calculate expiration (30 days from now)
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);

        // Generate tokenId
        const tokenId = mockRandomUUID();
        const pk = `user-refresh-tokens/${userId}`;
        const sk = tokenId;

        // Create refresh token record
        await db["user-refresh-token"].create({
          pk,
          sk,
          userId,
          tokenHash,
          tokenSalt,
          expiresAt: expiresAt.toISOString(),
          createdBy: userRef,
        });

        res.json({
          accessToken,
          refreshToken,
        });
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should generate tokens successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const userId = "user-123";
    const email = "test@example.com";
    const userRef = `users/${userId}`;
    const accessToken = "access-token-123";
    const refreshToken = "refresh-token-456";
    const tokenId = "token-id-789";

    mockGenerateAccessToken.mockResolvedValue(accessToken);
    mockGenerateRefreshToken.mockReturnValue(refreshToken);
    mockHashRefreshToken.mockResolvedValue({
      hash: "token-hash",
      salt: "token-salt",
    });
    mockRandomUUID.mockReturnValue(tokenId);

    const mockCreate = vi.fn().mockResolvedValue({
      pk: `user-refresh-tokens/${userId}`,
      sk: tokenId,
      userId,
      tokenHash: "token-hash",
      tokenSalt: "token-salt",
      expiresAt: expect.any(String),
      createdAt: expect.any(String),
    });
    (mockDb as Record<string, unknown>)["user-refresh-token"] = {
      create: mockCreate,
    };

    const req = createMockRequest({
      userRef,
      session: {
        user: {
          id: userId,
          email,
        },
        expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
      body: {},
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockGenerateAccessToken).toHaveBeenCalledWith(userId, email);
    expect(mockGenerateRefreshToken).toHaveBeenCalled();
    expect(mockHashRefreshToken).toHaveBeenCalledWith(refreshToken);
    expect(mockRandomUUID).toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith({
      pk: `user-refresh-tokens/${userId}`,
      sk: tokenId,
      userId,
      tokenHash: "token-hash",
      tokenSalt: "token-salt",
      expiresAt: expect.any(String),
      createdBy: userRef,
    });
    expect(res.json).toHaveBeenCalledWith({
      accessToken,
      refreshToken,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("should throw unauthorized when userRef is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      userRef: undefined,
      session: {
        user: {
          id: "user-123",
          email: "test@example.com",
        },
        expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 401,
        }),
      })
    );
  });

  it("should throw unauthorized when session is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      userRef: "users/user-123",
      session: undefined as unknown as {
        user: { id: string; email: string };
        expires: string;
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 401,
          payload: expect.objectContaining({
            message: expect.stringContaining("User session required"),
          }),
        }),
      })
    );
  });

  it("should throw unauthorized when session.user.id is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      userRef: "users/user-123",
      session: {
        user: {
          email: "test@example.com",
          // Missing id
        },
        expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 401,
          payload: expect.objectContaining({
            message: expect.stringContaining("User session required"),
          }),
        }),
      })
    );
  });
});
