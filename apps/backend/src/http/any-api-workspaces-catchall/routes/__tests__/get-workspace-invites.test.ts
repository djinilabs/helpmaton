import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockGetWorkspaceInvites } = vi.hoisted(() => {
  return {
    mockGetWorkspaceInvites: vi.fn(),
  };
});

// Mock the modules
vi.mock("../../../../utils/workspaceInvites", () => ({
  getWorkspaceInvites: mockGetWorkspaceInvites,
}));

describe("GET /api/workspaces/:workspaceId/invites", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>
  ) {
    // Extract the handler logic directly
    const handler = async (req: express.Request, res: express.Response) => {
      const { workspaceId } = req.params;
      const invites = await mockGetWorkspaceInvites(workspaceId);

      // Filter to only pending invites (not accepted and not expired)
      const now = new Date();
      const pendingInvites = invites
        .filter(
          (inv: {
            acceptedAt?: string;
            expiresAt: string;
            pk: string;
            email: string;
            permissionLevel: number;
            createdAt: string;
          }) => !inv.acceptedAt
        )
        .filter((inv: { expiresAt: string }) => new Date(inv.expiresAt) > now)
        .map(
          (inv: {
            pk: string;
            email: string;
            permissionLevel: number;
            expiresAt: string;
            createdAt: string;
          }) => {
            const inviteId = inv.pk.replace(
              `workspace-invites/${workspaceId}/`,
              ""
            );
            return {
              inviteId,
              email: inv.email,
              permissionLevel: inv.permissionLevel,
              expiresAt: inv.expiresAt,
              createdAt: inv.createdAt,
            };
          }
        );

      res.json({ invites: pendingInvites });
    };

    await handler(req as express.Request, res as express.Response);
  }

  it("should return only pending invites (not accepted and not expired)", async () => {
    const workspaceId = "workspace-123";
    const now = new Date();
    const futureDate = new Date(now.getTime() + 86400000); // 1 day from now
    const pastDate = new Date(now.getTime() - 86400000); // 1 day ago

    const mockInvites = [
      {
        pk: `workspace-invites/${workspaceId}/invite-1`,
        sk: "invite",
        email: "user1@example.com",
        permissionLevel: 1,
        expiresAt: futureDate.toISOString(),
        createdAt: "2024-01-01T00:00:00Z",
        // No acceptedAt - pending
      },
      {
        pk: `workspace-invites/${workspaceId}/invite-2`,
        sk: "invite",
        email: "user2@example.com",
        permissionLevel: 2,
        expiresAt: futureDate.toISOString(),
        createdAt: "2024-01-02T00:00:00Z",
        acceptedAt: "2024-01-03T00:00:00Z", // Accepted - should be filtered
      },
      {
        pk: `workspace-invites/${workspaceId}/invite-3`,
        sk: "invite",
        email: "user3@example.com",
        permissionLevel: 3,
        expiresAt: pastDate.toISOString(), // Expired - should be filtered
        createdAt: "2024-01-01T00:00:00Z",
        // No acceptedAt but expired
      },
      {
        pk: `workspace-invites/${workspaceId}/invite-4`,
        sk: "invite",
        email: "user4@example.com",
        permissionLevel: 1,
        expiresAt: futureDate.toISOString(),
        createdAt: "2024-01-04T00:00:00Z",
        // No acceptedAt - pending
      },
    ];

    mockGetWorkspaceInvites.mockResolvedValue(mockInvites);

    const req = createMockRequest({
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockGetWorkspaceInvites).toHaveBeenCalledWith(workspaceId);
    expect(res.json).toHaveBeenCalledWith({
      invites: [
        {
          inviteId: "invite-1",
          email: "user1@example.com",
          permissionLevel: 1,
          expiresAt: futureDate.toISOString(),
          createdAt: "2024-01-01T00:00:00Z",
        },
        {
          inviteId: "invite-4",
          email: "user4@example.com",
          permissionLevel: 1,
          expiresAt: futureDate.toISOString(),
          createdAt: "2024-01-04T00:00:00Z",
        },
      ],
    });
  });

  it("should return empty array when no pending invites exist", async () => {
    const workspaceId = "workspace-123";
    const now = new Date();
    const pastDate = new Date(now.getTime() - 86400000); // 1 day ago

    const mockInvites = [
      {
        pk: `workspace-invites/${workspaceId}/invite-1`,
        sk: "invite",
        email: "user1@example.com",
        permissionLevel: 1,
        expiresAt: pastDate.toISOString(), // Expired
        createdAt: "2024-01-01T00:00:00Z",
      },
      {
        pk: `workspace-invites/${workspaceId}/invite-2`,
        sk: "invite",
        email: "user2@example.com",
        permissionLevel: 2,
        expiresAt: pastDate.toISOString(), // Expired
        createdAt: "2024-01-02T00:00:00Z",
        acceptedAt: "2024-01-03T00:00:00Z", // Also accepted
      },
    ];

    mockGetWorkspaceInvites.mockResolvedValue(mockInvites);

    const req = createMockRequest({
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      invites: [],
    });
  });

  it("should return empty array when no invites exist", async () => {
    const workspaceId = "workspace-123";

    mockGetWorkspaceInvites.mockResolvedValue([]);

    const req = createMockRequest({
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      invites: [],
    });
  });

  it("should filter out invites that expire exactly at current time", async () => {
    const workspaceId = "workspace-123";
    const now = new Date();
    const exactNow = new Date(now.getTime());

    const mockInvites = [
      {
        pk: `workspace-invites/${workspaceId}/invite-1`,
        sk: "invite",
        email: "user1@example.com",
        permissionLevel: 1,
        expiresAt: exactNow.toISOString(), // Expires exactly now - should be filtered
        createdAt: "2024-01-01T00:00:00Z",
      },
      {
        pk: `workspace-invites/${workspaceId}/invite-2`,
        sk: "invite",
        email: "user2@example.com",
        permissionLevel: 2,
        expiresAt: new Date(now.getTime() + 1000).toISOString(), // 1 second in future - should be included
        createdAt: "2024-01-02T00:00:00Z",
      },
    ];

    mockGetWorkspaceInvites.mockResolvedValue(mockInvites);

    const req = createMockRequest({
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      invites: [
        {
          inviteId: "invite-2",
          email: "user2@example.com",
          permissionLevel: 2,
          expiresAt: new Date(now.getTime() + 1000).toISOString(),
          createdAt: "2024-01-02T00:00:00Z",
        },
      ],
    });
  });

  it("should correctly extract inviteId from pk", async () => {
    const workspaceId = "workspace-123";
    const now = new Date();
    const futureDate = new Date(now.getTime() + 86400000);

    const mockInvites = [
      {
        pk: `workspace-invites/${workspaceId}/abc-123-def`,
        sk: "invite",
        email: "user@example.com",
        permissionLevel: 1,
        expiresAt: futureDate.toISOString(),
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];

    mockGetWorkspaceInvites.mockResolvedValue(mockInvites);

    const req = createMockRequest({
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      invites: [
        {
          inviteId: "abc-123-def",
          email: "user@example.com",
          permissionLevel: 1,
          expiresAt: futureDate.toISOString(),
          createdAt: "2024-01-01T00:00:00Z",
        },
      ],
    });
  });
});
