import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// eslint-disable-next-line import/order
import {
  createMockDatabase,
  createMockRequest,
  createMockResponse,
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
import { registerDeleteWorkspaceApiKey } from "../delete-workspace-api-key";

import { createTestAppWithHandlerCapture } from "./route-test-helpers";

describe("DELETE /api/workspaces/:workspaceId/api-key", () => {
  let testApp: ReturnType<typeof createTestAppWithHandlerCapture>;

  beforeEach(() => {
    vi.clearAllMocks();
    testApp = createTestAppWithHandlerCapture();

    // Register the actual route handler
    registerDeleteWorkspaceApiKey(testApp.app);
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>,
    next: express.NextFunction
  ) {
    // Get the actual route handler that was registered
    const routeHandler = testApp.deleteHandler(
      "/api/workspaces/:workspaceId/api-key"
    );
    if (!routeHandler) {
      throw new Error(
        "Route handler not found - route may not be registered correctly"
      );
    }

    await routeHandler(req as express.Request, res as express.Response, next);
  }

  it("should delete API key successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const provider = "google";

    const mockApiKeyDelete = vi.fn().mockResolvedValue(undefined);
    mockDb["workspace-api-key"].delete = mockApiKeyDelete;

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      params: {
        workspaceId,
      },
      query: {
        provider,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockApiKeyDelete).toHaveBeenCalledWith(
      `workspace-api-keys/${workspaceId}/${provider}`,
      "key"
    );
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
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
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should handle errors from database delete operation", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const provider = "google";
    const error = new Error("Database error");

    const mockApiKeyDelete = vi.fn().mockRejectedValue(error);
    mockDb["workspace-api-key"].delete = mockApiKeyDelete;

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      params: {
        workspaceId,
      },
      query: {
        provider,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockApiKeyDelete).toHaveBeenCalledWith(
      `workspace-api-keys/${workspaceId}/${provider}`,
      "key"
    );
    expect(next).toHaveBeenCalledWith(error);
    expect(res.status).not.toHaveBeenCalled();
  });
});
