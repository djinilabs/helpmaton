import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// eslint-disable-next-line import/order
import {
  createMockDatabase,
  createMockNext,
  createMockRequest,
  createMockResponse,
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

// Mock middleware to pass through
vi.mock("../middleware", () => ({
  requireAuth: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => {
    next();
  },
  requirePermission:
    () =>
    (
      _req: express.Request,
      _res: express.Response,
      next: express.NextFunction
    ) => {
      next();
    },
  handleError: (error: unknown, next: express.NextFunction) => {
    next(error);
  },
}));

// Import the actual route handler after mocks are set up
import { registerGetWorkspaceApiKey } from "../get-workspace-api-key";

import { createTestAppWithHandlerCapture } from "./route-test-helpers";

describe("GET /api/workspaces/:workspaceId/api-key", () => {
  let testApp: ReturnType<typeof createTestAppWithHandlerCapture>;

  beforeEach(() => {
    vi.clearAllMocks();
    testApp = createTestAppWithHandlerCapture();

    // Register the actual route handler
    registerGetWorkspaceApiKey(testApp.app);
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>,
    next: express.NextFunction
  ) {
    // Get the actual route handler that was registered
    const routeHandler = testApp.getHandler(
      "/api/workspaces/:workspaceId/api-key"
    );
    if (!routeHandler) {
      throw new Error(
        "Route handler not found - route may not be registered correctly"
      );
    }

    await routeHandler(req as express.Request, res as express.Response, next);
  }

  it("should return hasKey as true when API key exists", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";

    const provider = "google";
    const mockApiKey = {
      pk: `workspace-api-keys/${workspaceId}/${provider}`,
      sk: "key",
      key: "api-key-value",
      provider,
    };

    const mockApiKeyGet = vi.fn().mockResolvedValue(mockApiKey);
    mockDb["workspace-api-key"].get = mockApiKeyGet;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
      },
      query: {
        provider,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockApiKeyGet).toHaveBeenCalledWith(
      `workspace-api-keys/${workspaceId}/${provider}`,
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
    const provider = "google";

    const mockApiKeyGet = vi.fn().mockRejectedValue(new Error("Not found"));
    mockDb["workspace-api-key"].get = mockApiKeyGet;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
      },
      query: {
        provider,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockApiKeyGet).toHaveBeenCalledWith(
      `workspace-api-keys/${workspaceId}/${provider}`,
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
      query: {
        provider: "google",
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
