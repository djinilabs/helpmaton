import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";
import { registerDeleteWorkspaceIntegration } from "../delete-workspace-integration";

import { createTestAppWithHandlerCapture } from "./route-test-helpers";

// Mock dependencies
const { mockDatabase } = vi.hoisted(() => ({
  mockDatabase: vi.fn(),
}));

vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("@architect/functions", () => ({
  tables: vi.fn().mockResolvedValue({
    reflect: vi.fn().mockResolvedValue({}),
    _client: {},
  }),
}));

describe("DELETE /api/workspaces/:workspaceId/integrations/:integrationId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>,
    next?: express.NextFunction
  ) {
    const { app, deleteHandler } = createTestAppWithHandlerCapture();
    registerDeleteWorkspaceIntegration(app);
    const handler = deleteHandler(
      "/api/workspaces/:workspaceId/integrations/:integrationId"
    );
    if (!handler) {
      throw new Error("Handler not found");
    }
    await handler(
      req as express.Request,
      res as express.Response,
      next || (() => {})
    );
  }

  it("should successfully delete integration", async () => {
    const mockDb = createMockDatabase();
    const mockIntegration = {
      pk: "bot-integrations/workspace-123/integration-456",
      sk: "integration",
    };

    mockDb["bot-integration"] = {
      get: vi.fn().mockResolvedValue(mockIntegration),
      put: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
      query: vi.fn(),
    };
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      params: {
        workspaceId: "workspace-123",
        integrationId: "integration-456",
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.statusCode).toBe(204);
    expect(mockDb["bot-integration"].delete).toHaveBeenCalledWith(
      "bot-integrations/workspace-123/integration-456",
      "integration"
    );
  });

  it("should throw notFound when integration does not exist", async () => {
    const mockDb = createMockDatabase();
    mockDb["bot-integration"] = {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      query: vi.fn(),
    };
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      params: {
        workspaceId: "workspace-123",
        integrationId: "integration-456",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 404,
        }),
      })
    );
  });
});

