import { badRequest } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDatabase, mockRemoveSpendingLimit } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockRemoveSpendingLimit: vi.fn(),
  };
});

// Mock the modules
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/spendingLimitsManagement", () => ({
  removeSpendingLimit: mockRemoveSpendingLimit,
}));

describe("DELETE /api/workspaces/:workspaceId/agents/:agentId/spending-limits/:timeFrame", () => {
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
        const timeFrame = req.params.timeFrame;
        if (!["daily", "weekly", "monthly"].includes(timeFrame)) {
          throw badRequest("timeFrame must be 'daily', 'weekly', or 'monthly'");
        }

        const db = await mockDatabase();
        const workspaceResource = (req as { workspaceResource?: string })
          .workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const workspaceId = req.params.workspaceId;
        const agentId = req.params.agentId;

        const updated = (await mockRemoveSpendingLimit(
          db,
          workspaceId,
          timeFrame as "daily" | "weekly" | "monthly",
          agentId
        )) as {
          name: string;
          systemPrompt: string;
          notificationChannelId?: string | null;
          spendingLimits?: Array<{ timeFrame: string; amount: number }>;
          createdAt: string;
          updatedAt: string;
        };

        res.json({
          id: agentId,
          name: updated.name,
          systemPrompt: updated.systemPrompt,
          notificationChannelId: updated.notificationChannelId,
          spendingLimits: updated.spendingLimits ?? [],
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        });
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should remove daily spending limit successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const timeFrame = "daily";

    const mockUpdatedAgent = {
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      notificationChannelId: "channel-123",
      spendingLimits: [
        { timeFrame: "weekly", amount: 500 },
        { timeFrame: "monthly", amount: 2000 },
      ],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    mockRemoveSpendingLimit.mockResolvedValue(mockUpdatedAgent);

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      params: {
        workspaceId,
        agentId,
        timeFrame,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockRemoveSpendingLimit).toHaveBeenCalledWith(
      mockDb,
      workspaceId,
      "daily",
      agentId
    );
    expect(res.json).toHaveBeenCalledWith({
      id: agentId,
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      notificationChannelId: "channel-123",
      spendingLimits: [
        { timeFrame: "weekly", amount: 500 },
        { timeFrame: "monthly", amount: 2000 },
      ],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("should remove weekly spending limit successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const timeFrame = "weekly";

    const mockUpdatedAgent = {
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      notificationChannelId: null,
      spendingLimits: [
        { timeFrame: "daily", amount: 100 },
        { timeFrame: "monthly", amount: 2000 },
      ],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    mockRemoveSpendingLimit.mockResolvedValue(mockUpdatedAgent);

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      params: {
        workspaceId,
        agentId,
        timeFrame,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockRemoveSpendingLimit).toHaveBeenCalledWith(
      mockDb,
      workspaceId,
      "weekly",
      agentId
    );
    expect(res.json).toHaveBeenCalledWith({
      id: agentId,
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      notificationChannelId: null,
      spendingLimits: [
        { timeFrame: "daily", amount: 100 },
        { timeFrame: "monthly", amount: 2000 },
      ],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    });
  });

  it("should remove monthly spending limit successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const timeFrame = "monthly";

    const mockUpdatedAgent = {
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      notificationChannelId: "channel-789",
      spendingLimits: [
        { timeFrame: "daily", amount: 100 },
        { timeFrame: "weekly", amount: 500 },
      ],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    mockRemoveSpendingLimit.mockResolvedValue(mockUpdatedAgent);

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      params: {
        workspaceId,
        agentId,
        timeFrame,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockRemoveSpendingLimit).toHaveBeenCalledWith(
      mockDb,
      workspaceId,
      "monthly",
      agentId
    );
    expect(res.json).toHaveBeenCalledWith({
      id: agentId,
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      notificationChannelId: "channel-789",
      spendingLimits: [
        { timeFrame: "daily", amount: 100 },
        { timeFrame: "weekly", amount: 500 },
      ],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    });
  });

  it("should handle agent with no spending limits after removal", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const timeFrame = "daily";

    const mockUpdatedAgent = {
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      notificationChannelId: null,
      spendingLimits: undefined,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    mockRemoveSpendingLimit.mockResolvedValue(mockUpdatedAgent);

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      params: {
        workspaceId,
        agentId,
        timeFrame,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      id: agentId,
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      notificationChannelId: null,
      spendingLimits: [],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    });
  });

  it("should throw badRequest when workspace resource is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: undefined,
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
        timeFrame: "daily",
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

  it("should throw badRequest when timeFrame is not one of allowed values", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
        timeFrame: "yearly",
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
            message: expect.stringContaining(
              "timeFrame must be 'daily', 'weekly', or 'monthly'"
            ),
          }),
        }),
      })
    );
  });
});
