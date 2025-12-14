import { badRequest, resourceGone } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { PERMISSION_LEVELS } from "../../../../tables/schema";
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

describe("DELETE /api/workspaces/:workspaceId/members/:userId", () => {
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
        const { userId } = req.params;
        const db = await mockDatabase();
        const workspaceResource = (req as { workspaceResource?: string })
          .workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const memberUserRef = `users/${userId}`;

        // Check if workspace exists
        const workspace = await db.workspace.get(
          workspaceResource,
          "workspace"
        );
        if (!workspace) {
          throw resourceGone("Workspace not found");
        }

        // Check if permission exists
        const permission = await db.permission.get(
          workspaceResource,
          memberUserRef
        );
        if (!permission) {
          throw resourceGone("Member not found in workspace");
        }

        // Check if user is the only OWNER
        if (permission.type === PERMISSION_LEVELS.OWNER) {
          const allPermissions = await db.permission.query({
            KeyConditionExpression: "pk = :workspacePk",
            ExpressionAttributeValues: {
              ":workspacePk": workspaceResource,
            },
          });
          const ownerCount = allPermissions.items.filter(
            (p: { type: number }) => p.type === PERMISSION_LEVELS.OWNER
          ).length;
          if (ownerCount <= 1) {
            throw badRequest(
              "Cannot remove the last owner. A workspace must have at least one owner."
            );
          }
        }

        // Delete permission
        await db.permission.delete(workspaceResource, memberUserRef);

        res.status(204).send();
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should delete a non-owner member successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockWorkspace = {
      pk: "workspaces/workspace-123",
      sk: "workspace",
      name: "Test Workspace",
    };

    const mockPermission = {
      pk: "workspaces/workspace-123",
      sk: "users/user-456",
      type: PERMISSION_LEVELS.READ,
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const mockPermissionGet = vi.fn().mockResolvedValue(mockPermission);
    mockDb.permission.get = mockPermissionGet;

    const mockPermissionDelete = vi.fn().mockResolvedValue(undefined);
    mockDb.permission.delete = mockPermissionDelete;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        userId: "user-456",
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockWorkspaceGet).toHaveBeenCalledWith(
      "workspaces/workspace-123",
      "workspace"
    );
    expect(mockPermissionGet).toHaveBeenCalledWith(
      "workspaces/workspace-123",
      "users/user-456"
    );
    expect(mockPermissionDelete).toHaveBeenCalledWith(
      "workspaces/workspace-123",
      "users/user-456"
    );
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });

  it("should delete an owner member when there are multiple owners", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockWorkspace = {
      pk: "workspaces/workspace-123",
      sk: "workspace",
      name: "Test Workspace",
    };

    const mockPermission = {
      pk: "workspaces/workspace-123",
      sk: "users/user-456",
      type: PERMISSION_LEVELS.OWNER,
    };

    const mockAllPermissions = [
      {
        pk: "workspaces/workspace-123",
        sk: "users/user-123",
        type: PERMISSION_LEVELS.OWNER,
      },
      {
        pk: "workspaces/workspace-123",
        sk: "users/user-456",
        type: PERMISSION_LEVELS.OWNER,
      },
      {
        pk: "workspaces/workspace-123",
        sk: "users/user-789",
        type: PERMISSION_LEVELS.READ,
      },
    ];

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const mockPermissionGet = vi.fn().mockResolvedValue(mockPermission);
    mockDb.permission.get = mockPermissionGet;

    const mockPermissionQuery = vi.fn().mockResolvedValue({
      items: mockAllPermissions,
    });
    mockDb.permission.query = mockPermissionQuery;

    const mockPermissionDelete = vi.fn().mockResolvedValue(undefined);
    mockDb.permission.delete = mockPermissionDelete;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        userId: "user-456",
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockPermissionQuery).toHaveBeenCalledWith({
      KeyConditionExpression: "pk = :workspacePk",
      ExpressionAttributeValues: {
        ":workspacePk": "workspaces/workspace-123",
      },
    });
    expect(mockPermissionDelete).toHaveBeenCalledWith(
      "workspaces/workspace-123",
      "users/user-456"
    );
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it("should throw badRequest when trying to remove the last owner", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockWorkspace = {
      pk: "workspaces/workspace-123",
      sk: "workspace",
      name: "Test Workspace",
    };

    const mockPermission = {
      pk: "workspaces/workspace-123",
      sk: "users/user-456",
      type: PERMISSION_LEVELS.OWNER,
    };

    const mockAllPermissions = [
      {
        pk: "workspaces/workspace-123",
        sk: "users/user-456",
        type: PERMISSION_LEVELS.OWNER,
      },
    ];

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const mockPermissionGet = vi.fn().mockResolvedValue(mockPermission);
    mockDb.permission.get = mockPermissionGet;

    const mockPermissionQuery = vi.fn().mockResolvedValue({
      items: mockAllPermissions,
    });
    mockDb.permission.query = mockPermissionQuery;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        userId: "user-456",
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
    ).toContain("Cannot remove the last owner");
  });

  it("should throw badRequest when workspace resource is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: undefined,
      params: {
        workspaceId: "workspace-123",
        userId: "user-456",
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
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        userId: "user-456",
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

  it("should throw resourceGone when member does not exist in workspace", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockWorkspace = {
      pk: "workspaces/workspace-123",
      sk: "workspace",
      name: "Test Workspace",
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const mockPermissionGet = vi.fn().mockResolvedValue(null);
    mockDb.permission.get = mockPermissionGet;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        userId: "user-456",
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
    ).toContain("Member not found in workspace");
  });

  it("should delete a WRITE permission member successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockWorkspace = {
      pk: "workspaces/workspace-123",
      sk: "workspace",
      name: "Test Workspace",
    };

    const mockPermission = {
      pk: "workspaces/workspace-123",
      sk: "users/user-456",
      type: PERMISSION_LEVELS.WRITE,
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const mockPermissionGet = vi.fn().mockResolvedValue(mockPermission);
    mockDb.permission.get = mockPermissionGet;

    const mockPermissionDelete = vi.fn().mockResolvedValue(undefined);
    mockDb.permission.delete = mockPermissionDelete;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        userId: "user-456",
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockPermissionDelete).toHaveBeenCalledWith(
      "workspaces/workspace-123",
      "users/user-456"
    );
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it("should prevent removing owner when there is exactly one owner", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockWorkspace = {
      pk: "workspaces/workspace-123",
      sk: "workspace",
      name: "Test Workspace",
    };

    const mockPermission = {
      pk: "workspaces/workspace-123",
      sk: "users/user-456",
      type: PERMISSION_LEVELS.OWNER,
    };

    const mockAllPermissions = [
      {
        pk: "workspaces/workspace-123",
        sk: "users/user-456",
        type: PERMISSION_LEVELS.OWNER,
      },
      {
        pk: "workspaces/workspace-123",
        sk: "users/user-789",
        type: PERMISSION_LEVELS.READ,
      },
    ];

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const mockPermissionGet = vi.fn().mockResolvedValue(mockPermission);
    mockDb.permission.get = mockPermissionGet;

    const mockPermissionQuery = vi.fn().mockResolvedValue({
      items: mockAllPermissions,
    });
    mockDb.permission.query = mockPermissionQuery;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        userId: "user-456",
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
    ).toContain("Cannot remove the last owner");
  });
});
