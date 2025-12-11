import { badRequest, forbidden, resourceGone, unauthorized } from "@hapi/boom";
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
const {
  mockDatabase,
  mockEnsureExactAuthorization,
  mockGetUserAuthorizationLevelForResource,
} = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockEnsureExactAuthorization: vi.fn(),
    mockGetUserAuthorizationLevelForResource: vi.fn(),
  };
});

// Mock the modules
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../tables/permissions", () => ({
  ensureExactAuthorization: mockEnsureExactAuthorization,
  getUserAuthorizationLevelForResource:
    mockGetUserAuthorizationLevelForResource,
}));

describe("PUT /api/workspaces/:workspaceId/members/:userId", () => {
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
        const { permissionLevel } = req.body;
        const { userId } = req.params;

        if (
          !permissionLevel ||
          typeof permissionLevel !== "number" ||
          (permissionLevel !== PERMISSION_LEVELS.READ &&
            permissionLevel !== PERMISSION_LEVELS.WRITE &&
            permissionLevel !== PERMISSION_LEVELS.OWNER)
        ) {
          throw badRequest(
            "permissionLevel is required and must be 1 (READ), 2 (WRITE), or 3 (OWNER)"
          );
        }

        const db = await mockDatabase();
        const workspaceResource = (req as { workspaceResource?: string })
          .workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const currentUserRef = (req as { userRef?: string }).userRef;
        if (!currentUserRef) {
          throw unauthorized();
        }
        const memberUserRef = `users/${userId}`;
        const level = permissionLevel as 1 | 2 | 3;

        // Check if workspace exists
        const workspace = await db.workspace.get(
          workspaceResource,
          "workspace"
        );
        if (!workspace) {
          throw resourceGone("Workspace not found");
        }

        // Check if granter has sufficient permission level
        const granterLevel = await mockGetUserAuthorizationLevelForResource(
          workspaceResource,
          currentUserRef
        );
        if (!granterLevel || granterLevel < level) {
          throw forbidden(
            "Cannot grant permission level higher than your own permission level"
          );
        }

        // Update permission
        await mockEnsureExactAuthorization(
          workspaceResource,
          memberUserRef,
          level,
          currentUserRef
        );

        // Get the updated permission
        const permission = await db.permission.get(
          workspaceResource,
          memberUserRef
        );

        res.json({
          userId,
          userRef: memberUserRef,
          permissionLevel: permission?.type || level,
          updatedAt: permission?.updatedAt || new Date().toISOString(),
        });
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should update member permission to READ level", async () => {
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
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const mockPermissionGet = vi.fn().mockResolvedValue(mockPermission);
    mockDb.permission.get = mockPermissionGet;

    mockGetUserAuthorizationLevelForResource.mockResolvedValue(
      PERMISSION_LEVELS.OWNER
    );
    mockEnsureExactAuthorization.mockResolvedValue(undefined);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        userId: "user-456",
      },
      body: {
        permissionLevel: PERMISSION_LEVELS.READ,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockWorkspaceGet).toHaveBeenCalledWith(
      "workspaces/workspace-123",
      "workspace"
    );
    expect(mockGetUserAuthorizationLevelForResource).toHaveBeenCalledWith(
      "workspaces/workspace-123",
      "users/user-123"
    );
    expect(mockEnsureExactAuthorization).toHaveBeenCalledWith(
      "workspaces/workspace-123",
      "users/user-456",
      PERMISSION_LEVELS.READ,
      "users/user-123"
    );
    expect(mockPermissionGet).toHaveBeenCalledWith(
      "workspaces/workspace-123",
      "users/user-456"
    );
    expect(res.json).toHaveBeenCalledWith({
      userId: "user-456",
      userRef: "users/user-456",
      permissionLevel: PERMISSION_LEVELS.READ,
      updatedAt: "2024-01-01T00:00:00Z",
    });
  });

  it("should update member permission to WRITE level", async () => {
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
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const mockPermissionGet = vi.fn().mockResolvedValue(mockPermission);
    mockDb.permission.get = mockPermissionGet;

    mockGetUserAuthorizationLevelForResource.mockResolvedValue(
      PERMISSION_LEVELS.OWNER
    );
    mockEnsureExactAuthorization.mockResolvedValue(undefined);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        userId: "user-456",
      },
      body: {
        permissionLevel: PERMISSION_LEVELS.WRITE,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockEnsureExactAuthorization).toHaveBeenCalledWith(
      "workspaces/workspace-123",
      "users/user-456",
      PERMISSION_LEVELS.WRITE,
      "users/user-123"
    );
    expect(res.json).toHaveBeenCalledWith({
      userId: "user-456",
      userRef: "users/user-456",
      permissionLevel: PERMISSION_LEVELS.WRITE,
      updatedAt: "2024-01-01T00:00:00Z",
    });
  });

  it("should update member permission to OWNER level", async () => {
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
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const mockPermissionGet = vi.fn().mockResolvedValue(mockPermission);
    mockDb.permission.get = mockPermissionGet;

    mockGetUserAuthorizationLevelForResource.mockResolvedValue(
      PERMISSION_LEVELS.OWNER
    );
    mockEnsureExactAuthorization.mockResolvedValue(undefined);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        userId: "user-456",
      },
      body: {
        permissionLevel: PERMISSION_LEVELS.OWNER,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockEnsureExactAuthorization).toHaveBeenCalledWith(
      "workspaces/workspace-123",
      "users/user-456",
      PERMISSION_LEVELS.OWNER,
      "users/user-123"
    );
    expect(res.json).toHaveBeenCalledWith({
      userId: "user-456",
      userRef: "users/user-456",
      permissionLevel: PERMISSION_LEVELS.OWNER,
      updatedAt: "2024-01-01T00:00:00Z",
    });
  });

  it("should use default updatedAt when permission is not found", async () => {
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

    mockGetUserAuthorizationLevelForResource.mockResolvedValue(
      PERMISSION_LEVELS.OWNER
    );
    mockEnsureExactAuthorization.mockResolvedValue(undefined);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        userId: "user-456",
      },
      body: {
        permissionLevel: PERMISSION_LEVELS.READ,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    const beforeCall = new Date().toISOString();
    await callRouteHandler(req, res, next);
    const afterCall = new Date().toISOString();

    expect(res.json).toHaveBeenCalledWith({
      userId: "user-456",
      userRef: "users/user-456",
      permissionLevel: PERMISSION_LEVELS.READ,
      updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
    });

    const updatedAt = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .updatedAt;
    expect(updatedAt >= beforeCall && updatedAt <= afterCall).toBe(true);
  });

  it("should throw badRequest when permissionLevel is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        userId: "user-456",
      },
      body: {},
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
    ).toContain("permissionLevel is required");
  });

  it("should throw badRequest when permissionLevel is invalid", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        userId: "user-456",
      },
      body: {
        permissionLevel: 99,
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
    ).toContain(
      "permissionLevel is required and must be 1 (READ), 2 (WRITE), or 3 (OWNER)"
    );
  });

  it("should throw badRequest when workspace resource is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: undefined,
      params: {
        workspaceId: "workspace-123",
        userId: "user-456",
      },
      body: {
        permissionLevel: PERMISSION_LEVELS.READ,
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

  it("should throw unauthorized when userRef is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      userRef: undefined,
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        userId: "user-456",
      },
      body: {
        permissionLevel: PERMISSION_LEVELS.READ,
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
    ).toBe(401);
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
        userId: "user-456",
      },
      body: {
        permissionLevel: PERMISSION_LEVELS.READ,
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

  it("should throw forbidden when granter level is insufficient", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockWorkspace = {
      pk: "workspaces/workspace-123",
      sk: "workspace",
      name: "Test Workspace",
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    mockGetUserAuthorizationLevelForResource.mockResolvedValue(
      PERMISSION_LEVELS.READ
    );

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        userId: "user-456",
      },
      body: {
        permissionLevel: PERMISSION_LEVELS.WRITE,
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
    ).toBe(403);
    expect(
      (error as { output?: { payload: { message: string } } }).output?.payload
        .message
    ).toContain("Cannot grant permission level higher than your own");
    expect(mockEnsureExactAuthorization).not.toHaveBeenCalled();
  });

  it("should throw forbidden when granter has no permission level", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockWorkspace = {
      pk: "workspaces/workspace-123",
      sk: "workspace",
      name: "Test Workspace",
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    mockGetUserAuthorizationLevelForResource.mockResolvedValue(null);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        userId: "user-456",
      },
      body: {
        permissionLevel: PERMISSION_LEVELS.READ,
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
    ).toBe(403);
    expect(mockEnsureExactAuthorization).not.toHaveBeenCalled();
  });

  it("should allow granting same permission level as granter", async () => {
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
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const mockPermissionGet = vi.fn().mockResolvedValue(mockPermission);
    mockDb.permission.get = mockPermissionGet;

    mockGetUserAuthorizationLevelForResource.mockResolvedValue(
      PERMISSION_LEVELS.WRITE
    );
    mockEnsureExactAuthorization.mockResolvedValue(undefined);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        userId: "user-456",
      },
      body: {
        permissionLevel: PERMISSION_LEVELS.WRITE,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockEnsureExactAuthorization).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
  });
});
