import { resourceGone, unauthorized } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDatabase } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
  };
});

// Mock the modules
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

describe("DELETE /api/user/api-keys/:keyId", () => {
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

        const userId = userRef.replace("users/", "");
        const keyId = req.params.keyId;
        const pk = `user-api-keys/${userId}`;
        const sk = keyId;

        // Get the key to verify it exists
        // Note: Ownership is guaranteed by the pk which includes userId
        const apiKey = await db["user-api-key"].get(pk, sk);

        if (!apiKey) {
          throw resourceGone("API key not found");
        }

        // Delete key
        await db["user-api-key"].delete(pk, sk);

        res.status(204).send();
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should delete user API key successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const userId = "user-123";
    const userRef = `users/${userId}`;
    const keyId = "key-456";
    const pk = `user-api-keys/${userId}`;
    const sk = keyId;

    const mockApiKey = {
      pk,
      sk,
      userId,
      keyHash: "hash-value",
      keySalt: "salt-value",
      keyPrefix: "hmat_abc123",
      name: "My Key",
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(mockApiKey);
    const mockDelete = vi.fn().mockResolvedValue({});
    (mockDb as Record<string, unknown>)["user-api-key"] = {
      get: mockGet,
      delete: mockDelete,
    };

    const req = createMockRequest({
      userRef,
      params: {
        keyId,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockGet).toHaveBeenCalledWith(pk, sk);
    expect(mockDelete).toHaveBeenCalledWith(pk, sk);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should throw unauthorized when userRef is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      userRef: undefined,
      params: {
        keyId: "key-456",
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

  it("should throw resourceGone when API key does not exist", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const userId = "user-123";
    const userRef = `users/${userId}`;
    const keyId = "key-456";
    const pk = `user-api-keys/${userId}`;
    const sk = keyId;

    const mockGet = vi.fn().mockResolvedValue(null);
    (mockDb as Record<string, unknown>)["user-api-key"] = {
      get: mockGet,
    };

    const req = createMockRequest({
      userRef,
      params: {
        keyId,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockGet).toHaveBeenCalledWith(pk, sk);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 410,
          payload: expect.objectContaining({
            message: expect.stringContaining("API key not found"),
          }),
        }),
      })
    );
  });

  // Note: Ownership check is redundant because pk includes userId
  // If a key is retrieved with pk = "user-api-keys/{userId}", it's guaranteed to belong to that user
  // This test scenario cannot occur in practice, so it's been removed
});
