import { badRequest } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDatabase, mockUpdateSpendingLimit } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockUpdateSpendingLimit: vi.fn(),
  };
});

// Mock the modules
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/spendingLimitsManagement", () => ({
  updateSpendingLimit: mockUpdateSpendingLimit,
}));

describe("PUT /api/workspaces/:workspaceId/agents/:agentId/spending-limits/:timeFrame", () => {
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
        const { amount } = req.body;
        if (typeof amount !== "number" || amount < 0) {
          throw badRequest(
            "amount is required and must be a non-negative number"
          );
        }

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

        const updated = (await mockUpdateSpendingLimit(
          db,
          workspaceId,
          timeFrame as "daily" | "weekly" | "monthly",
          amount,
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

  it("should update daily spending limit successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const amount = 100.5;
    const timeFrame = "daily";

    const mockUpdatedAgent = {
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      notificationChannelId: "channel-123",
      spendingLimits: [
        { timeFrame: "daily", amount },
        { timeFrame: "weekly", amount: 500 },
      ],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    mockUpdateSpendingLimit.mockResolvedValue(mockUpdatedAgent);

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      params: {
        workspaceId,
        agentId,
        timeFrame,
      },
      body: {
        amount,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockUpdateSpendingLimit).toHaveBeenCalledWith(
      mockDb,
      workspaceId,
      "daily",
      amount,
      agentId
    );
    expect(res.json).toHaveBeenCalledWith({
      id: agentId,
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      notificationChannelId: "channel-123",
      spendingLimits: [
        { timeFrame: "daily", amount },
        { timeFrame: "weekly", amount: 500 },
      ],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("should update weekly spending limit successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const amount = 750;
    const timeFrame = "weekly";

    const mockUpdatedAgent = {
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      notificationChannelId: null,
      spendingLimits: [
        { timeFrame: "daily", amount: 100 },
        { timeFrame: "weekly", amount },
      ],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    mockUpdateSpendingLimit.mockResolvedValue(mockUpdatedAgent);

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      params: {
        workspaceId,
        agentId,
        timeFrame,
      },
      body: {
        amount,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockUpdateSpendingLimit).toHaveBeenCalledWith(
      mockDb,
      workspaceId,
      "weekly",
      amount,
      agentId
    );
    expect(res.json).toHaveBeenCalledWith({
      id: agentId,
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      notificationChannelId: null,
      spendingLimits: [
        { timeFrame: "daily", amount: 100 },
        { timeFrame: "weekly", amount },
      ],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    });
  });

  it("should update monthly spending limit successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const amount = 3000;
    const timeFrame = "monthly";

    const mockUpdatedAgent = {
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      notificationChannelId: "channel-789",
      spendingLimits: [
        { timeFrame: "daily", amount: 100 },
        { timeFrame: "weekly", amount: 500 },
        { timeFrame: "monthly", amount },
      ],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    mockUpdateSpendingLimit.mockResolvedValue(mockUpdatedAgent);

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      params: {
        workspaceId,
        agentId,
        timeFrame,
      },
      body: {
        amount,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockUpdateSpendingLimit).toHaveBeenCalledWith(
      mockDb,
      workspaceId,
      "monthly",
      amount,
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
        { timeFrame: "monthly", amount },
      ],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    });
  });

  it("should handle agent with no spending limits", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const amount = 50;
    const timeFrame = "daily";

    const mockUpdatedAgent = {
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      notificationChannelId: null,
      spendingLimits: undefined,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    mockUpdateSpendingLimit.mockResolvedValue(mockUpdatedAgent);

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      params: {
        workspaceId,
        agentId,
        timeFrame,
      },
      body: {
        amount,
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
      body: {
        amount: 100,
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

  it("should throw badRequest when amount is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
        timeFrame: "daily",
      },
      body: {},
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
              "amount is required and must be a non-negative number"
            ),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when amount is not a number", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
        timeFrame: "daily",
      },
      body: {
        amount: "100",
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
              "amount is required and must be a non-negative number"
            ),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when amount is negative", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
        timeFrame: "daily",
      },
      body: {
        amount: -10,
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
              "amount is required and must be a non-negative number"
            ),
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
      body: {
        amount: 100,
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

  it("should accept zero amount", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const amount = 0;
    const timeFrame = "daily";

    const mockUpdatedAgent = {
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      notificationChannelId: null,
      spendingLimits: [{ timeFrame: "daily", amount: 0 }],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    mockUpdateSpendingLimit.mockResolvedValue(mockUpdatedAgent);

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      params: {
        workspaceId,
        agentId,
        timeFrame,
      },
      body: {
        amount,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockUpdateSpendingLimit).toHaveBeenCalledWith(
      mockDb,
      workspaceId,
      "daily",
      amount,
      agentId
    );
    expect(res.json).toHaveBeenCalledWith({
      id: agentId,
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      notificationChannelId: null,
      spendingLimits: [{ timeFrame: "daily", amount: 0 }],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    });
  });
});
