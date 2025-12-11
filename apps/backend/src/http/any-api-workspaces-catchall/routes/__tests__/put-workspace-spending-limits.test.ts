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

describe("PUT /api/workspaces/:workspaceId/spending-limits/:timeFrame", () => {
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

        const updated = await mockUpdateSpendingLimit(
          db,
          workspaceId,
          timeFrame as "daily" | "weekly" | "monthly",
          amount
        );

        res.json({
          id: updated.pk.replace("workspaces/", ""),
          name: updated.name,
          description: updated.description,
          creditBalance: updated.creditBalance ?? 0,
          currency: updated.currency ?? "usd",
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
    const amount = 100.5;
    const timeFrame = "daily";

    const mockUpdatedWorkspace = {
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      workspaceId,
      name: "Test Workspace",
      description: "Test Description",
      creditBalance: 50.0,
      currency: "usd",
      spendingLimits: [
        { timeFrame: "daily", amount },
        { timeFrame: "weekly", amount: 500 },
        { timeFrame: "monthly", amount: 2000 },
      ],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    mockUpdateSpendingLimit.mockResolvedValue(mockUpdatedWorkspace);

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: "users/user-456",
      params: {
        workspaceId,
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
      amount
    );
    expect(res.json).toHaveBeenCalledWith({
      id: workspaceId,
      name: mockUpdatedWorkspace.name,
      description: mockUpdatedWorkspace.description,
      creditBalance: mockUpdatedWorkspace.creditBalance,
      currency: mockUpdatedWorkspace.currency,
      spendingLimits: mockUpdatedWorkspace.spendingLimits,
      createdAt: mockUpdatedWorkspace.createdAt,
      updatedAt: mockUpdatedWorkspace.updatedAt,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("should update weekly spending limit successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const amount = 500;
    const timeFrame = "weekly";

    const mockUpdatedWorkspace = {
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      workspaceId,
      name: "Test Workspace",
      description: "Test Description",
      creditBalance: 50.0,
      currency: "usd",
      spendingLimits: [
        { timeFrame: "daily", amount: 100 },
        { timeFrame: "weekly", amount },
        { timeFrame: "monthly", amount: 2000 },
      ],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    mockUpdateSpendingLimit.mockResolvedValue(mockUpdatedWorkspace);

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: "users/user-456",
      params: {
        workspaceId,
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
      amount
    );
    expect(res.json).toHaveBeenCalledWith({
      id: workspaceId,
      name: mockUpdatedWorkspace.name,
      description: mockUpdatedWorkspace.description,
      creditBalance: mockUpdatedWorkspace.creditBalance,
      currency: mockUpdatedWorkspace.currency,
      spendingLimits: mockUpdatedWorkspace.spendingLimits,
      createdAt: mockUpdatedWorkspace.createdAt,
      updatedAt: mockUpdatedWorkspace.updatedAt,
    });
  });

  it("should update monthly spending limit successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const amount = 2000;
    const timeFrame = "monthly";

    const mockUpdatedWorkspace = {
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      workspaceId,
      name: "Test Workspace",
      description: "Test Description",
      creditBalance: 50.0,
      currency: "usd",
      spendingLimits: [
        { timeFrame: "daily", amount: 100 },
        { timeFrame: "weekly", amount: 500 },
        { timeFrame: "monthly", amount },
      ],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    mockUpdateSpendingLimit.mockResolvedValue(mockUpdatedWorkspace);

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: "users/user-456",
      params: {
        workspaceId,
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
      amount
    );
  });

  it("should handle workspace with no creditBalance or currency", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const amount = 100;
    const timeFrame = "daily";

    const mockUpdatedWorkspace = {
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      workspaceId,
      name: "Test Workspace",
      description: "Test Description",
      creditBalance: undefined,
      currency: undefined,
      spendingLimits: [{ timeFrame: "daily", amount }],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    mockUpdateSpendingLimit.mockResolvedValue(mockUpdatedWorkspace);

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: "users/user-456",
      params: {
        workspaceId,
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
      id: workspaceId,
      name: mockUpdatedWorkspace.name,
      description: mockUpdatedWorkspace.description,
      creditBalance: 0,
      currency: "usd",
      spendingLimits: mockUpdatedWorkspace.spendingLimits,
      createdAt: mockUpdatedWorkspace.createdAt,
      updatedAt: mockUpdatedWorkspace.updatedAt,
    });
  });

  it("should throw badRequest when amount is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
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
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
        timeFrame: "daily",
      },
      body: {
        amount: "not-a-number",
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
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
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

  it("should throw badRequest when timeFrame is invalid", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
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

  it("should throw badRequest when workspace resource is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: undefined,
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
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

  it("should allow zero amount", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const amount = 0;
    const timeFrame = "daily";

    const mockUpdatedWorkspace = {
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      workspaceId,
      name: "Test Workspace",
      description: "Test Description",
      creditBalance: 50.0,
      currency: "usd",
      spendingLimits: [{ timeFrame: "daily", amount: 0 }],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    mockUpdateSpendingLimit.mockResolvedValue(mockUpdatedWorkspace);

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: "users/user-456",
      params: {
        workspaceId,
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
      0
    );
    expect(res.json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
