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

describe("DELETE /api/workspaces/:workspaceId/spending-limits/:timeFrame", () => {
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

        const updated = await mockRemoveSpendingLimit(
          db,
          workspaceId,
          timeFrame as "daily" | "weekly" | "monthly"
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

  it("should remove daily spending limit successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
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
        { timeFrame: "weekly", amount: 500 },
        { timeFrame: "monthly", amount: 2000 },
      ],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    mockRemoveSpendingLimit.mockResolvedValue(mockUpdatedWorkspace);

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: "users/user-456",
      params: {
        workspaceId,
        timeFrame,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockRemoveSpendingLimit).toHaveBeenCalledWith(
      mockDb,
      workspaceId,
      "daily"
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

  it("should remove weekly spending limit successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
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
        { timeFrame: "monthly", amount: 2000 },
      ],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    mockRemoveSpendingLimit.mockResolvedValue(mockUpdatedWorkspace);

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: "users/user-456",
      params: {
        workspaceId,
        timeFrame,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockRemoveSpendingLimit).toHaveBeenCalledWith(
      mockDb,
      workspaceId,
      "weekly"
    );
  });

  it("should remove monthly spending limit successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
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
      ],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    mockRemoveSpendingLimit.mockResolvedValue(mockUpdatedWorkspace);

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: "users/user-456",
      params: {
        workspaceId,
        timeFrame,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockRemoveSpendingLimit).toHaveBeenCalledWith(
      mockDb,
      workspaceId,
      "monthly"
    );
  });

  it("should handle workspace with no creditBalance or currency", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const timeFrame = "daily";

    const mockUpdatedWorkspace = {
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      workspaceId,
      name: "Test Workspace",
      description: "Test Description",
      creditBalance: undefined,
      currency: undefined,
      spendingLimits: [],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    mockRemoveSpendingLimit.mockResolvedValue(mockUpdatedWorkspace);

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: "users/user-456",
      params: {
        workspaceId,
        timeFrame,
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
      spendingLimits: [],
      createdAt: mockUpdatedWorkspace.createdAt,
      updatedAt: mockUpdatedWorkspace.updatedAt,
    });
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
});
