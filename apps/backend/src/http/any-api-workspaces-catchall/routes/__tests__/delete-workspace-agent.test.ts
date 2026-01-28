import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// eslint-disable-next-line import/order
import {
  createMockDatabase,
  createMockRequest,
  createMockResponse,
} from "../../../utils/__tests__/test-helpers";

const { mockDatabase, mockRemoveAgentResources } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockRemoveAgentResources: vi.fn(),
  };
});

vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/agentCleanup", () => ({
  removeAgentResources: mockRemoveAgentResources,
}));

vi.mock("../../../../utils/tracking", () => ({
  trackBusinessEvent: vi.fn(),
}));

vi.mock("../middleware", () => ({
  requireAuth: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    next();
  },
  requirePermission:
    () =>
    (
      _req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      next();
    },
  handleError: (error: unknown, next: express.NextFunction) => {
    next(error);
  },
}));

import { registerDeleteWorkspaceAgent } from "../delete-workspace-agent";

import { createTestAppWithHandlerCapture } from "./route-test-helpers";

describe("DELETE /api/workspaces/:workspaceId/agents/:agentId", () => {
  let testApp: ReturnType<typeof createTestAppWithHandlerCapture>;

  beforeEach(() => {
    vi.clearAllMocks();
    testApp = createTestAppWithHandlerCapture();
    registerDeleteWorkspaceAgent(testApp.app);
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>,
    next: express.NextFunction,
  ) {
    const handler = testApp.deleteHandler(
      "/api/workspaces/:workspaceId/agents/:agentId",
    );
    if (!handler) {
      throw new Error("Route handler not found");
    }
    await handler(req as express.Request, res as express.Response, next);
  }

  it("should delete agent and associated resources successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);
    mockRemoveAgentResources.mockResolvedValue({ cleanupErrors: [] });

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const agentPk = `agents/${workspaceId}/${agentId}`;
    mockDb.agent.get = vi.fn().mockResolvedValue({ pk: agentPk, sk: "agent" });

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      params: {
        workspaceId,
        agentId,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockDb.agent.get).toHaveBeenCalledWith(agentPk, "agent");
    expect(mockRemoveAgentResources).toHaveBeenCalledWith({
      db: mockDb,
      workspaceId,
      agentId,
    });
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
        agentId: "agent-456",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = (next as ReturnType<typeof vi.fn>).mock.calls[0][0] as Error;
    expect(error.message).toBe("Workspace resource not found");
  });

  it("should throw resourceGone when agent not found", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    mockDb.agent.get = vi.fn().mockResolvedValue(null);

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      params: {
        workspaceId,
        agentId,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockDb.agent.get).toHaveBeenCalledWith(
      `agents/${workspaceId}/${agentId}`,
      "agent",
    );
    expect(next).toHaveBeenCalled();
    const error = (next as ReturnType<typeof vi.fn>).mock.calls[0][0] as Error;
    expect(error.message).toBe("Agent not found");
  });
});
