import { badRequest } from "@hapi/boom";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDatabase, mockIsFreePlanExpired } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockIsFreePlanExpired: vi.fn(),
  };
});

// Mock the database module
vi.mock("../../tables/database", () => ({
  database: mockDatabase,
}));

// Mock subscriptionPlans
vi.mock("../subscriptionPlans", () => ({
  isFreePlanExpired: mockIsFreePlanExpired,
}));

// Import after mocks are set up
import type {
  DatabaseSchema,
  SubscriptionRecord,
  WorkspaceRecord,
} from "../../tables/schema";
import {
  checkFreePlanExpiration,
  ensureWorkspaceSubscription,
  associateWorkspaceWithSubscription,
} from "../subscriptionUtils";

describe("subscriptionEdgeCases", () => {
  let mockDb: DatabaseSchema;
  let mockGet: ReturnType<typeof vi.fn>;
  let mockUpdate: ReturnType<typeof vi.fn>;
  let mockGetSubscriptionById: ReturnType<typeof vi.fn>;
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    // Setup mock get
    mockGet = vi.fn();

    // Setup mock update
    mockUpdate = vi.fn().mockResolvedValue({});

    // Setup mock getSubscriptionById
    mockGetSubscriptionById = vi.fn();

    // Setup mock query
    mockQuery = vi.fn().mockResolvedValue({ items: [] });

    // Setup mock database
    mockDb = {
      workspace: {
        get: mockGet,
        update: mockUpdate,
      },
      subscription: {
        get: mockGetSubscriptionById,
        query: mockQuery,
      },
    } as unknown as DatabaseSchema;

    mockDatabase.mockResolvedValue(mockDb);
    mockIsFreePlanExpired.mockReturnValue(false); // Free plans never expire
  });

  describe("checkFreePlanExpiration", () => {
    it("should not throw for non-free plans", async () => {
      const workspace: WorkspaceRecord = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Test Workspace",
        subscriptionId: "sub-123",
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "starter",
        status: "active",
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockGet.mockResolvedValue(workspace);
      mockGetSubscriptionById.mockResolvedValue(subscription);

      await expect(
        checkFreePlanExpiration("workspace-123")
      ).resolves.not.toThrow();
    });

    it("should not throw for free plans (they never expire)", async () => {
      const workspace: WorkspaceRecord = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Test Workspace",
        subscriptionId: "sub-123",
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "free",
        status: "active",
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockGet.mockResolvedValue(workspace);
      mockGetSubscriptionById.mockResolvedValue(subscription);

      await expect(
        checkFreePlanExpiration("workspace-123")
      ).resolves.not.toThrow();
    });

    it("should not throw when workspace has no subscription", async () => {
      const workspace: WorkspaceRecord = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Test Workspace",
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockGet.mockResolvedValue(workspace);

      await expect(
        checkFreePlanExpiration("workspace-123")
      ).resolves.not.toThrow();
    });

    it("should throw error if free plan has expired (edge case)", async () => {
      const workspace: WorkspaceRecord = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Test Workspace",
        subscriptionId: "sub-123",
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "free",
        status: "active",
        expiresAt: new Date().toISOString(),
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockGet.mockResolvedValue(workspace);
      mockGetSubscriptionById.mockResolvedValue(subscription);
      mockIsFreePlanExpired.mockReturnValue(true); // Override for this test

      await expect(checkFreePlanExpiration("workspace-123")).rejects.toThrow(
        "Your free plan has expired"
      );
    });
  });

  describe("ensureWorkspaceSubscription", () => {
    it("should return existing subscription ID when workspace already has subscription", async () => {
      const workspace: WorkspaceRecord = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Test Workspace",
        subscriptionId: "sub-123",
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "starter",
        status: "active",
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockGet.mockResolvedValue(workspace);
      mockGetSubscriptionById.mockResolvedValue(subscription);

      const result = await ensureWorkspaceSubscription(
        "workspace-123",
        "user-123"
      );

      expect(result).toBe("sub-123");
    });

    it("should auto-associate workspace with user's subscription when missing", async () => {
      const userSubscription: SubscriptionRecord = {
        pk: "subscriptions/sub-456",
        sk: "subscription",
        userId: "user-123",
        plan: "free",
        status: "active",
        version: 1,
        createdAt: new Date().toISOString(),
      };

      const workspace: WorkspaceRecord = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Test Workspace",
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      const associatedWorkspace: WorkspaceRecord = {
        ...workspace,
        subscriptionId: "sub-456",
      };

      // Call sequence:
      // 1. getWorkspaceSubscription: db.workspace.get -> workspace (no subscriptionId)
      // 2. getUserSubscription: db.subscription.query -> userSubscription
      // 3. associateWorkspaceWithSubscription: db.workspace.get -> workspace
      // 4. getWorkspaceSubscription (after association): db.workspace.get -> associatedWorkspace
      // 5. getSubscriptionById: db.subscription.get -> userSubscription
      mockGet
        .mockResolvedValueOnce(workspace) // getWorkspaceSubscription first call
        .mockResolvedValueOnce(workspace) // associateWorkspaceWithSubscription call
        .mockResolvedValueOnce(associatedWorkspace); // getWorkspaceSubscription second call
      mockQuery.mockResolvedValue({ items: [userSubscription] });
      mockGetSubscriptionById.mockResolvedValue(userSubscription);
      mockUpdate.mockResolvedValue(associatedWorkspace);

      const result = await ensureWorkspaceSubscription(
        "workspace-123",
        "user-123"
      );

      expect(result).toBe("sub-456");
      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          IndexName: "byUserId",
          KeyConditionExpression: "userId = :userId",
        })
      );
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: "sub-456",
        })
      );
    });

    it("should throw error if association fails", async () => {
      const userSubscription: SubscriptionRecord = {
        pk: "subscriptions/sub-456",
        sk: "subscription",
        userId: "user-123",
        plan: "free",
        status: "active",
        version: 1,
        createdAt: new Date().toISOString(),
      };

      const workspace: WorkspaceRecord = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Test Workspace",
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      // First call: workspace has no subscriptionId (getWorkspaceSubscription)
      // Second call: workspace for association (associateWorkspaceWithSubscription)
      // Third call: workspace still has no subscriptionId (getWorkspaceSubscription after association)
      mockGet.mockResolvedValue(workspace);
      mockQuery.mockResolvedValue({ items: [userSubscription] });
      // First call: no subscription (workspace has no subscriptionId)
      // Second call: still no subscription (association failed, subscriptionId still missing)
      mockGetSubscriptionById.mockResolvedValue(undefined);
      mockUpdate.mockResolvedValue(workspace); // Update succeeds but subscriptionId still missing

      await expect(
        ensureWorkspaceSubscription("workspace-123", "user-123")
      ).rejects.toThrow(
        badRequest("Failed to associate workspace with subscription")
      );
    });
  });

  describe("associateWorkspaceWithSubscription", () => {
    it("should associate workspace with subscription", async () => {
      const workspace: WorkspaceRecord = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Test Workspace",
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      const updatedWorkspace: WorkspaceRecord = {
        ...workspace,
        subscriptionId: "sub-123",
      };

      mockGet.mockResolvedValue(workspace);
      mockUpdate.mockResolvedValue(updatedWorkspace);

      await associateWorkspaceWithSubscription("workspace-123", "sub-123");

      expect(mockGet).toHaveBeenCalledWith(
        "workspaces/workspace-123",
        "workspace"
      );
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: "sub-123",
        })
      );
    });

    it("should throw error if workspace not found", async () => {
      mockGet.mockResolvedValue(undefined);

      await expect(
        associateWorkspaceWithSubscription("workspace-123", "sub-123")
      ).rejects.toThrow(badRequest("Workspace not found"));
    });

    it("should update existing workspace subscription", async () => {
      const workspace: WorkspaceRecord = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Test Workspace",
        subscriptionId: "sub-456", // Existing subscription
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      const updatedWorkspace: WorkspaceRecord = {
        ...workspace,
        subscriptionId: "sub-123", // New subscription
      };

      mockGet.mockResolvedValue(workspace);
      mockUpdate.mockResolvedValue(updatedWorkspace);

      await associateWorkspaceWithSubscription("workspace-123", "sub-123");

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: "sub-123",
        })
      );
    });
  });
});






