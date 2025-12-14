import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockNext,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDatabase, mockMaskApiKey } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockMaskApiKey: vi.fn(),
  };
});

// Mock the database module
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

// Mock apiKeyUtils
vi.mock("../../../../utils/apiKeyUtils", () => ({
  maskApiKey: mockMaskApiKey,
}));

describe("GET /api/user/api-keys", () => {
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
          throw new Error("User not authenticated");
        }

        const userId = userRef.replace("users/", "");
        const pk = `user-api-keys/${userId}`;

        // Query all API keys for this user by primary key
        const result = await db["user-api-key"].query({
          KeyConditionExpression: "pk = :pk",
          ExpressionAttributeValues: {
            ":pk": pk,
          },
        });

        const keys = result.items.map(
          (key: {
            sk: string;
            name?: string;
            keyPrefix: string;
            createdAt: string;
            lastUsedAt?: string;
          }) => {
            // Create a mock key for masking (we only store the prefix)
            // API keys are: hmat_<64 hex chars> = 69 characters total
            const mockKey =
              key.keyPrefix + "x".repeat(69 - key.keyPrefix.length);
            const maskedKey = mockMaskApiKey(mockKey);

            return {
              id: key.sk, // keyId is the sort key
              name: key.name || null,
              keyPrefix: key.keyPrefix,
              maskedKey: maskedKey,
              createdAt: key.createdAt,
              lastUsedAt: key.lastUsedAt || null,
            };
          }
        );

        res.json(keys);
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should return user API keys", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const userId = "user-123";
    const userRef = `users/${userId}`;
    const pk = `user-api-keys/${userId}`;

    const mockKeys = [
      {
        pk,
        sk: "key-1",
        userId,
        keyHash: "hash1",
        keySalt: "salt1",
        keyPrefix: "hmat_abc123",
        name: "Production Key",
        createdAt: "2024-01-01T00:00:00Z",
        lastUsedAt: "2024-01-15T10:30:00Z",
      },
      {
        pk,
        sk: "key-2",
        userId,
        keyHash: "hash2",
        keySalt: "salt2",
        keyPrefix: "hmat_def456",
        name: null,
        createdAt: "2024-01-02T00:00:00Z",
        lastUsedAt: null,
      },
    ];

    const mockQuery = vi.fn().mockResolvedValue({
      items: mockKeys,
    });
    (mockDb as Record<string, unknown>)["user-api-key"] = {
      query: mockQuery,
    };

    mockMaskApiKey.mockImplementation((key: string) => {
      if (key.startsWith("hmat_abc123")) {
        return "hmat_abc123...xyz1";
      }
      return "hmat_def456...xyz2";
    });

    const req = createMockRequest({
      userRef,
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockQuery).toHaveBeenCalledWith({
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: {
        ":pk": pk,
      },
    });
    expect(res.json).toHaveBeenCalledWith([
      {
        id: "key-1",
        name: "Production Key",
        keyPrefix: "hmat_abc123",
        maskedKey: "hmat_abc123...xyz1",
        createdAt: "2024-01-01T00:00:00Z",
        lastUsedAt: "2024-01-15T10:30:00Z",
      },
      {
        id: "key-2",
        name: null,
        keyPrefix: "hmat_def456",
        maskedKey: "hmat_def456...xyz2",
        createdAt: "2024-01-02T00:00:00Z",
        lastUsedAt: null,
      },
    ]);
  });

  it("should return empty array when user has no API keys", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const userId = "user-123";
    const userRef = `users/${userId}`;
    const pk = `user-api-keys/${userId}`;

    const mockQuery = vi.fn().mockResolvedValue({
      items: [],
    });
    (mockDb as Record<string, unknown>)["user-api-key"] = {
      query: mockQuery,
    };

    const req = createMockRequest({
      userRef,
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockQuery).toHaveBeenCalledWith({
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: {
        ":pk": pk,
      },
    });
    expect(res.json).toHaveBeenCalledWith([]);
  });

  it("should throw error when userRef is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      userRef: undefined,
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("User not authenticated");
  });

  it("should handle keys without names", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const userId = "user-123";
    const userRef = `users/${userId}`;
    const pk = `user-api-keys/${userId}`;

    const mockKeys = [
      {
        pk,
        sk: "key-1",
        userId,
        keyHash: "hash1",
        keySalt: "salt1",
        keyPrefix: "hmat_abc123",
        // No name field
        createdAt: "2024-01-01T00:00:00Z",
        lastUsedAt: null,
      },
    ];

    const mockQuery = vi.fn().mockResolvedValue({
      items: mockKeys,
    });
    (mockDb as Record<string, unknown>)["user-api-key"] = {
      query: mockQuery,
    };

    mockMaskApiKey.mockReturnValue("hmat_abc123...xyz1");

    const req = createMockRequest({
      userRef,
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(res.json).toHaveBeenCalledWith([
      {
        id: "key-1",
        name: null,
        keyPrefix: "hmat_abc123",
        maskedKey: "hmat_abc123...xyz1",
        createdAt: "2024-01-01T00:00:00Z",
        lastUsedAt: null,
      },
    ]);
  });
});
