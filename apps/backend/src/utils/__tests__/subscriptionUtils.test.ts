import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDatabase, mockGetPlanLimits } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockGetPlanLimits: vi.fn(),
  };
});

// Mock the database module
vi.mock("../../tables/database", () => ({
  database: mockDatabase,
}));

// Mock subscription plans
vi.mock("../subscriptionPlans", () => ({
  getPlanLimits: mockGetPlanLimits,
}));

// Import after mocks are set up
import type {
  SubscriptionRecord,
  WorkspaceRecord,
  AgentRecord,
} from "../../tables/schema";
import {
  getSubscriptionAgentKeys,
  getSubscriptionByUserIdIfExists,
  getSubscriptionChannels,
  getSubscriptionMcpServers,
  checkSubscriptionLimits,
} from "../subscriptionUtils";

describe("subscriptionUtils - Resource Counting", () => {
  const mockDb = {
    workspace: {
      query: vi.fn(),
    },
    agent: {
      query: vi.fn(),
    },
    "agent-key": {
      query: vi.fn(),
    },
    output_channel: {
      query: vi.fn(),
    },
    "mcp-server": {
      query: vi.fn(),
    },
    subscription: {
      query: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabase.mockResolvedValue(mockDb);
  });

  describe("getSubscriptionByUserIdIfExists", () => {
    it("returns undefined when user has no subscription", async () => {
      mockDb.subscription.query.mockResolvedValue({ items: [] });

      const result = await getSubscriptionByUserIdIfExists("user-123");

      expect(result).toBeUndefined();
      expect(mockDb.subscription.query).toHaveBeenCalledWith({
        IndexName: "byUserId",
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: { ":userId": "user-123" },
      });
    });

    it("returns subscription when user has one", async () => {
      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "free",
        status: "active",
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
      };
      mockDb.subscription.query.mockResolvedValue({ items: [subscription] });

      const result = await getSubscriptionByUserIdIfExists("user-123");

      expect(result).toEqual(subscription);
      expect(mockDb.subscription.query).toHaveBeenCalledWith({
        IndexName: "byUserId",
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: { ":userId": "user-123" },
      });
    });
  });

  describe("getSubscriptionAgentKeys", () => {
    it("should return 0 when subscription has no workspaces", async () => {
      mockDb.workspace.query.mockResolvedValue({ items: [] });

      const result = await getSubscriptionAgentKeys("sub-123");

      expect(result).toBe(0);
      expect(mockDb.workspace.query).toHaveBeenCalledWith({
        IndexName: "bySubscriptionId",
        KeyConditionExpression: "subscriptionId = :subscriptionId",
        ExpressionAttributeValues: {
          ":subscriptionId": "sub-123",
        },
      });
    });

    it("should count agent keys across all agents in all workspaces", async () => {
      const workspace1: WorkspaceRecord = {
        pk: "workspaces/ws-1",
        sk: "workspace",
        name: "Workspace 1",
        subscriptionId: "sub-123",
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      const workspace2: WorkspaceRecord = {
        pk: "workspaces/ws-2",
        sk: "workspace",
        name: "Workspace 2",
        subscriptionId: "sub-123",
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      mockDb.workspace.query.mockResolvedValue({
        items: [workspace1, workspace2],
      });

      // Workspace 1 has 2 agents
      const agent1: AgentRecord = {
        pk: "agents/ws-1/agent-1",
        sk: "agent",
        workspaceId: "ws-1",
        name: "Agent 1",
        systemPrompt: "Test",
        provider: "google",
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      const agent2: AgentRecord = {
        pk: "agents/ws-1/agent-2",
        sk: "agent",
        workspaceId: "ws-1",
        name: "Agent 2",
        systemPrompt: "Test",
        provider: "google",
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      // Workspace 2 has 1 agent
      const agent3: AgentRecord = {
        pk: "agents/ws-2/agent-3",
        sk: "agent",
        workspaceId: "ws-2",
        name: "Agent 3",
        systemPrompt: "Test",
        provider: "google",
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      mockDb.agent.query
        .mockResolvedValueOnce({ items: [agent1, agent2] }) // ws-1 agents
        .mockResolvedValueOnce({ items: [agent3] }); // ws-2 agents

      // Agent 1 has 2 keys
      mockDb["agent-key"].query
        .mockResolvedValueOnce({
          items: [
            {
              pk: "agent-keys/ws-1/agent-1/key-1",
              workspaceId: "ws-1",
              agentId: "agent-1",
            },
            {
              pk: "agent-keys/ws-1/agent-1/key-2",
              workspaceId: "ws-1",
              agentId: "agent-1",
            },
          ],
        })
        // Agent 2 has 1 key
        .mockResolvedValueOnce({
          items: [
            {
              pk: "agent-keys/ws-1/agent-2/key-3",
              workspaceId: "ws-1",
              agentId: "agent-2",
            },
          ],
        })
        // Agent 3 has 3 keys
        .mockResolvedValueOnce({
          items: [
            {
              pk: "agent-keys/ws-2/agent-3/key-4",
              workspaceId: "ws-2",
              agentId: "agent-3",
            },
            {
              pk: "agent-keys/ws-2/agent-3/key-5",
              workspaceId: "ws-2",
              agentId: "agent-3",
            },
            {
              pk: "agent-keys/ws-2/agent-3/key-6",
              workspaceId: "ws-2",
              agentId: "agent-3",
            },
          ],
        });

      const result = await getSubscriptionAgentKeys("sub-123");

      expect(result).toBe(6); // 2 + 1 + 3
      expect(mockDb.agent.query).toHaveBeenCalledTimes(2);
      expect(mockDb["agent-key"].query).toHaveBeenCalledTimes(3);
    });

    it("should filter out keys from other workspaces", async () => {
      const workspace: WorkspaceRecord = {
        pk: "workspaces/ws-1",
        sk: "workspace",
        name: "Workspace 1",
        subscriptionId: "sub-123",
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      mockDb.workspace.query.mockResolvedValue({ items: [workspace] });

      const agent: AgentRecord = {
        pk: "agents/ws-1/agent-1",
        sk: "agent",
        workspaceId: "ws-1",
        name: "Agent 1",
        systemPrompt: "Test",
        provider: "google",
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      mockDb.agent.query.mockResolvedValue({ items: [agent] });

      // Return keys from different workspace (should be filtered out)
      mockDb["agent-key"].query.mockResolvedValue({
        items: [
          {
            pk: "agent-keys/ws-1/agent-1/key-1",
            workspaceId: "ws-1",
            agentId: "agent-1",
          },
          {
            pk: "agent-keys/ws-other/agent-1/key-2",
            workspaceId: "ws-other", // Different workspace
            agentId: "agent-1",
          },
        ],
      });

      const result = await getSubscriptionAgentKeys("sub-123");

      expect(result).toBe(1); // Only the key from ws-1
    });
  });

  describe("getSubscriptionChannels", () => {
    it("should return 0 when subscription has no workspaces", async () => {
      mockDb.workspace.query.mockResolvedValue({ items: [] });

      const result = await getSubscriptionChannels("sub-123");

      expect(result).toBe(0);
    });

    it("should count channels across all workspaces", async () => {
      const workspace1: WorkspaceRecord = {
        pk: "workspaces/ws-1",
        sk: "workspace",
        name: "Workspace 1",
        subscriptionId: "sub-123",
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      const workspace2: WorkspaceRecord = {
        pk: "workspaces/ws-2",
        sk: "workspace",
        name: "Workspace 2",
        subscriptionId: "sub-123",
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      mockDb.workspace.query.mockResolvedValue({
        items: [workspace1, workspace2],
      });

      mockDb["output_channel"].query
        .mockResolvedValueOnce({
          items: [
            { pk: "output-channels/ws-1/channel-1", workspaceId: "ws-1" },
            { pk: "output-channels/ws-1/channel-2", workspaceId: "ws-1" },
          ],
        })
        .mockResolvedValueOnce({
          items: [
            { pk: "output-channels/ws-2/channel-3", workspaceId: "ws-2" },
          ],
        });

      const result = await getSubscriptionChannels("sub-123");

      expect(result).toBe(3); // 2 + 1
      expect(mockDb["output_channel"].query).toHaveBeenCalledTimes(2);
    });
  });

  describe("getSubscriptionMcpServers", () => {
    it("should return 0 when subscription has no workspaces", async () => {
      mockDb.workspace.query.mockResolvedValue({ items: [] });

      const result = await getSubscriptionMcpServers("sub-123");

      expect(result).toBe(0);
    });

    it("should count MCP servers across all workspaces", async () => {
      const workspace1: WorkspaceRecord = {
        pk: "workspaces/ws-1",
        sk: "workspace",
        name: "Workspace 1",
        subscriptionId: "sub-123",
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      const workspace2: WorkspaceRecord = {
        pk: "workspaces/ws-2",
        sk: "workspace",
        name: "Workspace 2",
        subscriptionId: "sub-123",
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      mockDb.workspace.query.mockResolvedValue({
        items: [workspace1, workspace2],
      });

      mockDb["mcp-server"].query
        .mockResolvedValueOnce({
          items: [{ pk: "mcp-servers/ws-1/server-1", workspaceId: "ws-1" }],
        })
        .mockResolvedValueOnce({
          items: [
            { pk: "mcp-servers/ws-2/server-2", workspaceId: "ws-2" },
            { pk: "mcp-servers/ws-2/server-3", workspaceId: "ws-2" },
          ],
        });

      const result = await getSubscriptionMcpServers("sub-123");

      expect(result).toBe(3); // 1 + 2
      expect(mockDb["mcp-server"].query).toHaveBeenCalledTimes(2);
    });
  });
});

describe("subscriptionUtils - checkSubscriptionLimits", () => {
  const mockDb = {
    workspace: {
      query: vi.fn(),
    },
    agent: {
      query: vi.fn(),
    },
    "agent-key": {
      query: vi.fn(),
    },
    output_channel: {
      query: vi.fn(),
    },
    "mcp-server": {
      query: vi.fn(),
    },
    "workspace-document": {
      query: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabase.mockResolvedValue(mockDb);
  });

  describe("agentKey limit checking", () => {
    it("should allow creation when under limit", async () => {
      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "free",
        status: "active",
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      // Mock getSubscriptionById by mocking the database call it makes
      const mockSubscriptionDb = {
        subscription: {
          get: vi.fn().mockResolvedValue(subscription),
        },
      };
      mockDatabase.mockResolvedValue({
        ...mockDb,
        ...mockSubscriptionDb,
      });

      mockGetPlanLimits.mockReturnValue({
        maxWorkspaces: 1,
        maxDocuments: 10,
        maxDocumentSizeBytes: 1024 * 1024,
        maxAgents: 1,
        maxUsers: 1,
        maxAgentKeys: 5,
        maxChannels: 2,
        maxMcpServers: 2,
      });

      // Mock getSubscriptionWorkspaces (used by getSubscriptionAgentKeys)
      mockDb.workspace.query.mockResolvedValue({ items: [] });
      mockDb.agent.query.mockResolvedValue({ items: [] });
      mockDb["agent-key"].query.mockResolvedValue({ items: [] });

      await expect(
        checkSubscriptionLimits("sub-123", "agentKey", 1)
      ).resolves.not.toThrow();
    });

    it("should throw error when limit would be exceeded", async () => {
      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "free",
        status: "active",
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      const mockSubscriptionDb = {
        subscription: {
          get: vi.fn().mockResolvedValue(subscription),
        },
      };
      mockDatabase.mockResolvedValue({
        ...mockDb,
        ...mockSubscriptionDb,
      });
      mockGetPlanLimits.mockReturnValue({
        maxWorkspaces: 1,
        maxDocuments: 10,
        maxDocumentSizeBytes: 1024 * 1024,
        maxAgents: 1,
        maxUsers: 1,
        maxAgentKeys: 5,
        maxChannels: 2,
        maxMcpServers: 2,
      });

      const workspace: WorkspaceRecord = {
        pk: "workspaces/ws-1",
        sk: "workspace",
        name: "Workspace 1",
        subscriptionId: "sub-123",
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      const agent: AgentRecord = {
        pk: "agents/ws-1/agent-1",
        sk: "agent",
        workspaceId: "ws-1",
        name: "Agent 1",
        systemPrompt: "Test",
        provider: "google",
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      mockDb.workspace.query.mockResolvedValue({ items: [workspace] });
      mockDb.agent.query.mockResolvedValue({ items: [agent] });

      // Already has 5 keys (at limit)
      mockDb["agent-key"].query.mockResolvedValue({
        items: [
          { pk: "agent-keys/ws-1/agent-1/key-1", workspaceId: "ws-1" },
          { pk: "agent-keys/ws-1/agent-1/key-2", workspaceId: "ws-1" },
          { pk: "agent-keys/ws-1/agent-1/key-3", workspaceId: "ws-1" },
          { pk: "agent-keys/ws-1/agent-1/key-4", workspaceId: "ws-1" },
          { pk: "agent-keys/ws-1/agent-1/key-5", workspaceId: "ws-1" },
        ],
      });

      await expect(
        checkSubscriptionLimits("sub-123", "agentKey", 1)
      ).rejects.toThrow("Agent key limit exceeded");

      const error = await checkSubscriptionLimits(
        "sub-123",
        "agentKey",
        1
      ).catch((e) => e);
      expect(error.output.statusCode).toBe(400);
      expect(error.message).toContain("Maximum 5 agent key(s) allowed");
      expect(error.message).toContain("free plan");
    });

    it("should allow creation when exactly at limit (additionalCount = 0)", async () => {
      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "free",
        status: "active",
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      const mockSubscriptionDb = {
        subscription: {
          get: vi.fn().mockResolvedValue(subscription),
        },
      };
      mockDatabase.mockResolvedValue({
        ...mockDb,
        ...mockSubscriptionDb,
      });

      mockGetPlanLimits.mockReturnValue({
        maxWorkspaces: 1,
        maxDocuments: 10,
        maxDocumentSizeBytes: 1024 * 1024,
        maxAgents: 1,
        maxUsers: 1,
        maxAgentKeys: 5,
        maxChannels: 2,
        maxMcpServers: 2,
      });

      const workspace: WorkspaceRecord = {
        pk: "workspaces/ws-1",
        sk: "workspace",
        name: "Workspace 1",
        subscriptionId: "sub-123",
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      const agent: AgentRecord = {
        pk: "agents/ws-1/agent-1",
        sk: "agent",
        workspaceId: "ws-1",
        name: "Agent 1",
        systemPrompt: "Test",
        provider: "google",
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      mockDb.workspace.query.mockResolvedValue({ items: [workspace] });
      mockDb.agent.query.mockResolvedValue({ items: [agent] });

      // Exactly at limit (5 keys)
      mockDb["agent-key"].query.mockResolvedValue({
        items: [
          { pk: "agent-keys/ws-1/agent-1/key-1", workspaceId: "ws-1" },
          { pk: "agent-keys/ws-1/agent-1/key-2", workspaceId: "ws-1" },
          { pk: "agent-keys/ws-1/agent-1/key-3", workspaceId: "ws-1" },
          { pk: "agent-keys/ws-1/agent-1/key-4", workspaceId: "ws-1" },
          { pk: "agent-keys/ws-1/agent-1/key-5", workspaceId: "ws-1" },
        ],
      });

      // Should not throw when checking current state (additionalCount = 0)
      await expect(
        checkSubscriptionLimits("sub-123", "agentKey", 0)
      ).resolves.not.toThrow();
    });
  });

  describe("channel limit checking", () => {
    it("should allow creation when under limit", async () => {
      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "free",
        status: "active",
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      const mockSubscriptionDb = {
        subscription: {
          get: vi.fn().mockResolvedValue(subscription),
        },
      };
      mockDatabase.mockResolvedValue({
        ...mockDb,
        ...mockSubscriptionDb,
      });

      mockGetPlanLimits.mockReturnValue({
        maxWorkspaces: 1,
        maxDocuments: 10,
        maxDocumentSizeBytes: 1024 * 1024,
        maxAgents: 1,
        maxUsers: 1,
        maxAgentKeys: 5,
        maxChannels: 2,
        maxMcpServers: 2,
      });

      mockDb.workspace.query.mockResolvedValue({ items: [] });
      mockDb["output_channel"].query.mockResolvedValue({ items: [] });

      await expect(
        checkSubscriptionLimits("sub-123", "channel", 1)
      ).resolves.not.toThrow();
    });

    it("should throw error when limit would be exceeded", async () => {
      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "free",
        status: "active",
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      const mockSubscriptionDb = {
        subscription: {
          get: vi.fn().mockResolvedValue(subscription),
        },
      };
      mockDatabase.mockResolvedValue({
        ...mockDb,
        ...mockSubscriptionDb,
      });

      mockGetPlanLimits.mockReturnValue({
        maxWorkspaces: 1,
        maxDocuments: 10,
        maxDocumentSizeBytes: 1024 * 1024,
        maxAgents: 1,
        maxUsers: 1,
        maxAgentKeys: 5,
        maxChannels: 2,
        maxMcpServers: 2,
      });

      const workspace: WorkspaceRecord = {
        pk: "workspaces/ws-1",
        sk: "workspace",
        name: "Workspace 1",
        subscriptionId: "sub-123",
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      mockDb.workspace.query.mockResolvedValue({ items: [workspace] });

      // Already has 2 channels (at limit)
      mockDb["output_channel"].query.mockResolvedValue({
        items: [
          { pk: "output-channels/ws-1/channel-1", workspaceId: "ws-1" },
          { pk: "output-channels/ws-1/channel-2", workspaceId: "ws-1" },
        ],
      });

      await expect(
        checkSubscriptionLimits("sub-123", "channel", 1)
      ).rejects.toThrow("Channel limit exceeded");

      const error = await checkSubscriptionLimits(
        "sub-123",
        "channel",
        1
      ).catch((e) => e);
      expect(error.output.statusCode).toBe(400);
      expect(error.message).toContain("Maximum 2 channel(s) allowed");
      expect(error.message).toContain("free plan");
    });
  });

  describe("mcpServer limit checking", () => {
    it("should allow creation when under limit", async () => {
      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "free",
        status: "active",
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      const mockSubscriptionDb = {
        subscription: {
          get: vi.fn().mockResolvedValue(subscription),
        },
      };
      mockDatabase.mockResolvedValue({
        ...mockDb,
        ...mockSubscriptionDb,
      });

      mockGetPlanLimits.mockReturnValue({
        maxWorkspaces: 1,
        maxDocuments: 10,
        maxDocumentSizeBytes: 1024 * 1024,
        maxAgents: 1,
        maxUsers: 1,
        maxAgentKeys: 5,
        maxChannels: 2,
        maxMcpServers: 2,
      });

      mockDb.workspace.query.mockResolvedValue({ items: [] });
      mockDb["mcp-server"].query.mockResolvedValue({ items: [] });

      await expect(
        checkSubscriptionLimits("sub-123", "mcpServer", 1)
      ).resolves.not.toThrow();
    });

    it("should throw error when limit would be exceeded", async () => {
      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "pro",
        status: "active",
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      const mockSubscriptionDb = {
        subscription: {
          get: vi.fn().mockResolvedValue(subscription),
        },
      };
      mockDatabase.mockResolvedValue({
        ...mockDb,
        ...mockSubscriptionDb,
      });

      mockGetPlanLimits.mockReturnValue({
        maxWorkspaces: 5,
        maxDocuments: 1000,
        maxDocumentSizeBytes: 100 * 1024 * 1024,
        maxAgents: 50,
        maxUsers: 5,
        maxAgentKeys: 250,
        maxChannels: 50,
        maxMcpServers: 50,
      });

      const workspace: WorkspaceRecord = {
        pk: "workspaces/ws-1",
        sk: "workspace",
        name: "Workspace 1",
        subscriptionId: "sub-123",
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      mockDb.workspace.query.mockResolvedValue({ items: [workspace] });

      // Already has 50 MCP servers (at limit)
      const servers = Array.from({ length: 50 }, (_, i) => ({
        pk: `mcp-servers/ws-1/server-${i + 1}`,
        workspaceId: "ws-1",
      }));
      mockDb["mcp-server"].query.mockResolvedValue({ items: servers });

      await expect(
        checkSubscriptionLimits("sub-123", "mcpServer", 1)
      ).rejects.toThrow("MCP server limit exceeded");

      const error = await checkSubscriptionLimits(
        "sub-123",
        "mcpServer",
        1
      ).catch((e) => e);
      expect(error.output.statusCode).toBe(400);
      expect(error.message).toContain("Maximum 50 MCP server(s) allowed");
      expect(error.message).toContain("pro plan");
    });
  });

  describe("error handling", () => {
    it("should throw error if subscription not found", async () => {
      const mockSubscriptionDb = {
        subscription: {
          get: vi.fn().mockResolvedValue(undefined),
        },
      };
      mockDatabase.mockResolvedValue({
        ...mockDb,
        ...mockSubscriptionDb,
      });

      await expect(
        checkSubscriptionLimits("sub-123", "agentKey", 1)
      ).rejects.toThrow("Subscription not found");

      const error = await checkSubscriptionLimits(
        "sub-123",
        "agentKey",
        1
      ).catch((e) => e);
      expect(error.output.statusCode).toBe(400);
    });

    it("should throw error if plan limits not found", async () => {
      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "invalid-plan" as "free" | "starter" | "pro",
        status: "active",
        version: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      const mockSubscriptionDb = {
        subscription: {
          get: vi.fn().mockResolvedValue(subscription),
        },
      };
      mockDatabase.mockResolvedValue({
        ...mockDb,
        ...mockSubscriptionDb,
      });

      mockGetPlanLimits.mockReturnValue(undefined);

      await expect(
        checkSubscriptionLimits("sub-123", "agentKey", 1)
      ).rejects.toThrow("Invalid subscription plan");

      const error = await checkSubscriptionLimits(
        "sub-123",
        "agentKey",
        1
      ).catch((e) => e);
      expect(error.output.statusCode).toBe(400);
    });
  });
});
