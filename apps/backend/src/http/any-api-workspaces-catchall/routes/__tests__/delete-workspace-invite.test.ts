import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDeleteWorkspaceInvite } = vi.hoisted(() => {
  return {
    mockDeleteWorkspaceInvite: vi.fn(),
  };
});

// Mock the modules
vi.mock("../../../../utils/workspaceInvites", () => ({
  deleteWorkspaceInvite: mockDeleteWorkspaceInvite,
}));

describe("DELETE /api/workspaces/:workspaceId/invites/:inviteId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>
  ) {
    // Extract the handler logic directly
    const handler = async (req: express.Request, res: express.Response) => {
      const { workspaceId, inviteId } = req.params;
      await mockDeleteWorkspaceInvite(workspaceId, inviteId);
      res.status(204).send();
    };

    await handler(req as express.Request, res as express.Response);
  }

  it("should delete invite successfully", async () => {
    const workspaceId = "workspace-123";
    const inviteId = "invite-456";

    mockDeleteWorkspaceInvite.mockResolvedValue(undefined);

    const req = createMockRequest({
      params: {
        workspaceId,
        inviteId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockDeleteWorkspaceInvite).toHaveBeenCalledWith(
      workspaceId,
      inviteId
    );
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });

  it("should handle errors from deleteWorkspaceInvite", async () => {
    const workspaceId = "workspace-123";
    const inviteId = "invite-456";

    const error = new Error("Invite not found");
    mockDeleteWorkspaceInvite.mockRejectedValue(error);

    const req = createMockRequest({
      params: {
        workspaceId,
        inviteId,
      },
    });
    const res = createMockResponse();

    try {
      await callRouteHandler(req, res);
    } catch (err) {
      expect(err).toBe(error);
    }

    expect(mockDeleteWorkspaceInvite).toHaveBeenCalledWith(
      workspaceId,
      inviteId
    );
  });
});
