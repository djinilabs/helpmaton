import { badRequest, notFound } from "@hapi/boom";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const {
  mockDatabase,
  mockGetUserByEmail,
  mockGetUserEmailById,
  mockCreateFreeSubscription,
  mockSendEmail,
  mockEnsureAuthorization,
} = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockGetUserByEmail: vi.fn(),
    mockGetUserEmailById: vi.fn(),
    mockCreateFreeSubscription: vi.fn(),
    mockSendEmail: vi.fn(),
    mockEnsureAuthorization: vi.fn(),
  };
});

// Mock the database module
vi.mock("../../tables/database", () => ({
  database: mockDatabase,
}));

// Mock subscriptionUtils
vi.mock("../subscriptionUtils", () => ({
  getUserByEmail: mockGetUserByEmail,
  getUserEmailById: mockGetUserEmailById,
  createFreeSubscription: mockCreateFreeSubscription,
}));

// Mock send-email
vi.mock("../../send-email", () => ({
  sendEmail: mockSendEmail,
}));

// Mock permissions
vi.mock("../../tables/permissions", () => ({
  ensureAuthorization: mockEnsureAuthorization,
}));

// Import after mocks are set up
import type {
  DatabaseSchema,
  WorkspaceInviteRecord,
} from "../../tables/schema";
import { PERMISSION_LEVELS } from "../../tables/schema";
import {
  createWorkspaceInvite,
  getWorkspaceInviteByToken,
  acceptWorkspaceInvite,
  deleteWorkspaceInvite,
} from "../workspaceInvites";

describe("workspaceInvites", () => {
  let mockDb: DatabaseSchema;
  let mockGet: ReturnType<typeof vi.fn>;
  let mockCreate: ReturnType<typeof vi.fn>;
  let mockUpdate: ReturnType<typeof vi.fn>;
  let mockDelete: ReturnType<typeof vi.fn>;
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    mockGet = vi.fn();
    mockCreate = vi.fn();
    mockUpdate = vi.fn();
    mockDelete = vi.fn();
    mockQuery = vi.fn();

    mockDb = {
      permission: {
        get: mockGet,
      },
      "workspace-invite": {
        create: mockCreate,
        get: mockGet,
        update: mockUpdate,
        delete: mockDelete,
        query: mockQuery,
      },
      "next-auth": {
        create: mockCreate,
      },
      workspace: {
        get: mockGet,
      },
    } as unknown as DatabaseSchema;

    mockDatabase.mockResolvedValue(mockDb);
  });

  describe("createWorkspaceInvite", () => {
    it("should create invite with valid permission level", async () => {
      const workspaceId = "workspace-123";
      const email = "user@example.com";
      const permissionLevel = PERMISSION_LEVELS.READ;
      const invitedBy = "users/inviter-123";

      mockGetUserByEmail.mockResolvedValue(undefined);
      mockQuery.mockResolvedValue({ items: [] });

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const mockInvite: WorkspaceInviteRecord = {
        pk: "workspace-invites/workspace-123/invite-id",
        sk: "invite",
        workspaceId,
        email: email.toLowerCase(),
        token: "mock-token",
        permissionLevel,
        invitedBy,
        expiresAt: expiresAt.toISOString(),
        expires: Math.floor(expiresAt.getTime() / 1000),
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockCreate.mockResolvedValue(mockInvite);

      const result = await createWorkspaceInvite(
        workspaceId,
        email,
        permissionLevel,
        invitedBy
      );

      expect(result).toBeDefined();
      expect(mockCreate).toHaveBeenCalled();
      const createCall = mockCreate.mock.calls[0][0];
      expect(createCall.email).toBe(email.toLowerCase());
      expect(createCall.permissionLevel).toBe(permissionLevel);
    });

    it("should normalize email to lowercase", async () => {
      const workspaceId = "workspace-123";
      const email = "User@Example.COM";
      const permissionLevel = PERMISSION_LEVELS.READ;
      const invitedBy = "users/inviter-123";

      mockGetUserByEmail.mockResolvedValue(undefined);
      mockQuery.mockResolvedValue({ items: [] });

      const mockInvite: WorkspaceInviteRecord = {
        pk: "workspace-invites/workspace-123/invite-id",
        sk: "invite",
        workspaceId,
        email: "user@example.com",
        token: "mock-token",
        permissionLevel,
        invitedBy,
        expiresAt: new Date().toISOString(),
        expires: Math.floor(Date.now() / 1000) + 604800,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockCreate.mockResolvedValue(mockInvite);

      await createWorkspaceInvite(
        workspaceId,
        email,
        permissionLevel,
        invitedBy
      );

      const createCall = mockCreate.mock.calls[0][0];
      expect(createCall.email).toBe("user@example.com");
    });

    it("should throw error for invalid permission level", async () => {
      const workspaceId = "workspace-123";
      const email = "user@example.com";
      const invalidPermissionLevel = 0; // Below READ
      const invitedBy = "users/inviter-123";

      await expect(
        createWorkspaceInvite(
          workspaceId,
          email,
          invalidPermissionLevel,
          invitedBy
        )
      ).rejects.toThrow(badRequest("Invalid permission level"));
    });

    it("should throw error if user already has access", async () => {
      const workspaceId = "workspace-123";
      const email = "user@example.com";
      const permissionLevel = PERMISSION_LEVELS.READ;
      const invitedBy = "users/inviter-123";

      mockGetUserByEmail.mockResolvedValue({
        userId: "user-123",
        email: "user@example.com",
      });

      mockGet.mockResolvedValue({
        pk: "workspaces/workspace-123",
        sk: "users/user-123",
        permissionLevel: PERMISSION_LEVELS.READ,
      });

      await expect(
        createWorkspaceInvite(workspaceId, email, permissionLevel, invitedBy)
      ).rejects.toThrow(
        badRequest("User already has access to this workspace")
      );
    });

    it("should throw error if pending invite exists", async () => {
      const workspaceId = "workspace-123";
      const email = "user@example.com";
      const permissionLevel = PERMISSION_LEVELS.READ;
      const invitedBy = "users/inviter-123";

      mockGetUserByEmail.mockResolvedValue(undefined);

      const existingInvite: WorkspaceInviteRecord = {
        pk: "workspace-invites/workspace-123/invite-id",
        sk: "invite",
        workspaceId,
        email: "user@example.com",
        token: "existing-token",
        permissionLevel: PERMISSION_LEVELS.READ,
        invitedBy: "users/other-user",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        expires: Math.floor(Date.now() / 1000) + 86400,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockQuery.mockResolvedValue({ items: [existingInvite] });

      await expect(
        createWorkspaceInvite(workspaceId, email, permissionLevel, invitedBy)
      ).rejects.toThrow(
        badRequest("User already has a pending invite for this workspace")
      );
    });
  });

  describe("getWorkspaceInviteByToken", () => {
    it("should return invite for valid token", async () => {
      const workspaceId = "workspace-123";
      const token = "valid-token";

      const mockInvite: WorkspaceInviteRecord = {
        pk: "workspace-invites/workspace-123/invite-id",
        sk: "invite",
        workspaceId,
        email: "user@example.com",
        token,
        permissionLevel: PERMISSION_LEVELS.READ,
        invitedBy: "users/inviter-123",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        expires: Math.floor(Date.now() / 1000) + 86400,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockQuery.mockResolvedValue({ items: [mockInvite] });

      const result = await getWorkspaceInviteByToken(workspaceId, token);

      expect(result).toEqual(mockInvite);
    });

    it("should return undefined for invalid token", async () => {
      const workspaceId = "workspace-123";
      const token = "invalid-token";

      mockQuery.mockResolvedValue({ items: [] });

      const result = await getWorkspaceInviteByToken(workspaceId, token);

      expect(result).toBeUndefined();
    });
  });

  describe("acceptWorkspaceInvite", () => {
    it("should accept invite and grant permission", async () => {
      const workspaceId = "workspace-123";
      const token = "valid-token";
      const userId = "user-123";

      const mockInvite: WorkspaceInviteRecord = {
        pk: "workspace-invites/workspace-123/invite-id",
        sk: "invite",
        workspaceId,
        email: "user@example.com",
        token,
        permissionLevel: PERMISSION_LEVELS.READ,
        invitedBy: "users/inviter-123",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        expires: Math.floor(Date.now() / 1000) + 86400,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      // getWorkspaceInviteByToken queries and filters
      mockQuery.mockResolvedValue({ items: [mockInvite] });
      mockGetUserEmailById.mockResolvedValue("user@example.com");
      mockEnsureAuthorization.mockResolvedValue(undefined);
      mockUpdate.mockResolvedValue({
        ...mockInvite,
        acceptedAt: new Date().toISOString(),
      });

      const result = await acceptWorkspaceInvite(workspaceId, token, userId);

      expect(result).toBeDefined();
      expect(mockEnsureAuthorization).toHaveBeenCalled();
      expect(mockUpdate).toHaveBeenCalled();
    });

    it("should throw error for expired invite", async () => {
      const workspaceId = "workspace-123";
      const token = "expired-token";
      const userId = "user-123";

      const expiredInvite: WorkspaceInviteRecord = {
        pk: "workspace-invites/workspace-123/invite-id",
        sk: "invite",
        workspaceId,
        email: "user@example.com",
        token,
        permissionLevel: PERMISSION_LEVELS.READ,
        invitedBy: "users/inviter-123",
        expiresAt: new Date(Date.now() - 86400000).toISOString(),
        expires: Math.floor(Date.now() / 1000) - 86400,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      // getWorkspaceInviteByToken will find it (not filtered by acceptedAt)
      mockQuery.mockResolvedValue({ items: [expiredInvite] });

      await expect(
        acceptWorkspaceInvite(workspaceId, token, userId)
      ).rejects.toThrow(badRequest("Invite has expired"));
    });

    it("should throw error for already accepted invite", async () => {
      const workspaceId = "workspace-123";
      const token = "accepted-token";
      const userId = "user-123";

      const acceptedInvite: WorkspaceInviteRecord = {
        pk: "workspace-invites/workspace-123/invite-id",
        sk: "invite",
        workspaceId,
        email: "user@example.com",
        token,
        permissionLevel: PERMISSION_LEVELS.READ,
        invitedBy: "users/inviter-123",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        expires: Math.floor(Date.now() / 1000) + 86400,
        acceptedAt: new Date().toISOString(),
        version: 1,
        createdAt: new Date().toISOString(),
      };

      // getWorkspaceInviteByToken filters out invites with acceptedAt
      // So it won't find the invite
      mockQuery.mockResolvedValue({ items: [acceptedInvite] });

      await expect(
        acceptWorkspaceInvite(workspaceId, token, userId)
      ).rejects.toThrow(notFound("Invite not found or already accepted"));
    });
  });

  describe("deleteWorkspaceInvite", () => {
    it("should delete invite successfully", async () => {
      const workspaceId = "workspace-123";
      const inviteId = "invite-id";

      mockDelete.mockResolvedValue({});

      await deleteWorkspaceInvite(workspaceId, inviteId);

      expect(mockDelete).toHaveBeenCalledWith(
        `workspace-invites/${workspaceId}/${inviteId}`,
        "invite"
      );
    });

    it("should throw error if invite not found", async () => {
      const workspaceId = "workspace-123";
      const inviteId = "non-existent-invite";

      mockDelete.mockRejectedValue(new Error("Item not found"));

      await expect(
        deleteWorkspaceInvite(workspaceId, inviteId)
      ).rejects.toThrow();
    });
  });
});




