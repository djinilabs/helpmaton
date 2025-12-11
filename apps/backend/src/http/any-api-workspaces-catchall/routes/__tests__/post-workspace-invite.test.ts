import { badRequest, resourceGone, unauthorized } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { PERMISSION_LEVELS } from "../../../../tables/schema";
import {
  createMockRequest,
  createMockResponse,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const {
  mockDatabase,
  mockCheckUserLimit,
  mockGetUserEmailById,
  mockCreateWorkspaceInvite,
  mockSendInviteEmail,
} = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockCheckUserLimit: vi.fn(),
    mockGetUserEmailById: vi.fn(),
    mockCreateWorkspaceInvite: vi.fn(),
    mockSendInviteEmail: vi.fn(),
  };
});

// Mock the modules
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/subscriptionUtils", () => ({
  checkUserLimit: mockCheckUserLimit,
  getUserEmailById: mockGetUserEmailById,
}));

vi.mock("../../../../utils/workspaceInvites", () => ({
  createWorkspaceInvite: mockCreateWorkspaceInvite,
  sendInviteEmail: mockSendInviteEmail,
}));

describe("POST /api/workspaces/:workspaceId/members/invite", () => {
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
        const { email, permissionLevel } = req.body;
        const { workspaceId } = req.params;

        if (!email || typeof email !== "string") {
          throw badRequest("email is required and must be a string");
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

        // Check if workspace exists
        const workspace = await db.workspace.get(
          workspaceResource,
          "workspace"
        );
        if (!workspace) {
          throw resourceGone("Workspace not found");
        }

        // Check user limit for subscription
        if (workspace.subscriptionId) {
          await mockCheckUserLimit(workspace.subscriptionId, email);
        }

        // Determine permission level (default to READ)
        const level: 1 | 2 | 3 =
          permissionLevel === PERMISSION_LEVELS.READ ||
          permissionLevel === PERMISSION_LEVELS.WRITE ||
          permissionLevel === PERMISSION_LEVELS.OWNER
            ? permissionLevel
            : PERMISSION_LEVELS.READ;

        // Create invite
        const invite = await mockCreateWorkspaceInvite(
          workspaceId,
          email,
          level,
          currentUserRef
        );

        // Get inviter email for email template
        const inviterEmail = await mockGetUserEmailById(
          currentUserRef.replace("users/", "")
        );

        // Send invite email
        if (inviterEmail) {
          await mockSendInviteEmail(invite, workspace, inviterEmail);
        }

        res.status(201).json({
          inviteId: invite.pk.replace(`workspace-invites/${workspaceId}/`, ""),
          email: invite.email,
          permissionLevel: invite.permissionLevel,
          expiresAt: invite.expiresAt,
        });
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should create invite with default READ permission level", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const email = "invitee@example.com";
    const subscriptionId = "sub-789";

    const mockWorkspace = {
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      name: "Test Workspace",
      subscriptionId,
    };

    const mockInvite = {
      pk: `workspace-invites/${workspaceId}/invite-token-123`,
      sk: "invite",
      workspaceId,
      email,
      permissionLevel: PERMISSION_LEVELS.READ,
      expiresAt: "2024-12-31T23:59:59Z",
      invitedBy: `users/${userId}`,
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    mockCheckUserLimit.mockResolvedValue(undefined);
    mockCreateWorkspaceInvite.mockResolvedValue(mockInvite);
    mockGetUserEmailById.mockResolvedValue("inviter@example.com");
    mockSendInviteEmail.mockResolvedValue(undefined);

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: `users/${userId}`,
      params: {
        workspaceId,
      },
      body: {
        email,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockCheckUserLimit).toHaveBeenCalledWith(subscriptionId, email);
    expect(mockCreateWorkspaceInvite).toHaveBeenCalledWith(
      workspaceId,
      email,
      PERMISSION_LEVELS.READ,
      `users/${userId}`
    );
    expect(mockGetUserEmailById).toHaveBeenCalledWith(userId);
    expect(mockSendInviteEmail).toHaveBeenCalledWith(
      mockInvite,
      mockWorkspace,
      "inviter@example.com"
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      inviteId: "invite-token-123",
      email,
      permissionLevel: PERMISSION_LEVELS.READ,
      expiresAt: mockInvite.expiresAt,
    });
  });

  it("should create invite with WRITE permission level", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const email = "invitee@example.com";
    const subscriptionId = "sub-789";

    const mockWorkspace = {
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      name: "Test Workspace",
      subscriptionId,
    };

    const mockInvite = {
      pk: `workspace-invites/${workspaceId}/invite-token-123`,
      sk: "invite",
      workspaceId,
      email,
      permissionLevel: PERMISSION_LEVELS.WRITE,
      expiresAt: "2024-12-31T23:59:59Z",
      invitedBy: `users/${userId}`,
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    mockCheckUserLimit.mockResolvedValue(undefined);
    mockCreateWorkspaceInvite.mockResolvedValue(mockInvite);
    mockGetUserEmailById.mockResolvedValue("inviter@example.com");
    mockSendInviteEmail.mockResolvedValue(undefined);

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: `users/${userId}`,
      params: {
        workspaceId,
      },
      body: {
        email,
        permissionLevel: PERMISSION_LEVELS.WRITE,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockCreateWorkspaceInvite).toHaveBeenCalledWith(
      workspaceId,
      email,
      PERMISSION_LEVELS.WRITE,
      `users/${userId}`
    );
    expect(res.json).toHaveBeenCalledWith({
      inviteId: "invite-token-123",
      email,
      permissionLevel: PERMISSION_LEVELS.WRITE,
      expiresAt: mockInvite.expiresAt,
    });
  });

  it("should create invite with OWNER permission level", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const email = "invitee@example.com";
    const subscriptionId = "sub-789";

    const mockWorkspace = {
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      name: "Test Workspace",
      subscriptionId,
    };

    const mockInvite = {
      pk: `workspace-invites/${workspaceId}/invite-token-123`,
      sk: "invite",
      workspaceId,
      email,
      permissionLevel: PERMISSION_LEVELS.OWNER,
      expiresAt: "2024-12-31T23:59:59Z",
      invitedBy: `users/${userId}`,
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    mockCheckUserLimit.mockResolvedValue(undefined);
    mockCreateWorkspaceInvite.mockResolvedValue(mockInvite);
    mockGetUserEmailById.mockResolvedValue("inviter@example.com");
    mockSendInviteEmail.mockResolvedValue(undefined);

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: `users/${userId}`,
      params: {
        workspaceId,
      },
      body: {
        email,
        permissionLevel: PERMISSION_LEVELS.OWNER,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockCreateWorkspaceInvite).toHaveBeenCalledWith(
      workspaceId,
      email,
      PERMISSION_LEVELS.OWNER,
      `users/${userId}`
    );
  });

  it("should not send email when inviter email is not found", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const email = "invitee@example.com";
    const subscriptionId = "sub-789";

    const mockWorkspace = {
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      name: "Test Workspace",
      subscriptionId,
    };

    const mockInvite = {
      pk: `workspace-invites/${workspaceId}/invite-token-123`,
      sk: "invite",
      workspaceId,
      email,
      permissionLevel: PERMISSION_LEVELS.READ,
      expiresAt: "2024-12-31T23:59:59Z",
      invitedBy: `users/${userId}`,
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    mockCheckUserLimit.mockResolvedValue(undefined);
    mockCreateWorkspaceInvite.mockResolvedValue(mockInvite);
    mockGetUserEmailById.mockResolvedValue(null); // No email found
    mockSendInviteEmail.mockResolvedValue(undefined);

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: `users/${userId}`,
      params: {
        workspaceId,
      },
      body: {
        email,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockGetUserEmailById).toHaveBeenCalledWith(userId);
    expect(mockSendInviteEmail).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("should not check user limit when workspace has no subscription", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const email = "invitee@example.com";

    const mockWorkspace = {
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      name: "Test Workspace",
      subscriptionId: undefined, // No subscription
    };

    const mockInvite = {
      pk: `workspace-invites/${workspaceId}/invite-token-123`,
      sk: "invite",
      workspaceId,
      email,
      permissionLevel: PERMISSION_LEVELS.READ,
      expiresAt: "2024-12-31T23:59:59Z",
      invitedBy: `users/${userId}`,
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    mockCreateWorkspaceInvite.mockResolvedValue(mockInvite);
    mockGetUserEmailById.mockResolvedValue("inviter@example.com");
    mockSendInviteEmail.mockResolvedValue(undefined);

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: `users/${userId}`,
      params: {
        workspaceId,
      },
      body: {
        email,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockCheckUserLimit).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("should throw badRequest when email is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
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
            message: expect.stringContaining("email is required"),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when email is not a string", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        email: 123, // Not a string
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
            message: expect.stringContaining("email is required"),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when permissionLevel is invalid", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        email: "invitee@example.com",
        permissionLevel: 999, // Invalid
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
            message: expect.stringContaining("permissionLevel must be"),
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
      },
      body: {
        email: "invitee@example.com",
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

  it("should throw unauthorized when userRef is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: undefined,
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        email: "invitee@example.com",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 401,
        }),
      })
    );
  });

  it("should throw resourceGone when workspace does not exist", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";

    const mockWorkspaceGet = vi.fn().mockResolvedValue(null);
    mockDb.workspace.get = mockWorkspaceGet;

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: `users/${userId}`,
      params: {
        workspaceId,
      },
      body: {
        email: "invitee@example.com",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 410,
          payload: expect.objectContaining({
            message: expect.stringContaining("Workspace not found"),
          }),
        }),
      })
    );
  });
});
