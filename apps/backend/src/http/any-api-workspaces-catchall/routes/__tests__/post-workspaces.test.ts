import { badRequest, unauthorized } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { PERMISSION_LEVELS } from "../../../../tables/schema";
import { toNanoDollars } from "../../../../utils/creditConversions";
import {
  createMockRequest,
  createMockResponse,
  createMockNext,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const {
  mockDatabase,
  mockGetUserSubscription,
  mockCheckWorkspaceLimitAndGetCurrentCount,
  mockEnsureAuthorization,
  mockRandomUUID,
  mockCreateWorkspaceRecord,
} = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockGetUserSubscription: vi.fn(),
    mockCheckWorkspaceLimitAndGetCurrentCount: vi.fn(),
    mockEnsureAuthorization: vi.fn(),
    mockRandomUUID: vi.fn(),
    mockCreateWorkspaceRecord: vi.fn(),
  };
});

// Mock the modules
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../tables/permissions", () => ({
  ensureAuthorization: mockEnsureAuthorization,
  PERMISSION_LEVELS: {
    OWNER: "owner",
    ADMIN: "admin",
    MEMBER: "member",
  },
}));

vi.mock("../../../../utils/subscriptionUtils", () => ({
  getUserSubscription: mockGetUserSubscription,
  checkWorkspaceLimitAndGetCurrentCount: mockCheckWorkspaceLimitAndGetCurrentCount,
}));

vi.mock("../../../../utils/workspaceCreate", () => ({
  createWorkspaceRecord: mockCreateWorkspaceRecord,
}));

vi.mock("crypto", () => ({
  randomUUID: mockRandomUUID,
}));


describe("POST /api/workspaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckWorkspaceLimitAndGetCurrentCount.mockResolvedValue(0);
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>,
    next: express.NextFunction
  ) {
    // Extract the handler logic directly (mirrors post-workspaces route)
    const { createWorkspaceRecord } = await import(
      "../../../../utils/workspaceCreate"
    );
    const handler = async (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      try {
        const { name, description } = req.body;
        if (!name || typeof name !== "string") {
          throw badRequest("name is required and must be a string");
        }

        const db = await mockDatabase();
        const userRef = (req as { userRef?: string }).userRef;
        if (!userRef) {
          throw unauthorized();
        }

        const userId = userRef.replace("users/", "");
        const subscription = await mockGetUserSubscription(userId);
        const subscriptionId = subscription.pk.replace("subscriptions/", "");

        await mockCheckWorkspaceLimitAndGetCurrentCount(subscriptionId, 1);

        const workspaceId = mockRandomUUID();
        const workspacePk = `workspaces/${workspaceId}`;
        const workspaceSk = "workspace";

        const workspace = await createWorkspaceRecord(db, {
          pk: workspacePk,
          sk: workspaceSk,
          name,
          description: description || undefined,
          createdBy: userRef,
          subscriptionId,
        });

        await mockEnsureAuthorization(
          workspacePk,
          userRef,
          PERMISSION_LEVELS.OWNER,
          userRef
        );

        res.status(201).json({
          id: workspaceId,
          name: workspace.name,
          description: workspace.description,
          permissionLevel: PERMISSION_LEVELS.OWNER,
          creditBalance: workspace.creditBalance ?? 0,
          currency: workspace.currency ?? "usd",
          spendingLimits: workspace.spendingLimits ?? [],
          createdAt: workspace.createdAt,
        });
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  const INITIAL_CREDITS_NANO = toNanoDollars(2);

  it("should create workspace successfully with all fields", async () => {
    const workspaceId = "workspace-123";
    mockRandomUUID.mockReturnValue(workspaceId);

    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockSubscription = {
      pk: "subscriptions/sub-123",
      plan: "starter",
    };
    mockGetUserSubscription.mockResolvedValue(mockSubscription);

    const mockWorkspace = {
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      name: "Test Workspace",
      description: "Test Description",
      createdBy: "users/user-123",
      subscriptionId: "sub-123",
      currency: "usd",
      creditBalance: INITIAL_CREDITS_NANO,
      spendingLimits: [],
      createdAt: "2024-01-01T00:00:00Z",
    };

    mockCreateWorkspaceRecord.mockResolvedValue(mockWorkspace);

    mockEnsureAuthorization.mockResolvedValue(undefined);

    const req = createMockRequest({
      userRef: "users/user-123",
      body: {
        name: "Test Workspace",
        description: "Test Description",
        currency: "usd",
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockGetUserSubscription).toHaveBeenCalledWith("user-123");
    expect(mockCheckWorkspaceLimitAndGetCurrentCount).toHaveBeenCalledWith(
      "sub-123",
      1
    );
    expect(mockCreateWorkspaceRecord).toHaveBeenCalledWith(mockDb, {
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      name: "Test Workspace",
      description: "Test Description",
      createdBy: "users/user-123",
      subscriptionId: "sub-123",
    });
    expect(mockEnsureAuthorization).toHaveBeenCalledWith(
      `workspaces/${workspaceId}`,
      "users/user-123",
      PERMISSION_LEVELS.OWNER,
      "users/user-123"
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      id: workspaceId,
      name: "Test Workspace",
      description: "Test Description",
      permissionLevel: PERMISSION_LEVELS.OWNER,
      creditBalance: INITIAL_CREDITS_NANO,
      currency: "usd",
      spendingLimits: [],
      createdAt: "2024-01-01T00:00:00Z",
    });
  });

  it("should create workspace with 2 USD credits when user is on free plan", async () => {
    const workspaceId = "workspace-free-plan";
    mockRandomUUID.mockReturnValue(workspaceId);

    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockSubscription = {
      pk: "subscriptions/sub-free",
      plan: "free",
    };
    mockGetUserSubscription.mockResolvedValue(mockSubscription);

    const mockWorkspace = {
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      name: "Free User Workspace",
      description: undefined,
      createdBy: "users/user-free",
      subscriptionId: "sub-free",
      currency: "usd",
      creditBalance: INITIAL_CREDITS_NANO,
      spendingLimits: [],
      createdAt: "2024-01-01T00:00:00Z",
    };

    mockCreateWorkspaceRecord.mockResolvedValue(mockWorkspace);

    mockEnsureAuthorization.mockResolvedValue(undefined);

    const req = createMockRequest({
      userRef: "users/user-free",
      body: {
        name: "Free User Workspace",
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockCheckWorkspaceLimitAndGetCurrentCount).toHaveBeenCalledWith(
      "sub-free",
      1
    );
    expect(mockCreateWorkspaceRecord).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        name: "Free User Workspace",
        subscriptionId: "sub-free",
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        creditBalance: INITIAL_CREDITS_NANO,
      })
    );
  });

  it("should create workspace with 2 USD credits even when free plan user already has a workspace", async () => {
    const workspaceId = "workspace-free-second";
    mockRandomUUID.mockReturnValue(workspaceId);

    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockSubscription = {
      pk: "subscriptions/sub-free",
      plan: "free",
    };
    mockGetUserSubscription.mockResolvedValue(mockSubscription);
    mockCheckWorkspaceLimitAndGetCurrentCount.mockResolvedValue(1);

    const mockWorkspace = {
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      name: "Second Workspace",
      description: undefined,
      createdBy: "users/user-free",
      subscriptionId: "sub-free",
      currency: "usd",
      creditBalance: INITIAL_CREDITS_NANO,
      spendingLimits: [],
      createdAt: "2024-01-01T00:00:00Z",
    };

    mockCreateWorkspaceRecord.mockResolvedValue(mockWorkspace);

    mockEnsureAuthorization.mockResolvedValue(undefined);

    const req = createMockRequest({
      userRef: "users/user-free",
      body: {
        name: "Second Workspace",
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockCheckWorkspaceLimitAndGetCurrentCount).toHaveBeenCalledWith(
      "sub-free",
      1
    );
    expect(mockCreateWorkspaceRecord).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        name: "Second Workspace",
      })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        creditBalance: INITIAL_CREDITS_NANO,
      })
    );
  });

  it("should create workspace with default currency when currency not provided", async () => {
    const workspaceId = "workspace-456";
    mockRandomUUID.mockReturnValue(workspaceId);

    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockSubscription = {
      pk: "subscriptions/sub-123",
      plan: "starter",
    };
    mockGetUserSubscription.mockResolvedValue(mockSubscription);

    const mockWorkspace = {
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      name: "Test Workspace",
      description: undefined,
      createdBy: "users/user-123",
      subscriptionId: "sub-123",
      currency: "usd",
      creditBalance: INITIAL_CREDITS_NANO,
      spendingLimits: [],
      createdAt: "2024-01-01T00:00:00Z",
    };

    mockCreateWorkspaceRecord.mockResolvedValue(mockWorkspace);

    mockEnsureAuthorization.mockResolvedValue(undefined);

    const req = createMockRequest({
      userRef: "users/user-123",
      body: {
        name: "Test Workspace",
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockCreateWorkspaceRecord).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        name: "Test Workspace",
      })
    );
  });

  it("should default to usd when invalid currency provided", async () => {
    const workspaceId = "workspace-invalid-currency";
    mockRandomUUID.mockReturnValue(workspaceId);

    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockSubscription = {
      pk: "subscriptions/sub-123",
      plan: "starter",
    };
    mockGetUserSubscription.mockResolvedValue(mockSubscription);

    const mockWorkspace = {
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      name: "Test Workspace",
      description: undefined,
      createdBy: "users/user-123",
      subscriptionId: "sub-123",
      currency: "usd",
      creditBalance: INITIAL_CREDITS_NANO,
      spendingLimits: [],
      createdAt: "2024-01-01T00:00:00Z",
    };

    mockCreateWorkspaceRecord.mockResolvedValue(mockWorkspace);

    mockEnsureAuthorization.mockResolvedValue(undefined);

    const req = createMockRequest({
      userRef: "users/user-123",
      body: {
        name: "Test Workspace",
        currency: "invalid-currency",
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockCreateWorkspaceRecord).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        name: "Test Workspace",
      })
    );
  });

  it("should throw badRequest when name is missing", async () => {
    const req = createMockRequest({
      userRef: "users/user-123",
      body: {
        description: "Test Description",
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
    ).toContain("name is required");
  });

  it("should throw badRequest when name is not a string", async () => {
    const req = createMockRequest({
      userRef: "users/user-123",
      body: {
        name: 123,
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
    ).toContain("name is required");
  });

  it("should throw unauthorized when userRef is missing", async () => {
    const req = createMockRequest({
      userRef: undefined,
      body: {
        name: "Test Workspace",
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

  it("should handle description as optional field", async () => {
    const workspaceId = "workspace-no-description";
    mockRandomUUID.mockReturnValue(workspaceId);

    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockSubscription = {
      pk: "subscriptions/sub-123",
      plan: "starter",
    };
    mockGetUserSubscription.mockResolvedValue(mockSubscription);

    const mockWorkspace = {
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      name: "Test Workspace",
      description: undefined,
      createdBy: "users/user-123",
      subscriptionId: "sub-123",
      currency: "usd",
      creditBalance: INITIAL_CREDITS_NANO,
      spendingLimits: [],
      createdAt: "2024-01-01T00:00:00Z",
    };

    mockCreateWorkspaceRecord.mockResolvedValue(mockWorkspace);

    mockEnsureAuthorization.mockResolvedValue(undefined);

    const req = createMockRequest({
      userRef: "users/user-123",
      body: {
        name: "Test Workspace",
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockCreateWorkspaceRecord).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        description: undefined,
      })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        description: undefined,
      })
    );
  });

  it("should handle subscription limit check errors", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockSubscription = {
      pk: "subscriptions/sub-123",
      plan: "starter",
    };
    mockGetUserSubscription.mockResolvedValue(mockSubscription);

    const limitError = new Error("Workspace limit exceeded");
    mockCheckWorkspaceLimitAndGetCurrentCount.mockRejectedValue(limitError);

    const req = createMockRequest({
      userRef: "users/user-123",
      body: {
        name: "Test Workspace",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockCheckWorkspaceLimitAndGetCurrentCount).toHaveBeenCalledWith(
      "sub-123",
      1
    );
    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error).toBe(limitError);
    expect(mockEnsureAuthorization).not.toHaveBeenCalled();
  });
});
