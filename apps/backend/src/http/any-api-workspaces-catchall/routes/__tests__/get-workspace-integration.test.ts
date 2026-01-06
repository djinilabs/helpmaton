import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";
import { registerGetWorkspaceIntegration } from "../get-workspace-integration";

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

type MockResponseWithBody = Partial<express.Response> & {
  body: Record<string, unknown>;
  statusCode: number;
};

describe("GET /api/workspaces/:workspaceId/integrations/:integrationId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: MockResponseWithBody,
    next?: express.NextFunction
  ) {
    const { app, getHandler } = createTestAppWithHandlerCapture();
    registerGetWorkspaceIntegration(app);
    const handler = getHandler(
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

  it("should return integration details", async () => {
    const mockDb = createMockDatabase();
    const mockIntegration = {
      pk: "bot-integrations/workspace-123/integration-456",
      sk: "integration",
      workspaceId: "workspace-123",
      agentId: "agent-789",
      platform: "slack",
      name: "Test Bot",
      webhookUrl: "https://example.com/webhook",
      status: "active",
      lastUsedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    mockDb["bot-integration"] = {
      get: vi.fn().mockResolvedValue(mockIntegration),
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
    const res = createMockResponse() as MockResponseWithBody;

    await callRouteHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      id: "integration-456",
      platform: "slack",
      name: "Test Bot",
      agentId: "agent-789",
      status: "active",
    });
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
    const res = createMockResponse() as MockResponseWithBody;
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

