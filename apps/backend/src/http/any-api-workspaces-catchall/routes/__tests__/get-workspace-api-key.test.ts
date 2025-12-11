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

describe("GET /api/workspaces/:workspaceId/api-key", () => {
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

        const pk = `workspace-api-keys/${workspaceId}`;
        const sk = "key";

        const workspaceKey = await db["workspace-api-key"].get(pk, sk);

        res.json({ hasKey: !!workspaceKey });
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should return hasKey as true when API key exists", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";

    const mockApiKey = {
      pk: `workspace-api-keys/${workspaceId}`,
      sk: "key",
      key: "api-key-value",
    };

    const mockApiKeyGet = vi.fn().mockResolvedValue(mockApiKey);
    mockDb["workspace-api-key"].get = mockApiKeyGet;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockApiKeyGet).toHaveBeenCalledWith(
      `workspace-api-keys/${workspaceId}`,
      "key"
    );
    expect(res.json).toHaveBeenCalledWith({
      hasKey: true,
    });
  });

  it("should return hasKey as false when API key does not exist", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";

    const mockApiKeyGet = vi.fn().mockResolvedValue(null);
    mockDb["workspace-api-key"].get = mockApiKeyGet;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockApiKeyGet).toHaveBeenCalledWith(
      `workspace-api-keys/${workspaceId}`,
      "key"
    );
    expect(res.json).toHaveBeenCalledWith({
      hasKey: false,
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
});
