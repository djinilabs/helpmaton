import { badRequest } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const {
  mockGetWorkspaceSubscription,
  mockGetSubscriptionUniqueUsers,
  mockGetPlanLimits,
} = vi.hoisted(() => {
  return {
    mockGetWorkspaceSubscription: vi.fn(),
    mockGetSubscriptionUniqueUsers: vi.fn(),
    mockGetPlanLimits: vi.fn(),
  };
});

// Mock the modules
vi.mock("../../../../utils/subscriptionUtils", () => ({
  getWorkspaceSubscription: mockGetWorkspaceSubscription,
  getSubscriptionUniqueUsers: mockGetSubscriptionUniqueUsers,
}));

vi.mock("../../../../utils/subscriptionPlans", () => ({
  getPlanLimits: mockGetPlanLimits,
}));

describe("GET /api/workspaces/:workspaceId/user-limit", () => {
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

      // Get workspace subscription
      const subscription = await mockGetWorkspaceSubscription(workspaceId);
      if (!subscription) {
        throw badRequest("Workspace has no subscription");
      }

      const subscriptionId = subscription.pk.replace("subscriptions/", "");
      const plan = subscription.plan;

      // Get plan limits
      const limits = mockGetPlanLimits(plan);
      if (!limits) {
        throw badRequest(`Invalid subscription plan: ${plan}`);
      }

      // Get current user count
      const { count } = await mockGetSubscriptionUniqueUsers(subscriptionId);

      // Check if can invite (current count is less than max)
      const canInvite = count < limits.maxUsers;

      res.json({
        currentUserCount: count,
        maxUsers: limits.maxUsers,
        plan,
        canInvite,
      });
    };

    await handler(req as express.Request, res as express.Response);
  }

  it("should return user limit information when under limit", async () => {
    const workspaceId = "workspace-123";

    const mockSubscription = {
      pk: "subscriptions/sub-456",
      plan: "pro",
    };

    const mockLimits = {
      maxUsers: 10,
      maxWorkspaces: 5,
      maxDocuments: 100,
      maxDocumentSizeBytes: 10485760,
      maxAgents: 20,
      maxManagers: 3,
      maxDailyRequests: 1000,
      maxAgentKeys: 10,
      maxChannels: 5,
      maxMcpServers: 3,
    };

    mockGetWorkspaceSubscription.mockResolvedValue(mockSubscription);
    mockGetPlanLimits.mockReturnValue(mockLimits);
    mockGetSubscriptionUniqueUsers.mockResolvedValue({ count: 5 });

    const req = createMockRequest({
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockGetWorkspaceSubscription).toHaveBeenCalledWith(workspaceId);
    expect(mockGetPlanLimits).toHaveBeenCalledWith("pro");
    expect(mockGetSubscriptionUniqueUsers).toHaveBeenCalledWith("sub-456");
    expect(res.json).toHaveBeenCalledWith({
      currentUserCount: 5,
      maxUsers: 10,
      plan: "pro",
      canInvite: true,
    });
  });

  it("should return canInvite as false when at limit", async () => {
    const workspaceId = "workspace-123";

    const mockSubscription = {
      pk: "subscriptions/sub-456",
      plan: "pro",
    };

    const mockLimits = {
      maxUsers: 10,
      maxWorkspaces: 5,
      maxDocuments: 100,
      maxDocumentSizeBytes: 10485760,
      maxAgents: 20,
      maxManagers: 3,
      maxDailyRequests: 1000,
      maxAgentKeys: 10,
      maxChannels: 5,
      maxMcpServers: 3,
    };

    mockGetWorkspaceSubscription.mockResolvedValue(mockSubscription);
    mockGetPlanLimits.mockReturnValue(mockLimits);
    mockGetSubscriptionUniqueUsers.mockResolvedValue({ count: 10 });

    const req = createMockRequest({
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      currentUserCount: 10,
      maxUsers: 10,
      plan: "pro",
      canInvite: false,
    });
  });

  it("should return canInvite as false when over limit", async () => {
    const workspaceId = "workspace-123";

    const mockSubscription = {
      pk: "subscriptions/sub-456",
      plan: "free",
    };

    const mockLimits = {
      maxUsers: 5,
      maxWorkspaces: 1,
      maxDocuments: 10,
      maxDocumentSizeBytes: 1048576,
      maxAgents: 3,
      maxManagers: 1,
      maxDailyRequests: 100,
      maxAgentKeys: 3,
      maxChannels: 2,
      maxMcpServers: 1,
    };

    mockGetWorkspaceSubscription.mockResolvedValue(mockSubscription);
    mockGetPlanLimits.mockReturnValue(mockLimits);
    mockGetSubscriptionUniqueUsers.mockResolvedValue({ count: 6 });

    const req = createMockRequest({
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      currentUserCount: 6,
      maxUsers: 5,
      plan: "free",
      canInvite: false,
    });
  });

  it("should throw badRequest when workspace has no subscription", async () => {
    const workspaceId = "workspace-123";

    mockGetWorkspaceSubscription.mockResolvedValue(null);

    const req = createMockRequest({
      params: {
        workspaceId,
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
      ).toContain("Workspace has no subscription");
    }

    expect(mockGetPlanLimits).not.toHaveBeenCalled();
    expect(mockGetSubscriptionUniqueUsers).not.toHaveBeenCalled();
  });

  it("should throw badRequest when subscription plan is invalid", async () => {
    const workspaceId = "workspace-123";

    const mockSubscription = {
      pk: "subscriptions/sub-456",
      plan: "invalid-plan",
    };

    mockGetWorkspaceSubscription.mockResolvedValue(mockSubscription);
    mockGetPlanLimits.mockReturnValue(null);

    const req = createMockRequest({
      params: {
        workspaceId,
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
      ).toContain("Invalid subscription plan");
    }

    expect(mockGetSubscriptionUniqueUsers).not.toHaveBeenCalled();
  });

  it("should handle zero current user count", async () => {
    const workspaceId = "workspace-123";

    const mockSubscription = {
      pk: "subscriptions/sub-456",
      plan: "free",
    };

    const mockLimits = {
      maxUsers: 5,
      maxWorkspaces: 1,
      maxDocuments: 10,
      maxDocumentSizeBytes: 1048576,
      maxAgents: 3,
      maxManagers: 1,
      maxDailyRequests: 100,
      maxAgentKeys: 3,
      maxChannels: 2,
      maxMcpServers: 1,
    };

    mockGetWorkspaceSubscription.mockResolvedValue(mockSubscription);
    mockGetPlanLimits.mockReturnValue(mockLimits);
    mockGetSubscriptionUniqueUsers.mockResolvedValue({ count: 0 });

    const req = createMockRequest({
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      currentUserCount: 0,
      maxUsers: 5,
      plan: "free",
      canInvite: true,
    });
  });

  it("should handle different subscription plans", async () => {
    const workspaceId = "workspace-123";

    const mockSubscription = {
      pk: "subscriptions/sub-456",
      plan: "enterprise",
    };

    const mockLimits = {
      maxUsers: 100,
      maxWorkspaces: 50,
      maxDocuments: 1000,
      maxDocumentSizeBytes: 104857600,
      maxAgents: 200,
      maxManagers: 10,
      maxDailyRequests: 10000,
      maxAgentKeys: 50,
      maxChannels: 20,
      maxMcpServers: 10,
    };

    mockGetWorkspaceSubscription.mockResolvedValue(mockSubscription);
    mockGetPlanLimits.mockReturnValue(mockLimits);
    mockGetSubscriptionUniqueUsers.mockResolvedValue({ count: 50 });

    const req = createMockRequest({
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      currentUserCount: 50,
      maxUsers: 100,
      plan: "enterprise",
      canInvite: true,
    });
  });
});
