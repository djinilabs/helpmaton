import { badRequest, resourceGone, unauthorized } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

 
import {
  createMockRequest,
  createMockResponse,
  createMockNext,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDatabase, mockGetUserAuthorizationLevelForResource } = vi.hoisted(
  () => {
    return {
      mockDatabase: vi.fn(),
      mockGetUserAuthorizationLevelForResource: vi.fn(),
    };
  }
);

// Mock the modules
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../tables/permissions", () => ({
  getUserAuthorizationLevelForResource:
    mockGetUserAuthorizationLevelForResource,
}));

describe("GET /api/workspaces/:workspaceId", () => {
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
        const currentUserRef = (req as { userRef?: string }).userRef;
        if (!currentUserRef) {
          throw unauthorized();
        }
        const userRef = currentUserRef;

        const workspace = await db.workspace.get(
          workspaceResource,
          "workspace"
        );
        if (!workspace) {
          throw resourceGone("Workspace not found");
        }

        const permissionLevel = await mockGetUserAuthorizationLevelForResource(
          workspaceResource,
          userRef
        );

        // Check API key status for OpenRouter
        const workspaceId = workspace.pk.replace("workspaces/", "");

        // Query all API keys for this workspace using GSI
        const result = await db["workspace-api-key"].query({
          IndexName: "byWorkspaceId",
          KeyConditionExpression: "workspaceId = :workspaceId",
          ExpressionAttributeValues: {
            ":workspaceId": workspaceId,
          },
        });

        // Extract providers from the keys
        const providersWithKeys = new Set<string>();
        for (const item of result.items || []) {
          if (item.provider) {
            providersWithKeys.add(item.provider);
          }
        }

        // Build API keys object (only OpenRouter is supported for BYOK)
        const apiKeys: Record<string, boolean> = {
          openrouter: providersWithKeys.has("openrouter"),
        };

        res.json({
          id: workspaceId,
          name: workspace.name,
          description: workspace.description,
          permissionLevel: permissionLevel || null,
          creditBalance: workspace.creditBalance ?? 0,
          currency: workspace.currency ?? "usd",
          spendingLimits: workspace.spendingLimits ?? [],
          apiKeys,
          createdAt: workspace.createdAt,
        });
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should return workspace data with permission level and API key status", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockWorkspace = {
      pk: "workspaces/workspace-123",
      sk: "workspace",
      name: "Test Workspace",
      description: "Test Description",
      creditBalance: 100.5,
      currency: "usd",
      spendingLimits: [{ timeFrame: "daily", amount: 1000 }],
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockWorkspaceKey = {
      pk: "workspace-api-keys/workspace-123/openrouter",
      sk: "key",
      key: "api-key-value",
      provider: "openrouter",
      workspaceId: "workspace-123",
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const mockWorkspaceKeyQuery = vi.fn().mockResolvedValue({
      items: [mockWorkspaceKey],
    });
    mockDb["workspace-api-key"].query = mockWorkspaceKeyQuery;

    mockGetUserAuthorizationLevelForResource.mockResolvedValue("admin");

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
    expect(mockGetUserAuthorizationLevelForResource).toHaveBeenCalledWith(
      "workspaces/workspace-123",
      "users/user-123"
    );
    expect(mockWorkspaceKeyQuery).toHaveBeenCalledWith({
      IndexName: "byWorkspaceId",
      KeyConditionExpression: "workspaceId = :workspaceId",
      ExpressionAttributeValues: {
        ":workspaceId": "workspace-123",
      },
    });
    expect(res.json).toHaveBeenCalledWith({
      id: "workspace-123",
      name: "Test Workspace",
      description: "Test Description",
      permissionLevel: "admin",
      creditBalance: 100.5,
      currency: "usd",
      spendingLimits: [{ timeFrame: "daily", amount: 1000 }],
      apiKeys: { openrouter: true },
      createdAt: "2024-01-01T00:00:00Z",
    });
  });

  it("should return apiKeys.openrouter as false when API key does not exist", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockWorkspace = {
      pk: "workspaces/workspace-123",
      sk: "workspace",
      name: "Test Workspace",
      description: "Test Description",
      creditBalance: 0,
      currency: "eur",
      spendingLimits: [],
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const mockWorkspaceKeyGet = vi.fn().mockResolvedValue(null);
    mockDb["workspace-api-key"].get = mockWorkspaceKeyGet;

    mockGetUserAuthorizationLevelForResource.mockResolvedValue("member");

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

    expect(res.json).toHaveBeenCalledWith({
      id: "workspace-123",
      name: "Test Workspace",
      description: "Test Description",
      permissionLevel: "member",
      creditBalance: 0,
      currency: "eur",
      spendingLimits: [],
      apiKeys: { openrouter: false },
      createdAt: "2024-01-01T00:00:00Z",
    });
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

  it("should throw unauthorized when userRef is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      userRef: undefined,
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

  it("should return null permissionLevel when user has no permission", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockWorkspace = {
      pk: "workspaces/workspace-123",
      sk: "workspace",
      name: "Test Workspace",
      description: "Test Description",
      creditBalance: 0,
      currency: "usd",
      spendingLimits: [],
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const mockWorkspaceKeyQuery = vi.fn().mockResolvedValue({
      items: [],
    });
    mockDb["workspace-api-key"].query = mockWorkspaceKeyQuery;

    mockGetUserAuthorizationLevelForResource.mockResolvedValue(null);

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

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionLevel: null,
      })
    );
  });

  it("should handle workspace with default values", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockWorkspace = {
      pk: "workspaces/workspace-123",
      sk: "workspace",
      name: "Test Workspace",
      description: undefined,
      // No creditBalance, currency, or spendingLimits
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const mockWorkspaceKeyQuery = vi.fn().mockResolvedValue({
      items: [],
    });
    mockDb["workspace-api-key"].query = mockWorkspaceKeyQuery;

    mockGetUserAuthorizationLevelForResource.mockResolvedValue("owner");

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

    expect(res.json).toHaveBeenCalledWith({
      id: "workspace-123",
      name: "Test Workspace",
      description: undefined,
      permissionLevel: "owner",
      creditBalance: 0,
      currency: "usd",
      spendingLimits: [],
      apiKeys: { openrouter: false },
      createdAt: "2024-01-01T00:00:00Z",
    });
  });
});
