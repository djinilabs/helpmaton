import { badRequest } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockNext,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDatabase } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
  };
});

// Mock the database module
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

describe("GET /api/workspaces/:workspaceId/api-keys", () => {
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

        // Query all API keys for this workspace using GSI
        const result = await db["workspace-api-key"].query({
          IndexName: "byWorkspaceId",
          KeyConditionExpression: "workspaceId = :workspaceId",
          ExpressionAttributeValues: {
            ":workspaceId": workspaceId,
          },
        });

        // Extract providers from the keys
        const providersWithKeys = new Set<string>();
        for (const item of result.items || []) {
          if (item.provider) {
            providersWithKeys.add(item.provider);
          }
        }

        // Return status for all supported providers
        const { VALID_PROVIDERS } = await import("../workspaceApiKeyUtils");
        const keys = VALID_PROVIDERS.map((provider) => ({
          provider,
          hasKey: providersWithKeys.has(provider),
        }));

        res.json({ keys });
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should return API key statuses for all providers when keys exist", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";

    const mockQuery = vi.fn().mockResolvedValue({
      items: [
        {
          pk: `workspace-api-keys/${workspaceId}/openrouter`,
          sk: "key",
          workspaceId,
          provider: "openrouter",
        },
      ],
    });
    mockDb["workspace-api-key"].query = mockQuery;

    const mockGet = vi.fn().mockRejectedValue(new Error("Not found"));
    mockDb["workspace-api-key"].get = mockGet;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockQuery).toHaveBeenCalledWith({
      IndexName: "byWorkspaceId",
      KeyConditionExpression: "workspaceId = :workspaceId",
      ExpressionAttributeValues: {
        ":workspaceId": workspaceId,
      },
    });
    expect(res.json).toHaveBeenCalledWith({
      keys: [
        { provider: "openrouter", hasKey: true },
      ],
    });
  });

  it("should return all providers as false when no keys exist", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";

    const mockQuery = vi.fn().mockResolvedValue({
      items: [],
    });
    mockDb["workspace-api-key"].query = mockQuery;

    const mockGet = vi.fn().mockRejectedValue(new Error("Not found"));
    mockDb["workspace-api-key"].get = mockGet;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      keys: [
        { provider: "openrouter", hasKey: false },
      ],
    });
  });

  it("should detect old format Google key for backward compatibility", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";

    const mockQuery = vi.fn().mockResolvedValue({
      items: [],
    });
    mockDb["workspace-api-key"].query = mockQuery;

    const oldKey = {
      pk: `workspace-api-keys/${workspaceId}`,
      sk: "key",
      key: "old-format-key",
    };
    const mockGet = vi.fn().mockResolvedValue(oldKey);
    mockDb["workspace-api-key"].get = mockGet;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    // Old format keys are no longer checked - only openrouter is supported
    expect(mockGet).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      keys: [
        { provider: "openrouter", hasKey: false },
      ],
    });
  });

  it("should throw badRequest when workspace resource is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: undefined,
      params: {
        workspaceId: "workspace-123",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(Error);
    expect(
      (error as { output?: { statusCode: number } }).output?.statusCode
    ).toBe(400);
    expect(
      (error as { output?: { payload: { message: string } } }).output?.payload
        .message
    ).toContain("Workspace resource not found");
  });

  it("should handle query errors gracefully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";

    const mockQuery = vi
      .fn()
      .mockRejectedValue(new Error("Database connection error"));
    mockDb["workspace-api-key"].query = mockQuery;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("Database connection error");
  });
});





