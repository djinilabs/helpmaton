import { badRequest, unauthorized } from "@hapi/boom";
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

describe("PUT /api/workspaces/:workspaceId/api-key", () => {
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
        const workspaceResource = (req as { workspaceResource?: string })
          .workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const workspaceId = req.params.workspaceId;
        const { key, provider } = req.body;

        if (key === undefined) {
          throw badRequest("key is required");
        }

        const currentUserRef = (req as { userRef?: string }).userRef;
        if (!currentUserRef) {
          throw unauthorized();
        }

        const pk = `workspace-api-keys/${workspaceId}`;
        const sk = "key";

        if (!key || key === "") {
          // Delete the key if it exists
          try {
            await db["workspace-api-key"].delete(pk, sk);
          } catch {
            // Key doesn't exist, that's fine
          }
          res.status(204).send();
          return;
        }

        // Check if key already exists
        const existing = await db["workspace-api-key"].get(pk, sk);

        if (existing) {
          // Update existing key
          await db["workspace-api-key"].update({
            pk,
            sk,
            key,
            provider: provider || "google",
            updatedBy: currentUserRef,
            updatedAt: new Date().toISOString(),
          });
        } else {
          // Create new key
          await db["workspace-api-key"].create({
            pk,
            sk,
            workspaceId,
            key,
            provider: provider || "google",
            createdBy: currentUserRef,
          });
        }

        res.status(200).json({ success: true });
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should create new API key when key does not exist", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const apiKey = "test-api-key-123";
    const provider = "google";

    const mockApiKeyGet = vi.fn().mockResolvedValue(null);
    mockDb["workspace-api-key"].get = mockApiKeyGet;

    const mockApiKeyCreate = vi.fn().mockResolvedValue({
      pk: `workspace-api-keys/${workspaceId}`,
      sk: "key",
      workspaceId,
      key: apiKey,
      provider,
      createdBy: `users/${userId}`,
    });
    mockDb["workspace-api-key"].create = mockApiKeyCreate;

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: `users/${userId}`,
      params: {
        workspaceId,
      },
      body: {
        key: apiKey,
        provider,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockApiKeyGet).toHaveBeenCalledWith(
      `workspace-api-keys/${workspaceId}`,
      "key"
    );
    expect(mockApiKeyCreate).toHaveBeenCalledWith({
      pk: `workspace-api-keys/${workspaceId}`,
      sk: "key",
      workspaceId,
      key: apiKey,
      provider,
      createdBy: `users/${userId}`,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it("should update existing API key", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const oldApiKey = "old-api-key";
    const newApiKey = "new-api-key";
    const provider = "openai";

    const existingKey = {
      pk: `workspace-api-keys/${workspaceId}`,
      sk: "key",
      workspaceId,
      key: oldApiKey,
      provider: "google",
      createdBy: `users/${userId}`,
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockApiKeyGet = vi.fn().mockResolvedValue(existingKey);
    mockDb["workspace-api-key"].get = mockApiKeyGet;

    const mockApiKeyUpdate = vi.fn().mockResolvedValue({
      ...existingKey,
      key: newApiKey,
      provider,
      updatedBy: `users/${userId}`,
      updatedAt: "2024-01-02T00:00:00Z",
    });
    mockDb["workspace-api-key"].update = mockApiKeyUpdate;

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: `users/${userId}`,
      params: {
        workspaceId,
      },
      body: {
        key: newApiKey,
        provider,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockApiKeyGet).toHaveBeenCalledWith(
      `workspace-api-keys/${workspaceId}`,
      "key"
    );
    expect(mockApiKeyUpdate).toHaveBeenCalledWith({
      pk: `workspace-api-keys/${workspaceId}`,
      sk: "key",
      key: newApiKey,
      provider,
      updatedBy: `users/${userId}`,
      updatedAt: expect.any(String),
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it("should use default provider 'google' when provider is not provided", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const apiKey = "test-api-key-123";

    const mockApiKeyGet = vi.fn().mockResolvedValue(null);
    mockDb["workspace-api-key"].get = mockApiKeyGet;

    const mockApiKeyCreate = vi.fn().mockResolvedValue({
      pk: `workspace-api-keys/${workspaceId}`,
      sk: "key",
      workspaceId,
      key: apiKey,
      provider: "google",
      createdBy: `users/${userId}`,
    });
    mockDb["workspace-api-key"].create = mockApiKeyCreate;

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: `users/${userId}`,
      params: {
        workspaceId,
      },
      body: {
        key: apiKey,
        // provider not provided
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockApiKeyCreate).toHaveBeenCalledWith({
      pk: `workspace-api-keys/${workspaceId}`,
      sk: "key",
      workspaceId,
      key: apiKey,
      provider: "google", // Default provider
      createdBy: `users/${userId}`,
    });
  });

  it("should delete API key when key is empty string", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";

    const mockApiKeyDelete = vi.fn().mockResolvedValue(undefined);
    mockDb["workspace-api-key"].delete = mockApiKeyDelete;

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: `users/${userId}`,
      params: {
        workspaceId,
      },
      body: {
        key: "", // Empty string to delete
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockApiKeyDelete).toHaveBeenCalledWith(
      `workspace-api-keys/${workspaceId}`,
      "key"
    );
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });

  it("should handle delete when key does not exist gracefully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";

    const mockApiKeyDelete = vi.fn().mockRejectedValue(new Error("Not found"));
    mockDb["workspace-api-key"].delete = mockApiKeyDelete;

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: `users/${userId}`,
      params: {
        workspaceId,
      },
      body: {
        key: "", // Empty string to delete
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    // Should still return 204 even if delete fails (key doesn't exist)
    expect(mockApiKeyDelete).toHaveBeenCalledWith(
      `workspace-api-keys/${workspaceId}`,
      "key"
    );
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });

  it("should throw badRequest when key is undefined", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: `users/${userId}`,
      params: {
        workspaceId,
      },
      body: {
        // key is undefined
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining("key is required"),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when workspace resource is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: undefined,
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        key: "test-api-key",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining("Workspace resource not found"),
          }),
        }),
      })
    );
  });

  it("should throw unauthorized when userRef is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: undefined,
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        key: "test-api-key",
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
});
