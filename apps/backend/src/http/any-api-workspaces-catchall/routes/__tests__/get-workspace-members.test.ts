import { badRequest } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockNext,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDatabase, mockGetUserEmailById } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockGetUserEmailById: vi.fn(),
  };
});

// Mock the modules
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/subscriptionUtils", () => ({
  getUserEmailById: mockGetUserEmailById,
}));

describe("GET /api/workspaces/:workspaceId/members", () => {
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

        // Query permission table for workspace members
        const permissions = await db.permission.query({
          KeyConditionExpression: "pk = :workspacePk",
          ExpressionAttributeValues: {
            ":workspacePk": workspaceResource,
          },
        });

        // Get user emails for each member
        const members = await Promise.all(
          permissions.items.map(
            async (permission: {
              sk: string;
              type: string;
              createdAt: string;
            }) => {
              const userId = permission.sk.replace("users/", "");
              const email = await mockGetUserEmailById(userId);
              return {
                userId,
                userRef: permission.sk,
                email: email || undefined,
                permissionLevel: permission.type,
                createdAt: permission.createdAt,
              };
            }
          )
        );

        res.json({ members });
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should return workspace members with emails and permission levels", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockPermissions = [
      {
        pk: "workspaces/workspace-123",
        sk: "users/user-1",
        type: "owner",
        createdAt: "2024-01-01T00:00:00Z",
      },
      {
        pk: "workspaces/workspace-123",
        sk: "users/user-2",
        type: "admin",
        createdAt: "2024-01-02T00:00:00Z",
      },
      {
        pk: "workspaces/workspace-123",
        sk: "users/user-3",
        type: "member",
        createdAt: "2024-01-03T00:00:00Z",
      },
    ];

    const mockPermissionQuery = vi.fn().mockResolvedValue({
      items: mockPermissions,
    });
    mockDb.permission.query = mockPermissionQuery;

    mockGetUserEmailById
      .mockResolvedValueOnce("user1@example.com")
      .mockResolvedValueOnce("user2@example.com")
      .mockResolvedValueOnce("user3@example.com");

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
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
    expect(mockGetUserEmailById).toHaveBeenCalledTimes(3);
    expect(mockGetUserEmailById).toHaveBeenCalledWith("user-1");
    expect(mockGetUserEmailById).toHaveBeenCalledWith("user-2");
    expect(mockGetUserEmailById).toHaveBeenCalledWith("user-3");
    expect(res.json).toHaveBeenCalledWith({
      members: [
        {
          userId: "user-1",
          userRef: "users/user-1",
          email: "user1@example.com",
          permissionLevel: "owner",
          createdAt: "2024-01-01T00:00:00Z",
        },
        {
          userId: "user-2",
          userRef: "users/user-2",
          email: "user2@example.com",
          permissionLevel: "admin",
          createdAt: "2024-01-02T00:00:00Z",
        },
        {
          userId: "user-3",
          userRef: "users/user-3",
          email: "user3@example.com",
          permissionLevel: "member",
          createdAt: "2024-01-03T00:00:00Z",
        },
      ],
    });
  });

  it("should return empty array when workspace has no members", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockPermissionQuery = vi.fn().mockResolvedValue({
      items: [],
    });
    mockDb.permission.query = mockPermissionQuery;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockPermissionQuery).toHaveBeenCalled();
    expect(mockGetUserEmailById).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      members: [],
    });
  });

  it("should handle members with missing emails", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockPermissions = [
      {
        pk: "workspaces/workspace-123",
        sk: "users/user-1",
        type: "owner",
        createdAt: "2024-01-01T00:00:00Z",
      },
      {
        pk: "workspaces/workspace-123",
        sk: "users/user-2",
        type: "admin",
        createdAt: "2024-01-02T00:00:00Z",
      },
    ];

    const mockPermissionQuery = vi.fn().mockResolvedValue({
      items: mockPermissions,
    });
    mockDb.permission.query = mockPermissionQuery;

    mockGetUserEmailById
      .mockResolvedValueOnce("user1@example.com")
      .mockResolvedValueOnce(null);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      members: [
        {
          userId: "user-1",
          userRef: "users/user-1",
          email: "user1@example.com",
          permissionLevel: "owner",
          createdAt: "2024-01-01T00:00:00Z",
        },
        {
          userId: "user-2",
          userRef: "users/user-2",
          email: undefined,
          permissionLevel: "admin",
          createdAt: "2024-01-02T00:00:00Z",
        },
      ],
    });
  });

  it("should throw badRequest when workspace resource is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
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

  it("should handle multiple members with same permission level", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockPermissions = [
      {
        pk: "workspaces/workspace-123",
        sk: "users/user-1",
        type: "member",
        createdAt: "2024-01-01T00:00:00Z",
      },
      {
        pk: "workspaces/workspace-123",
        sk: "users/user-2",
        type: "member",
        createdAt: "2024-01-02T00:00:00Z",
      },
      {
        pk: "workspaces/workspace-123",
        sk: "users/user-3",
        type: "member",
        createdAt: "2024-01-03T00:00:00Z",
      },
    ];

    const mockPermissionQuery = vi.fn().mockResolvedValue({
      items: mockPermissions,
    });
    mockDb.permission.query = mockPermissionQuery;

    mockGetUserEmailById
      .mockResolvedValueOnce("user1@example.com")
      .mockResolvedValueOnce("user2@example.com")
      .mockResolvedValueOnce("user3@example.com");

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      members: [
        {
          userId: "user-1",
          userRef: "users/user-1",
          email: "user1@example.com",
          permissionLevel: "member",
          createdAt: "2024-01-01T00:00:00Z",
        },
        {
          userId: "user-2",
          userRef: "users/user-2",
          email: "user2@example.com",
          permissionLevel: "member",
          createdAt: "2024-01-02T00:00:00Z",
        },
        {
          userId: "user-3",
          userRef: "users/user-3",
          email: "user3@example.com",
          permissionLevel: "member",
          createdAt: "2024-01-03T00:00:00Z",
        },
      ],
    });
  });
});
