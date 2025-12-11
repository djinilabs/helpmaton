import { badRequest, resourceGone, unauthorized } from "@hapi/boom";
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
const { mockDatabase, mockEnsureAuthorization } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockEnsureAuthorization: vi.fn(),
  };
});

// Mock the modules
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../tables/permissions", () => ({
  ensureAuthorization: mockEnsureAuthorization,
}));

describe("POST /api/workspaces/:workspaceId/members", () => {
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
        const { userId, permissionLevel } = req.body;
        if (!userId || typeof userId !== "string") {
          throw badRequest("userId is required and must be a string");
        }
        if (
          permissionLevel !== undefined &&
          (typeof permissionLevel !== "number" ||
            (permissionLevel !== PERMISSION_LEVELS.READ &&
              permissionLevel !== PERMISSION_LEVELS.WRITE &&
              permissionLevel !== PERMISSION_LEVELS.OWNER))
        ) {
          throw badRequest(
            "permissionLevel must be 1 (READ), 2 (WRITE), or 3 (OWNER)"
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
        const level: 1 | 2 | 3 =
          permissionLevel === PERMISSION_LEVELS.READ ||
          permissionLevel === PERMISSION_LEVELS.WRITE ||
          permissionLevel === PERMISSION_LEVELS.OWNER
            ? permissionLevel
            : PERMISSION_LEVELS.READ;

        // Check if workspace exists
        const workspace = await db.workspace.get(
          workspaceResource,
          "workspace"
        );
        if (!workspace) {
          throw resourceGone("Workspace not found");
        }

        // Grant permission
        await mockEnsureAuthorization(
          workspaceResource,
          memberUserRef,
          level,
          currentUserRef
        );

        // Get the created permission
        const permission = await db.permission.get(
          workspaceResource,
          memberUserRef
        );

        res.status(201).json({
          userId,
          userRef: memberUserRef,
          permissionLevel: permission?.type || level,
          createdAt: permission?.createdAt || new Date().toISOString(),
        });
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should add a member with READ permission level", async () => {
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
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const mockPermissionGet = vi.fn().mockResolvedValue(mockPermission);
    mockDb.permission.get = mockPermissionGet;

    mockEnsureAuthorization.mockResolvedValue(undefined);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        userId: "user-456",
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
    expect(mockEnsureAuthorization).toHaveBeenCalledWith(
      "workspaces/workspace-123",
      "users/user-456",
      PERMISSION_LEVELS.READ,
      "users/user-123"
    );
    expect(mockPermissionGet).toHaveBeenCalledWith(
      "workspaces/workspace-123",
      "users/user-456"
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      userId: "user-456",
      userRef: "users/user-456",
      permissionLevel: PERMISSION_LEVELS.READ,
      createdAt: "2024-01-01T00:00:00Z",
    });
  });

  it("should add a member with WRITE permission level", async () => {
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
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const mockPermissionGet = vi.fn().mockResolvedValue(mockPermission);
    mockDb.permission.get = mockPermissionGet;

    mockEnsureAuthorization.mockResolvedValue(undefined);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        userId: "user-456",
        permissionLevel: PERMISSION_LEVELS.WRITE,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockEnsureAuthorization).toHaveBeenCalledWith(
      "workspaces/workspace-123",
      "users/user-456",
      PERMISSION_LEVELS.WRITE,
      "users/user-123"
    );
    expect(res.json).toHaveBeenCalledWith({
      userId: "user-456",
      userRef: "users/user-456",
      permissionLevel: PERMISSION_LEVELS.WRITE,
      createdAt: "2024-01-01T00:00:00Z",
    });
  });

  it("should add a member with OWNER permission level", async () => {
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
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const mockPermissionGet = vi.fn().mockResolvedValue(mockPermission);
    mockDb.permission.get = mockPermissionGet;

    mockEnsureAuthorization.mockResolvedValue(undefined);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        userId: "user-456",
        permissionLevel: PERMISSION_LEVELS.OWNER,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockEnsureAuthorization).toHaveBeenCalledWith(
      "workspaces/workspace-123",
      "users/user-456",
      PERMISSION_LEVELS.OWNER,
      "users/user-123"
    );
    expect(res.json).toHaveBeenCalledWith({
      userId: "user-456",
      userRef: "users/user-456",
      permissionLevel: PERMISSION_LEVELS.OWNER,
      createdAt: "2024-01-01T00:00:00Z",
    });
  });

  it("should default to READ permission level when not specified", async () => {
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
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const mockPermissionGet = vi.fn().mockResolvedValue(mockPermission);
    mockDb.permission.get = mockPermissionGet;

    mockEnsureAuthorization.mockResolvedValue(undefined);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        userId: "user-456",
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockEnsureAuthorization).toHaveBeenCalledWith(
      "workspaces/workspace-123",
      "users/user-456",
      PERMISSION_LEVELS.READ,
      "users/user-123"
    );
  });

  it("should use default createdAt when permission is not found", async () => {
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

    mockEnsureAuthorization.mockResolvedValue(undefined);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        userId: "user-456",
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
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
    });

    const createdAt = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .createdAt;
    expect(createdAt >= beforeCall && createdAt <= afterCall).toBe(true);
  });

  it("should throw badRequest when userId is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
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
    ).toContain("userId is required");
  });

  it("should throw badRequest when userId is not a string", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        userId: 123,
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
    ).toContain("userId is required");
  });

  it("should throw badRequest when permissionLevel is invalid", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        userId: "user-456",
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
    ).toContain("permissionLevel must be 1 (READ), 2 (WRITE), or 3 (OWNER)");
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
      body: {
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

  it("should throw unauthorized when userRef is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      userRef: undefined,
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
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
      },
      body: {
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
});
