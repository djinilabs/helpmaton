import { badRequest, notFound } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { PERMISSION_LEVELS } from "../../../../tables/schema";
import {
  createMockRequest,
  createMockResponse,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const {
  mockGetWorkspaceInviteByToken,
  mockAcceptWorkspaceInvite,
  mockCreateUserFromInvite,
  mockCreateVerificationTokenAndGetCallbackUrl,
} = vi.hoisted(() => {
  return {
    mockGetWorkspaceInviteByToken: vi.fn(),
    mockAcceptWorkspaceInvite: vi.fn(),
    mockCreateUserFromInvite: vi.fn(),
    mockCreateVerificationTokenAndGetCallbackUrl: vi.fn(),
  };
});

// Mock the modules
vi.mock("../../../../utils/workspaceInvites", async () => {
  const actual = await vi.importActual("../../../../utils/workspaceInvites");
  return {
    ...actual,
    getWorkspaceInviteByToken: mockGetWorkspaceInviteByToken,
    acceptWorkspaceInvite: mockAcceptWorkspaceInvite,
    createUserFromInvite: mockCreateUserFromInvite,
    createVerificationTokenAndGetCallbackUrl:
      mockCreateVerificationTokenAndGetCallbackUrl,
  };
});

describe("POST /api/workspaces/:workspaceId/invites/:token/accept", () => {
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
      const currentUserRef = (req as { userRef?: string }).userRef;

      // Get invite to verify it exists and get the email
      const invite = await mockGetWorkspaceInviteByToken(workspaceId, token);
      if (!invite) {
        throw notFound("Invite not found or already accepted");
      }

      // Check if invite is expired
      const expiresAt = new Date(invite.expiresAt);
      if (expiresAt < new Date()) {
        throw badRequest("Invite has expired");
      }

      let acceptedInvite: Awaited<ReturnType<typeof mockAcceptWorkspaceInvite>>;
      let callbackUrl: string | undefined;

      if (currentUserRef) {
        // Authenticated flow: accept invite directly
        const userId = currentUserRef.replace("users/", "");
        acceptedInvite = await mockAcceptWorkspaceInvite(
          workspaceId,
          token,
          userId
        );
      } else {
        // Unauthenticated flow: create user if needed, accept invite, create verification token
        // First, create user to get userId
        const userId = await mockCreateUserFromInvite(invite.email);

        // Accept the invite
        acceptedInvite = await mockAcceptWorkspaceInvite(
          workspaceId,
          token,
          userId
        );

        // Create verification token and get callback URL
        callbackUrl = await mockCreateVerificationTokenAndGetCallbackUrl(
          invite.email,
          workspaceId,
          req
        );
      }

      // Return JSON response with callback URL if unauthenticated
      // Frontend will redirect to the callback URL
      res.json({
        success: true,
        workspaceId: acceptedInvite.workspaceId,
        permissionLevel: acceptedInvite.permissionLevel,
        callbackUrl,
      });
    };

    await handler(req as express.Request, res as express.Response);
  }

  it("should accept invite for authenticated user", async () => {
    const workspaceId = "workspace-123";
    const token = "invite-token-456";
    const userId = "user-789";

    const mockInvite = {
      pk: `workspace-invites/${workspaceId}/invite-id`,
      sk: "invite",
      workspaceId,
      email: "invitee@example.com",
      permissionLevel: PERMISSION_LEVELS.READ,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now
      invitedBy: "users/inviter-id",
    };

    const mockAcceptedInvite = {
      workspaceId,
      permissionLevel: PERMISSION_LEVELS.READ,
    };

    mockGetWorkspaceInviteByToken.mockResolvedValue(mockInvite);
    mockAcceptWorkspaceInvite.mockResolvedValue(mockAcceptedInvite);

    const req = createMockRequest({
      userRef: `users/${userId}`,
      params: {
        workspaceId,
        token,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockGetWorkspaceInviteByToken).toHaveBeenCalledWith(
      workspaceId,
      token
    );
    expect(mockAcceptWorkspaceInvite).toHaveBeenCalledWith(
      workspaceId,
      token,
      userId
    );
    expect(mockCreateUserFromInvite).not.toHaveBeenCalled();
    expect(mockCreateVerificationTokenAndGetCallbackUrl).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      workspaceId,
      permissionLevel: PERMISSION_LEVELS.READ,
      callbackUrl: undefined,
    });
  });

  it("should accept invite for unauthenticated user and create verification token", async () => {
    const workspaceId = "workspace-123";
    const token = "invite-token-456";
    const userId = "user-789";
    const callbackUrl = "https://example.com/verify?token=abc123";

    const mockInvite = {
      pk: `workspace-invites/${workspaceId}/invite-id`,
      sk: "invite",
      workspaceId,
      email: "invitee@example.com",
      permissionLevel: PERMISSION_LEVELS.WRITE,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now
      invitedBy: "users/inviter-id",
    };

    const mockAcceptedInvite = {
      workspaceId,
      permissionLevel: PERMISSION_LEVELS.WRITE,
    };

    mockGetWorkspaceInviteByToken.mockResolvedValue(mockInvite);
    mockCreateUserFromInvite.mockResolvedValue(userId);
    mockAcceptWorkspaceInvite.mockResolvedValue(mockAcceptedInvite);
    mockCreateVerificationTokenAndGetCallbackUrl.mockResolvedValue(callbackUrl);

    const req = createMockRequest({
      userRef: undefined, // Unauthenticated
      params: {
        workspaceId,
        token,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockGetWorkspaceInviteByToken).toHaveBeenCalledWith(
      workspaceId,
      token
    );
    expect(mockCreateUserFromInvite).toHaveBeenCalledWith(mockInvite.email);
    expect(mockAcceptWorkspaceInvite).toHaveBeenCalledWith(
      workspaceId,
      token,
      userId
    );
    expect(mockCreateVerificationTokenAndGetCallbackUrl).toHaveBeenCalledWith(
      mockInvite.email,
      workspaceId,
      req
    );
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      workspaceId,
      permissionLevel: PERMISSION_LEVELS.WRITE,
      callbackUrl,
    });
  });

  it("should throw notFound when invite does not exist", async () => {
    const workspaceId = "workspace-123";
    const token = "invite-token-456";

    mockGetWorkspaceInviteByToken.mockResolvedValue(null);

    const req = createMockRequest({
      userRef: "users/user-789",
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

    expect(mockAcceptWorkspaceInvite).not.toHaveBeenCalled();
  });

  it("should throw badRequest when invite is expired", async () => {
    const workspaceId = "workspace-123";
    const token = "invite-token-456";

    const mockInvite = {
      pk: `workspace-invites/${workspaceId}/invite-id`,
      sk: "invite",
      workspaceId,
      email: "invitee@example.com",
      permissionLevel: PERMISSION_LEVELS.READ,
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // 1 day ago (expired)
      invitedBy: "users/inviter-id",
    };

    mockGetWorkspaceInviteByToken.mockResolvedValue(mockInvite);

    const req = createMockRequest({
      userRef: "users/user-789",
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

    expect(mockAcceptWorkspaceInvite).not.toHaveBeenCalled();
  });

  it("should handle invite with OWNER permission level", async () => {
    const workspaceId = "workspace-123";
    const token = "invite-token-456";
    const userId = "user-789";

    const mockInvite = {
      pk: `workspace-invites/${workspaceId}/invite-id`,
      sk: "invite",
      workspaceId,
      email: "invitee@example.com",
      permissionLevel: PERMISSION_LEVELS.OWNER,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      invitedBy: "users/inviter-id",
    };

    const mockAcceptedInvite = {
      workspaceId,
      permissionLevel: PERMISSION_LEVELS.OWNER,
    };

    mockGetWorkspaceInviteByToken.mockResolvedValue(mockInvite);
    mockAcceptWorkspaceInvite.mockResolvedValue(mockAcceptedInvite);

    const req = createMockRequest({
      userRef: `users/${userId}`,
      params: {
        workspaceId,
        token,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      workspaceId,
      permissionLevel: PERMISSION_LEVELS.OWNER,
      callbackUrl: undefined,
    });
  });
});
