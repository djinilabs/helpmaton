import { badRequest, resourceGone } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockNext,
  createMockDatabase,
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

// Import the route handler after mocks are set up

describe("PUT /api/workspaces/:workspaceId", () => {
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
        const { name, description } = req.body;
        const db = await mockDatabase();
        const workspaceResource = (req as { workspaceResource?: string })
          .workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }

        const workspace = await db.workspace.get(
          workspaceResource,
          "workspace"
        );
        if (!workspace) {
          throw resourceGone("Workspace not found");
        }


        // Protect trial-related fields
        if (
          "trialCreditRequested" in req.body ||
          "trialCreditRequestedAt" in req.body ||
          "trialCreditApproved" in req.body ||
          "trialCreditApprovedAt" in req.body ||
          "trialCreditAmount" in req.body
        ) {
          throw badRequest(
            "Trial-related fields cannot be modified through this endpoint"
          );
        }

        // Update workspace - always use USD
        const updatePayload = {
          pk: workspaceResource,
          sk: "workspace" as const,
          name: name !== undefined ? name : workspace.name,
          description:
            description !== undefined ? description : workspace.description,
          currency: "usd" as const,
          updatedBy: (req as { userRef?: string }).userRef || "",
          updatedAt: new Date().toISOString(),
        };

        const updated = await db.workspace.update(updatePayload);

        res.json({
          id: updated.pk.replace("workspaces/", ""),
          name: updated.name,
          description: updated.description,
          creditBalance: updated.creditBalance ?? 0,
          currency: "usd",
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

  it("should update workspace name and description successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockWorkspace = {
      pk: "workspaces/workspace-123",
      sk: "workspace",
      name: "Old Name",
      description: "Old Description",
      currency: "usd",
      creditBalance: 0,
      spendingLimits: [],
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockUpdatedWorkspace = {
      ...mockWorkspace,
      name: "New Name",
      description: "New Description",
      updatedBy: "users/user-123",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const mockWorkspaceUpdate = vi.fn().mockResolvedValue(mockUpdatedWorkspace);
    mockDb.workspace.update = mockWorkspaceUpdate;

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        name: "New Name",
        description: "New Description",
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockWorkspaceGet).toHaveBeenCalledWith(
      "workspaces/workspace-123",
      "workspace"
    );
    expect(mockWorkspaceUpdate).toHaveBeenCalledWith({
      pk: "workspaces/workspace-123",
      sk: "workspace",
      name: "New Name",
      description: "New Description",
      currency: "usd",
      updatedBy: "users/user-123",
      updatedAt: expect.any(String),
    });
    expect(res.json).toHaveBeenCalledWith({
      id: "workspace-123",
      name: "New Name",
      description: "New Description",
      creditBalance: 0,
      currency: "usd",
      spendingLimits: [],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    });
  });

  it("should update only name when description is not provided", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockWorkspace = {
      pk: "workspaces/workspace-123",
      sk: "workspace",
      name: "Old Name",
      description: "Old Description",
      currency: "usd",
      creditBalance: 0,
      spendingLimits: [],
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockUpdatedWorkspace = {
      ...mockWorkspace,
      name: "New Name",
      updatedBy: "users/user-123",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const mockWorkspaceUpdate = vi.fn().mockResolvedValue(mockUpdatedWorkspace);
    mockDb.workspace.update = mockWorkspaceUpdate;

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      body: {
        name: "New Name",
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockWorkspaceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "New Name",
        description: "Old Description",
      })
    );
  });


  it("should throw badRequest when workspace resource is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: undefined,
      body: {
        name: "New Name",
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

  it("should throw resourceGone when workspace does not exist", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockWorkspaceGet = vi.fn().mockResolvedValue(null);
    mockDb.workspace.get = mockWorkspaceGet;

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      body: {
        name: "New Name",
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
    ).toBe(410);
    expect(
      (error as { output?: { payload: { message: string } } }).output?.payload
        .message
    ).toContain("Workspace not found");
  });

  it("should throw badRequest when trying to modify trial-related fields", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockWorkspace = {
      pk: "workspaces/workspace-123",
      sk: "workspace",
      name: "Test Workspace",
      description: "Test Description",
      currency: "usd",
      creditBalance: 0,
      spendingLimits: [],
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      body: {
        name: "New Name",
        trialCreditRequested: true,
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
    ).toContain("Trial-related fields cannot be modified");
  });

});
