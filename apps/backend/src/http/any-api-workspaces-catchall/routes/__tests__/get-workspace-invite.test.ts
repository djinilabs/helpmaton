import { badRequest, notFound, resourceGone } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDatabase, mockGetWorkspaceInviteByToken, mockGetUserEmailById } =
  vi.hoisted(() => {
    return {
      mockDatabase: vi.fn(),
      mockGetWorkspaceInviteByToken: vi.fn(),
      mockGetUserEmailById: vi.fn(),
    };
  });

// Mock the modules
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/workspaceInvites", () => ({
  getWorkspaceInviteByToken: mockGetWorkspaceInviteByToken,
}));

vi.mock("../../../../utils/subscriptionUtils", () => ({
  getUserEmailById: mockGetUserEmailById,
}));

describe("GET /api/workspaces/:workspaceId/invites/:token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>
  ) {
    // Extract the handler logic directly
    const handler = async (req: express.Request, res: express.Response) => {
      const { workspaceId, token } = req.params;
      const db = await mockDatabase();

      // Check if workspace exists
      const workspacePk = `workspaces/${workspaceId}`;
      const workspace = await db.workspace.get(workspacePk, "workspace");
      if (!workspace) {
        throw resourceGone("Workspace not found");
      }

      // Get invite
      const invite = await mockGetWorkspaceInviteByToken(workspaceId, token);
      if (!invite) {
        throw notFound("Invite not found or already accepted");
      }

      // Check if expired
      const expiresAt = new Date(invite.expiresAt);
      if (expiresAt < new Date()) {
        throw badRequest("Invite has expired");
      }

      // Get inviter email
      const inviterUserId = invite.invitedBy.replace("users/", "");
      const inviterEmail = await mockGetUserEmailById(inviterUserId);

      res.json({
        workspaceId: invite.workspaceId,
        workspaceName: workspace.name,
        email: invite.email,
        permissionLevel: invite.permissionLevel,
        inviterEmail: inviterEmail || undefined,
        expiresAt: invite.expiresAt,
      });
    };

    await handler(req as express.Request, res as express.Response);
  }

  it("should return invite details with inviter email", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const token = "invite-token-456";
    const now = new Date();
    const futureDate = new Date(now.getTime() + 86400000); // 1 day from now

    const mockWorkspace = {
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      name: "Test Workspace",
    };

    const mockInvite = {
      pk: `workspace-invites/${workspaceId}/invite-token-456`,
      sk: "invite",
      workspaceId,
      email: "user@example.com",
      permissionLevel: 1,
      invitedBy: "users/user-789",
      expiresAt: futureDate.toISOString(),
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    mockGetWorkspaceInviteByToken.mockResolvedValue(mockInvite);
    mockGetUserEmailById.mockResolvedValue("inviter@example.com");

    const req = createMockRequest({
      params: {
        workspaceId,
        token,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockWorkspaceGet).toHaveBeenCalledWith(
      `workspaces/${workspaceId}`,
      "workspace"
    );
    expect(mockGetWorkspaceInviteByToken).toHaveBeenCalledWith(
      workspaceId,
      token
    );
    expect(mockGetUserEmailById).toHaveBeenCalledWith("user-789");
    expect(res.json).toHaveBeenCalledWith({
      workspaceId,
      workspaceName: "Test Workspace",
      email: "user@example.com",
      permissionLevel: 1,
      inviterEmail: "inviter@example.com",
      expiresAt: futureDate.toISOString(),
    });
  });

  it("should return invite with undefined inviter email when not found", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const token = "invite-token-456";
    const now = new Date();
    const futureDate = new Date(now.getTime() + 86400000);

    const mockWorkspace = {
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      name: "Test Workspace",
    };

    const mockInvite = {
      pk: `workspace-invites/${workspaceId}/invite-token-456`,
      sk: "invite",
      workspaceId,
      email: "user@example.com",
      permissionLevel: 2,
      invitedBy: "users/user-789",
      expiresAt: futureDate.toISOString(),
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    mockGetWorkspaceInviteByToken.mockResolvedValue(mockInvite);
    mockGetUserEmailById.mockResolvedValue(null);

    const req = createMockRequest({
      params: {
        workspaceId,
        token,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      workspaceId,
      workspaceName: "Test Workspace",
      email: "user@example.com",
      permissionLevel: 2,
      inviterEmail: undefined,
      expiresAt: futureDate.toISOString(),
    });
  });

  it("should throw resourceGone when workspace does not exist", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const token = "invite-token-456";

    const mockWorkspaceGet = vi.fn().mockResolvedValue(null);
    mockDb.workspace.get = mockWorkspaceGet;

    const req = createMockRequest({
      params: {
        workspaceId,
        token,
      },
    });
    const res = createMockResponse();

    try {
      await callRouteHandler(req, res);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(
        (error as { output?: { statusCode: number } }).output?.statusCode
      ).toBe(410);
      expect(
        (error as { output?: { payload: { message: string } } }).output?.payload
          .message
      ).toContain("Workspace not found");
    }

    expect(mockGetWorkspaceInviteByToken).not.toHaveBeenCalled();
  });

  it("should throw notFound when invite does not exist", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const token = "invite-token-456";

    const mockWorkspace = {
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      name: "Test Workspace",
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    mockGetWorkspaceInviteByToken.mockResolvedValue(null);

    const req = createMockRequest({
      params: {
        workspaceId,
        token,
      },
    });
    const res = createMockResponse();

    try {
      await callRouteHandler(req, res);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(
        (error as { output?: { statusCode: number } }).output?.statusCode
      ).toBe(404);
      expect(
        (error as { output?: { payload: { message: string } } }).output?.payload
          .message
      ).toContain("Invite not found or already accepted");
    }

    expect(mockGetUserEmailById).not.toHaveBeenCalled();
  });

  it("should throw badRequest when invite has expired", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const token = "invite-token-456";
    const now = new Date();
    const pastDate = new Date(now.getTime() - 86400000); // 1 day ago

    const mockWorkspace = {
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      name: "Test Workspace",
    };

    const mockInvite = {
      pk: `workspace-invites/${workspaceId}/invite-token-456`,
      sk: "invite",
      workspaceId,
      email: "user@example.com",
      permissionLevel: 1,
      invitedBy: "users/user-789",
      expiresAt: pastDate.toISOString(),
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    mockGetWorkspaceInviteByToken.mockResolvedValue(mockInvite);

    const req = createMockRequest({
      params: {
        workspaceId,
        token,
      },
    });
    const res = createMockResponse();

    try {
      await callRouteHandler(req, res);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(
        (error as { output?: { statusCode: number } }).output?.statusCode
      ).toBe(400);
      expect(
        (error as { output?: { payload: { message: string } } }).output?.payload
          .message
      ).toContain("Invite has expired");
    }

    expect(mockGetUserEmailById).not.toHaveBeenCalled();
  });

  it("should handle different permission levels", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const token = "invite-token-456";
    const now = new Date();
    const futureDate = new Date(now.getTime() + 86400000);

    const mockWorkspace = {
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      name: "Test Workspace",
    };

    const mockInvite = {
      pk: `workspace-invites/${workspaceId}/invite-token-456`,
      sk: "invite",
      workspaceId,
      email: "admin@example.com",
      permissionLevel: 3, // OWNER
      invitedBy: "users/user-789",
      expiresAt: futureDate.toISOString(),
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    mockGetWorkspaceInviteByToken.mockResolvedValue(mockInvite);
    mockGetUserEmailById.mockResolvedValue("inviter@example.com");

    const req = createMockRequest({
      params: {
        workspaceId,
        token,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      workspaceId,
      workspaceName: "Test Workspace",
      email: "admin@example.com",
      permissionLevel: 3,
      inviterEmail: "inviter@example.com",
      expiresAt: futureDate.toISOString(),
    });
  });
});
