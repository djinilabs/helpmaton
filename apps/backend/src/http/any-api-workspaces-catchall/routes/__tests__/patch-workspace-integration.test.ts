import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";
import { registerPatchWorkspaceIntegration } from "../patch-workspace-integration";

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

describe("PATCH /api/workspaces/:workspaceId/integrations/:integrationId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: MockResponseWithBody,
    next?: express.NextFunction
  ) {
    const { app, patchHandler } = createTestAppWithHandlerCapture();
    registerPatchWorkspaceIntegration(app);
    const handler = patchHandler(
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

  it("should update integration name", async () => {
    const mockDb = createMockDatabase();
    const mockIntegration = {
      pk: "bot-integrations/workspace-123/integration-456",
      sk: "integration",
      workspaceId: "workspace-123",
      agentId: "agent-789",
      platform: "slack",
      name: "Old Name",
      status: "active",
      version: 1,
    };

    const updatedIntegration = {
      ...mockIntegration,
      name: "New Name",
    };

    mockDb["bot-integration"] = {
      get: vi.fn().mockResolvedValue(mockIntegration),
      put: vi.fn(),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue(updatedIntegration),
      delete: vi.fn(),
      query: vi.fn(),
    };
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      params: {
        workspaceId: "workspace-123",
        integrationId: "integration-456",
      },
      body: {
        name: "New Name",
      },
    });
    const res = createMockResponse() as MockResponseWithBody;

    await callRouteHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.name).toBe("New Name");
    expect(mockDb["bot-integration"].update).toHaveBeenCalledWith(
      expect.objectContaining({
        pk: "bot-integrations/workspace-123/integration-456",
        sk: "integration",
        name: "New Name",
      })
    );
  });

  it("should update integration status", async () => {
    const mockDb = createMockDatabase();
    const mockIntegration = {
      pk: "bot-integrations/workspace-123/integration-456",
      sk: "integration",
      status: "active",
      version: 1,
    };

    mockDb["bot-integration"] = {
      get: vi.fn().mockResolvedValue(mockIntegration),
      put: vi.fn(),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({ ...mockIntegration, status: "inactive" }),
      delete: vi.fn(),
      query: vi.fn(),
    };
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      params: {
        workspaceId: "workspace-123",
        integrationId: "integration-456",
      },
      body: {
        status: "inactive",
      },
    });
    const res = createMockResponse() as MockResponseWithBody;

    await callRouteHandler(req, res);

    expect(res.body.status).toBe("inactive");
  });

  it("should update Discord config with valid publicKey", async () => {
    const mockDb = createMockDatabase();
    const mockIntegration = {
      pk: "bot-integrations/workspace-123/integration-456",
      sk: "integration",
      platform: "discord",
      config: {
        botToken: "old-token",
        publicKey: "a".repeat(64),
      },
      version: 1,
    };

    mockDb["bot-integration"] = {
      get: vi.fn().mockResolvedValue(mockIntegration),
      put: vi.fn(),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue(mockIntegration),
      delete: vi.fn(),
      query: vi.fn(),
    };
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      params: {
        workspaceId: "workspace-123",
        integrationId: "integration-456",
      },
      body: {
        config: {
          botToken: "new-token",
        },
      },
    });
    const res = createMockResponse() as MockResponseWithBody;

    await callRouteHandler(req, res);

    expect(mockDb["bot-integration"].update).toHaveBeenCalled();
  });

  it("should throw badRequest for invalid publicKey format", async () => {
    const mockDb = createMockDatabase();
    const mockIntegration = {
      pk: "bot-integrations/workspace-123/integration-456",
      sk: "integration",
      platform: "discord",
      config: {
        botToken: "token",
        publicKey: "a".repeat(64),
      },
      version: 1,
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
      body: {
        config: {
          publicKey: "invalid-key", // Not 64 hex chars
        },
      },
    });
    const res = createMockResponse() as MockResponseWithBody;
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
        }),
      })
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
      body: {
        name: "New Name",
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

