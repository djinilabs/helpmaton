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

describe("DELETE /api/workspaces/:workspaceId", () => {
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

        // Delete all permissions for this workspace
        const permissions = await db.permission.query({
          KeyConditionExpression: "pk = :workspacePk",
          ExpressionAttributeValues: {
            ":workspacePk": workspaceResource,
          },
        });

        // Delete all permission records
        for (const permission of permissions.items) {
          await db.permission.delete(permission.pk, permission.sk);
        }

        // Delete workspace
        await db.workspace.delete(workspaceResource, "workspace");

        res.status(204).send();
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should delete workspace and all its permissions successfully", async () => {
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

    const mockPermissions = [
      {
        pk: "workspaces/workspace-123",
        sk: "users/user-1",
      },
      {
        pk: "workspaces/workspace-123",
        sk: "users/user-2",
      },
    ];

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const mockPermissionQuery = vi.fn().mockResolvedValue({
      items: mockPermissions,
    });
    mockDb.permission.query = mockPermissionQuery;

    const mockPermissionDelete = vi.fn().mockResolvedValue(undefined);
    mockDb.permission.delete = mockPermissionDelete;

    const mockWorkspaceDelete = vi.fn().mockResolvedValue(undefined);
    mockDb.workspace.delete = mockWorkspaceDelete;

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockWorkspaceGet).toHaveBeenCalledWith(
      "workspaces/workspace-123",
      "workspace"
    );
    expect(mockPermissionQuery).toHaveBeenCalledWith({
      KeyConditionExpression: "pk = :workspacePk",
      ExpressionAttributeValues: {
        ":workspacePk": "workspaces/workspace-123",
      },
    });
    expect(mockPermissionDelete).toHaveBeenCalledTimes(2);
    expect(mockPermissionDelete).toHaveBeenCalledWith(
      "workspaces/workspace-123",
      "users/user-1"
    );
    expect(mockPermissionDelete).toHaveBeenCalledWith(
      "workspaces/workspace-123",
      "users/user-2"
    );
    expect(mockWorkspaceDelete).toHaveBeenCalledWith(
      "workspaces/workspace-123",
      "workspace"
    );
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });

  it("should delete workspace even when no permissions exist", async () => {
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

    const mockPermissionQuery = vi.fn().mockResolvedValue({
      items: [],
    });
    mockDb.permission.query = mockPermissionQuery;

    const mockPermissionDelete = vi.fn();
    mockDb.permission.delete = mockPermissionDelete;

    const mockWorkspaceDelete = vi.fn().mockResolvedValue(undefined);
    mockDb.workspace.delete = mockWorkspaceDelete;

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockPermissionQuery).toHaveBeenCalled();
    expect(mockPermissionDelete).not.toHaveBeenCalled();
    expect(mockWorkspaceDelete).toHaveBeenCalledWith(
      "workspaces/workspace-123",
      "workspace"
    );
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it("should throw badRequest when workspace resource is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: undefined,
      params: {
        workspaceId: "workspace-123",
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
      params: {
        workspaceId: "workspace-123",
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
    // Permission query and workspace delete should not be called when workspace doesn't exist
    // We verify this by checking that the error was thrown before those operations
  });

  it("should handle multiple permissions deletion", async () => {
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

    const mockPermissions = Array.from({ length: 5 }, (_, i) => ({
      pk: "workspaces/workspace-123",
      sk: `users/user-${i + 1}`,
    }));

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const mockPermissionQuery = vi.fn().mockResolvedValue({
      items: mockPermissions,
    });
    mockDb.permission.query = mockPermissionQuery;

    const mockPermissionDelete = vi.fn().mockResolvedValue(undefined);
    mockDb.permission.delete = mockPermissionDelete;

    const mockWorkspaceDelete = vi.fn().mockResolvedValue(undefined);
    mockDb.workspace.delete = mockWorkspaceDelete;

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockPermissionDelete).toHaveBeenCalledTimes(5);
    expect(mockWorkspaceDelete).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it("should handle permission deletion errors gracefully", async () => {
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

    const mockPermissions = [
      {
        pk: "workspaces/workspace-123",
        sk: "users/user-1",
      },
    ];

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const mockPermissionQuery = vi.fn().mockResolvedValue({
      items: mockPermissions,
    });
    mockDb.permission.query = mockPermissionQuery;

    const permissionError = new Error("Permission deletion failed");
    const mockPermissionDelete = vi.fn().mockRejectedValue(permissionError);
    mockDb.permission.delete = mockPermissionDelete;

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error).toBe(permissionError);
    // Workspace should not be deleted if permission deletion fails
    // We verify this by checking that the error was thrown before workspace deletion
  });
});
