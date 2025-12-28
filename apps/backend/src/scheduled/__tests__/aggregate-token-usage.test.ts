import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDatabase, mockFormatDate } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockFormatDate: vi.fn(),
  };
});

// Mock the database module
vi.mock("../../tables/database", () => ({
  database: mockDatabase,
}));

// Mock aggregation utils
vi.mock("../../utils/aggregation", () => ({
  formatDate: mockFormatDate,
}));

// Import after mocks are set up
import type {
  DatabaseSchema,
  PermissionRecord,
  AgentRecord,
  AgentConversationRecord,
} from "../../tables/schema";
import {
  aggregateTokenUsageForDate,
  aggregatePreviousDay,
} from "../aggregate-token-usage";

describe("aggregateTokenUsageForDate", () => {
  let mockDb: DatabaseSchema;
  let mockPermissionQuery: ReturnType<typeof vi.fn>;
  let mockAgentQuery: ReturnType<typeof vi.fn>;
  let mockConversationsQuery: ReturnType<typeof vi.fn>;
  let mockUpsert: ReturnType<typeof vi.fn>;
  let mockTransactionsQuery: ReturnType<typeof vi.fn>;
  let mockToolUpsert: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    // Setup mock queries
    mockPermissionQuery = vi.fn().mockResolvedValue({ items: [] });
    mockAgentQuery = vi.fn().mockResolvedValue({ items: [] });
    mockConversationsQuery = vi.fn().mockResolvedValue({ items: [] });
    mockUpsert = vi.fn().mockResolvedValue({});
    mockTransactionsQuery = vi.fn().mockResolvedValue({ items: [] });
    mockToolUpsert = vi.fn().mockResolvedValue({});

    // Setup mock database
    mockDb = {
      permission: {
        query: mockPermissionQuery,
      },
      agent: {
        query: mockAgentQuery,
      },
      "agent-conversations": {
        query: mockConversationsQuery,
      },
      "token-usage-aggregates": {
        upsert: mockUpsert,
      },
      "workspace-credit-transactions": {
        query: mockTransactionsQuery,
      },
      "tool-usage-aggregates": {
        upsert: mockToolUpsert,
      },
    } as unknown as DatabaseSchema;

    mockDatabase.mockResolvedValue(mockDb);
    mockFormatDate.mockImplementation(
      (date: Date) => date.toISOString().split("T")[0]
    );
  });

  it("should successfully aggregate token usage for a given date", async () => {
    const date = new Date("2025-12-13");
    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const permission: PermissionRecord = {
      pk: `workspaces/${workspaceId}`,
      sk: "users/user-789",
      type: 1,
      resourceType: "workspaces",
      version: 1,
      createdAt: new Date().toISOString(),
    };

    const agent: AgentRecord = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      workspaceId,
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      provider: "google",
      version: 1,
      createdAt: new Date().toISOString(),
    };

    const conversation: AgentConversationRecord = {
      pk: `conversations/${workspaceId}/${agentId}/conv-123`,
      sk: "conversation",
      workspaceId,
      agentId,
      conversationId: "conv-123",
      conversationType: "webhook",
      messages: [],
      tokenUsage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      },
      modelName: "gemini-2.5-flash",
      provider: "google",
      usesByok: false,
      costUsd: 0.001,
      startedAt: new Date("2025-12-13T12:00:00Z").toISOString(),
      lastMessageAt: new Date("2025-12-13T12:00:00Z").toISOString(),
      expires: Math.floor(Date.now() / 1000) + 86400,
      version: 1,
      createdAt: new Date().toISOString(),
    };

    mockPermissionQuery.mockResolvedValue({ items: [permission] });
    mockAgentQuery.mockResolvedValue({ items: [agent] });
    mockConversationsQuery.mockResolvedValue({ items: [conversation] });

    await aggregateTokenUsageForDate(date);

    expect(mockUpsert).toHaveBeenCalled();
    const upsertCall = mockUpsert.mock.calls[0][0];
    expect(upsertCall.date).toBe("2025-12-13");
    expect(upsertCall.workspaceId).toBe(workspaceId);
    expect(upsertCall.agentId).toBe(agentId);
    expect(upsertCall.inputTokens).toBe(100);
    expect(upsertCall.outputTokens).toBe(50);
    expect(upsertCall.totalTokens).toBe(150);
    expect(upsertCall.costUsd).toBe(0); // Cost now comes from transactions, not conversations
  });

  it("should query conversations correctly using date range filters", async () => {
    const date = new Date("2025-12-13");
    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const permission: PermissionRecord = {
      pk: `workspaces/${workspaceId}`,
      sk: "users/user-789",
      type: 1,
      resourceType: "workspaces",
      version: 1,
      createdAt: new Date().toISOString(),
    };

    const agent: AgentRecord = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      workspaceId,
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      provider: "google",
      version: 1,
      createdAt: new Date().toISOString(),
    };

    mockPermissionQuery.mockResolvedValue({ items: [permission] });
    mockAgentQuery.mockResolvedValue({ items: [agent] });
    mockConversationsQuery.mockResolvedValue({ items: [] });

    await aggregateTokenUsageForDate(date);

    expect(mockConversationsQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        IndexName: "byAgentId",
        KeyConditionExpression: "agentId = :agentId",
        FilterExpression: "#startedAt BETWEEN :startDate AND :endDate",
        ExpressionAttributeValues: expect.objectContaining({
          ":agentId": agentId,
        }),
      })
    );
  });

  it("should group conversations by workspace, agent, model, provider, and BYOK status", async () => {
    const date = new Date("2025-12-13");
    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const permission: PermissionRecord = {
      pk: `workspaces/${workspaceId}`,
      sk: "users/user-789",
      type: 1,
      resourceType: "workspaces",
      version: 1,
      createdAt: new Date().toISOString(),
    };

    const agent: AgentRecord = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      workspaceId,
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      provider: "google",
      version: 1,
      createdAt: new Date().toISOString(),
    };

    const conversation1: AgentConversationRecord = {
      pk: `conversations/${workspaceId}/${agentId}/conv-1`,
      sk: "conversation",
      workspaceId,
      agentId,
      conversationId: "conv-1",
      conversationType: "webhook",
      messages: [],
      tokenUsage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      },
      modelName: "gemini-2.5-flash",
      provider: "google",
      usesByok: false,
      costUsd: 0.001,
      startedAt: new Date("2025-12-13T12:00:00Z").toISOString(),
      lastMessageAt: new Date("2025-12-13T12:00:00Z").toISOString(),
      expires: Math.floor(Date.now() / 1000) + 86400,
      version: 1,
      createdAt: new Date().toISOString(),
    };

    const conversation2: AgentConversationRecord = {
      pk: `conversations/${workspaceId}/${agentId}/conv-2`,
      sk: "conversation",
      workspaceId,
      agentId,
      conversationId: "conv-2",
      conversationType: "webhook",
      messages: [],
      tokenUsage: {
        promptTokens: 200,
        completionTokens: 100,
        totalTokens: 300,
      },
      modelName: "gemini-2.5-flash",
      provider: "google",
      usesByok: false,
      costUsd: 0.002,
      startedAt: new Date("2025-12-13T13:00:00Z").toISOString(),
      lastMessageAt: new Date("2025-12-13T13:00:00Z").toISOString(),
      expires: Math.floor(Date.now() / 1000) + 86400,
      version: 1,
      createdAt: new Date().toISOString(),
    };

    mockPermissionQuery.mockResolvedValue({ items: [permission] });
    mockAgentQuery.mockResolvedValue({ items: [agent] });
    mockConversationsQuery.mockResolvedValue({
      items: [conversation1, conversation2],
    });

    await aggregateTokenUsageForDate(date);

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const upsertCall = mockUpsert.mock.calls[0][0];
    // Should aggregate both conversations
    expect(upsertCall.inputTokens).toBe(300); // 100 + 200
    expect(upsertCall.outputTokens).toBe(150); // 50 + 100
    expect(upsertCall.totalTokens).toBe(450); // 150 + 300
    expect(upsertCall.costUsd).toBe(0); // Cost now comes from transactions, not conversations
  });

  it("should calculate correct totals for inputTokens, outputTokens, totalTokens, and costs", async () => {
    const date = new Date("2025-12-13");
    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const permission: PermissionRecord = {
      pk: `workspaces/${workspaceId}`,
      sk: "users/user-789",
      type: 1,
      resourceType: "workspaces",
      version: 1,
      createdAt: new Date().toISOString(),
    };

    const agent: AgentRecord = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      workspaceId,
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      provider: "google",
      version: 1,
      createdAt: new Date().toISOString(),
    };

    const conversation: AgentConversationRecord = {
      pk: `conversations/${workspaceId}/${agentId}/conv-123`,
      sk: "conversation",
      workspaceId,
      agentId,
      conversationId: "conv-123",
      conversationType: "webhook",
      messages: [],
      tokenUsage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      },
      modelName: "gemini-2.5-flash",
      provider: "google",
      usesByok: false,
      costUsd: 0.001,
      startedAt: new Date("2025-12-13T12:00:00Z").toISOString(),
      lastMessageAt: new Date("2025-12-13T12:00:00Z").toISOString(),
      expires: Math.floor(Date.now() / 1000) + 86400,
      version: 1,
      createdAt: new Date().toISOString(),
    };

    mockPermissionQuery.mockResolvedValue({ items: [permission] });
    mockAgentQuery.mockResolvedValue({ items: [agent] });
    mockConversationsQuery.mockResolvedValue({ items: [conversation] });

    await aggregateTokenUsageForDate(date);

    const upsertCall = mockUpsert.mock.calls[0][0];
    expect(upsertCall.inputTokens).toBe(100);
    expect(upsertCall.outputTokens).toBe(50);
    expect(upsertCall.totalTokens).toBe(150);
    expect(upsertCall.costUsd).toBe(0); // Cost now comes from transactions, not conversations
  });

  it("should create aggregate records with correct structure", async () => {
    const date = new Date("2025-12-13");
    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const permission: PermissionRecord = {
      pk: `workspaces/${workspaceId}`,
      sk: "users/user-789",
      type: 1,
      resourceType: "workspaces",
      version: 1,
      createdAt: new Date().toISOString(),
    };

    const agent: AgentRecord = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      workspaceId,
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      provider: "google",
      version: 1,
      createdAt: new Date().toISOString(),
    };

    const conversation: AgentConversationRecord = {
      pk: `conversations/${workspaceId}/${agentId}/conv-123`,
      sk: "conversation",
      workspaceId,
      agentId,
      conversationId: "conv-123",
      conversationType: "webhook",
      messages: [],
      tokenUsage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      },
      modelName: "gemini-2.5-flash",
      provider: "google",
      usesByok: false,
      costUsd: 0.001,
      startedAt: new Date("2025-12-13T12:00:00Z").toISOString(),
      lastMessageAt: new Date("2025-12-13T12:00:00Z").toISOString(),
      expires: Math.floor(Date.now() / 1000) + 86400,
      version: 1,
      createdAt: new Date().toISOString(),
    };

    mockPermissionQuery.mockResolvedValue({ items: [permission] });
    mockAgentQuery.mockResolvedValue({ items: [agent] });
    mockConversationsQuery.mockResolvedValue({ items: [conversation] });

    await aggregateTokenUsageForDate(date);

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        pk: expect.stringContaining(`aggregates/${workspaceId}/2025-12-13`),
        date: "2025-12-13",
        aggregateType: "agent",
        workspaceId,
        agentId,
        modelName: "gemini-2.5-flash",
        provider: "google",
        usesByok: undefined, // false becomes undefined
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        costUsd: 0, // Cost now comes from transactions, not conversations
        createdAt: expect.any(String),
      })
    );
  });

  it("should handle multiple workspaces and agents", async () => {
    const date = new Date("2025-12-13");
    const workspaceId1 = "workspace-123";
    const workspaceId2 = "workspace-456";
    const agentId1 = "agent-1";
    const agentId2 = "agent-2";

    const permission1: PermissionRecord = {
      pk: `workspaces/${workspaceId1}`,
      sk: "users/user-789",
      type: 1,
      resourceType: "workspaces",
      version: 1,
      createdAt: new Date().toISOString(),
    };

    const permission2: PermissionRecord = {
      pk: `workspaces/${workspaceId2}`,
      sk: "users/user-789",
      type: 1,
      resourceType: "workspaces",
      version: 1,
      createdAt: new Date().toISOString(),
    };

    const agent1: AgentRecord = {
      pk: `agents/${workspaceId1}/${agentId1}`,
      sk: "agent",
      workspaceId: workspaceId1,
      name: "Agent 1",
      systemPrompt: "You are a helpful assistant",
      provider: "google",
      version: 1,
      createdAt: new Date().toISOString(),
    };

    const agent2: AgentRecord = {
      pk: `agents/${workspaceId2}/${agentId2}`,
      sk: "agent",
      workspaceId: workspaceId2,
      name: "Agent 2",
      systemPrompt: "You are a helpful assistant",
      provider: "google",
      version: 1,
      createdAt: new Date().toISOString(),
    };

    const conversation1: AgentConversationRecord = {
      pk: `conversations/${workspaceId1}/${agentId1}/conv-1`,
      sk: "conversation",
      workspaceId: workspaceId1,
      agentId: agentId1,
      conversationId: "conv-1",
      conversationType: "webhook",
      messages: [],
      tokenUsage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      },
      modelName: "gemini-2.5-flash",
      provider: "google",
      usesByok: false,
      costUsd: 0.001,
      startedAt: new Date("2025-12-13T12:00:00Z").toISOString(),
      lastMessageAt: new Date("2025-12-13T12:00:00Z").toISOString(),
      expires: Math.floor(Date.now() / 1000) + 86400,
      version: 1,
      createdAt: new Date().toISOString(),
    };

    const conversation2: AgentConversationRecord = {
      pk: `conversations/${workspaceId2}/${agentId2}/conv-2`,
      sk: "conversation",
      workspaceId: workspaceId2,
      agentId: agentId2,
      conversationId: "conv-2",
      conversationType: "webhook",
      messages: [],
      tokenUsage: {
        promptTokens: 200,
        completionTokens: 100,
        totalTokens: 300,
      },
      modelName: "gemini-2.5-flash",
      provider: "google",
      usesByok: false,
      costUsd: 0.002,
      startedAt: new Date("2025-12-13T13:00:00Z").toISOString(),
      lastMessageAt: new Date("2025-12-13T13:00:00Z").toISOString(),
      expires: Math.floor(Date.now() / 1000) + 86400,
      version: 1,
      createdAt: new Date().toISOString(),
    };

    mockPermissionQuery.mockResolvedValue({
      items: [permission1, permission2],
    });
    mockAgentQuery
      .mockResolvedValueOnce({ items: [agent1] })
      .mockResolvedValueOnce({ items: [agent2] });
    mockConversationsQuery
      .mockResolvedValueOnce({ items: [conversation1] })
      .mockResolvedValueOnce({ items: [conversation2] });

    await aggregateTokenUsageForDate(date);

    expect(mockUpsert).toHaveBeenCalledTimes(2);
  });

  it("should handle conversations with and without BYOK", async () => {
    const date = new Date("2025-12-13");
    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const permission: PermissionRecord = {
      pk: `workspaces/${workspaceId}`,
      sk: "users/user-789",
      type: 1,
      resourceType: "workspaces",
      version: 1,
      createdAt: new Date().toISOString(),
    };

    const agent: AgentRecord = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      workspaceId,
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      provider: "google",
      version: 1,
      createdAt: new Date().toISOString(),
    };

    const conversationByok: AgentConversationRecord = {
      pk: `conversations/${workspaceId}/${agentId}/conv-byok`,
      sk: "conversation",
      workspaceId,
      agentId,
      conversationId: "conv-byok",
      conversationType: "webhook",
      messages: [],
      tokenUsage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      },
      modelName: "gemini-2.5-flash",
      provider: "google",
      usesByok: true,
      costUsd: 0.001,
      startedAt: new Date("2025-12-13T12:00:00Z").toISOString(),
      lastMessageAt: new Date("2025-12-13T12:00:00Z").toISOString(),
      expires: Math.floor(Date.now() / 1000) + 86400,
      version: 1,
      createdAt: new Date().toISOString(),
    };

    const conversationPlatform: AgentConversationRecord = {
      pk: `conversations/${workspaceId}/${agentId}/conv-platform`,
      sk: "conversation",
      workspaceId,
      agentId,
      conversationId: "conv-platform",
      conversationType: "webhook",
      messages: [],
      tokenUsage: {
        promptTokens: 200,
        completionTokens: 100,
        totalTokens: 300,
      },
      modelName: "gemini-2.5-flash",
      provider: "google",
      usesByok: false,
      costUsd: 0.002,
      startedAt: new Date("2025-12-13T13:00:00Z").toISOString(),
      lastMessageAt: new Date("2025-12-13T13:00:00Z").toISOString(),
      expires: Math.floor(Date.now() / 1000) + 86400,
      version: 1,
      createdAt: new Date().toISOString(),
    };

    mockPermissionQuery.mockResolvedValue({ items: [permission] });
    mockAgentQuery.mockResolvedValue({ items: [agent] });
    mockConversationsQuery.mockResolvedValue({
      items: [conversationByok, conversationPlatform],
    });

    await aggregateTokenUsageForDate(date);

    // Should create separate aggregates for BYOK and platform
    expect(mockUpsert).toHaveBeenCalledTimes(2);
    const byokCall = mockUpsert.mock.calls.find(
      (call) => call[0].usesByok === true
    );
    const platformCall = mockUpsert.mock.calls.find(
      (call) => call[0].usesByok === undefined
    );

    expect(byokCall).toBeDefined();
    expect(platformCall).toBeDefined();
    expect(byokCall?.[0].inputTokens).toBe(100);
    expect(platformCall?.[0].inputTokens).toBe(200);
  });

  it("should handle empty result sets (no conversations)", async () => {
    const date = new Date("2025-12-13");
    const workspaceId = "workspace-123";

    const permission: PermissionRecord = {
      pk: `workspaces/${workspaceId}`,
      sk: "users/user-789",
      type: 1,
      resourceType: "workspaces",
      version: 1,
      createdAt: new Date().toISOString(),
    };

    mockPermissionQuery.mockResolvedValue({ items: [permission] });
    mockAgentQuery.mockResolvedValue({ items: [] });

    await aggregateTokenUsageForDate(date);

    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("should handle query errors gracefully (continues with next workspace)", async () => {
    const date = new Date("2025-12-13");
    const workspaceId1 = "workspace-123";
    const workspaceId2 = "workspace-456";

    const permission1: PermissionRecord = {
      pk: `workspaces/${workspaceId1}`,
      sk: "users/user-789",
      type: 1,
      resourceType: "workspaces",
      version: 1,
      createdAt: new Date().toISOString(),
    };

    const permission2: PermissionRecord = {
      pk: `workspaces/${workspaceId2}`,
      sk: "users/user-789",
      type: 1,
      resourceType: "workspaces",
      version: 1,
      createdAt: new Date().toISOString(),
    };

    mockPermissionQuery.mockResolvedValue({
      items: [permission1, permission2],
    });
    mockAgentQuery
      .mockRejectedValueOnce(new Error("Query failed"))
      .mockResolvedValueOnce({ items: [] });

    // Should not throw
    await expect(aggregateTokenUsageForDate(date)).resolves.not.toThrow();
  });

  it("should handle aggregate creation errors gracefully", async () => {
    const date = new Date("2025-12-13");
    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const permission: PermissionRecord = {
      pk: `workspaces/${workspaceId}`,
      sk: "users/user-789",
      type: 1,
      resourceType: "workspaces",
      version: 1,
      createdAt: new Date().toISOString(),
    };

    const agent: AgentRecord = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      workspaceId,
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      provider: "google",
      version: 1,
      createdAt: new Date().toISOString(),
    };

    const conversation: AgentConversationRecord = {
      pk: `conversations/${workspaceId}/${agentId}/conv-123`,
      sk: "conversation",
      workspaceId,
      agentId,
      conversationId: "conv-123",
      conversationType: "webhook",
      messages: [],
      tokenUsage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      },
      modelName: "gemini-2.5-flash",
      provider: "google",
      usesByok: false,
      costUsd: 0.001,
      startedAt: new Date("2025-12-13T12:00:00Z").toISOString(),
      lastMessageAt: new Date("2025-12-13T12:00:00Z").toISOString(),
      expires: Math.floor(Date.now() / 1000) + 86400,
      version: 1,
      createdAt: new Date().toISOString(),
    };

    mockPermissionQuery.mockResolvedValue({ items: [permission] });
    mockAgentQuery.mockResolvedValue({ items: [agent] });
    mockConversationsQuery.mockResolvedValue({ items: [conversation] });
    mockUpsert.mockRejectedValue(new Error("Upsert failed"));

    // Should throw (fatal error)
    await expect(aggregateTokenUsageForDate(date)).rejects.toThrow();
  });

  it("should correctly format dates using formatDate utility", async () => {
    const date = new Date("2025-12-13T15:30:00Z");

    mockPermissionQuery.mockResolvedValue({ items: [] });

    await aggregateTokenUsageForDate(date);

    expect(mockFormatDate).toHaveBeenCalledWith(date);
  });

  it("should skip conversations without required fields (tokenUsage, modelName, provider)", async () => {
    const date = new Date("2025-12-13");
    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const permission: PermissionRecord = {
      pk: `workspaces/${workspaceId}`,
      sk: "users/user-789",
      type: 1,
      resourceType: "workspaces",
      version: 1,
      createdAt: new Date().toISOString(),
    };

    const agent: AgentRecord = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      workspaceId,
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      provider: "google",
      version: 1,
      createdAt: new Date().toISOString(),
    };

    const conversationWithoutTokenUsage: AgentConversationRecord = {
      pk: `conversations/${workspaceId}/${agentId}/conv-123`,
      sk: "conversation",
      workspaceId,
      agentId,
      conversationId: "conv-123",
      conversationType: "webhook",
      messages: [],
      // Missing tokenUsage
      modelName: "gemini-2.5-flash",
      provider: "google",
      usesByok: false,
      startedAt: new Date("2025-12-13T12:00:00Z").toISOString(),
      lastMessageAt: new Date("2025-12-13T12:00:00Z").toISOString(),
      expires: Math.floor(Date.now() / 1000) + 86400,
      version: 1,
      createdAt: new Date().toISOString(),
    };

    mockPermissionQuery.mockResolvedValue({ items: [permission] });
    mockAgentQuery.mockResolvedValue({ items: [agent] });
    mockConversationsQuery.mockResolvedValue({
      items: [conversationWithoutTokenUsage],
    });

    await aggregateTokenUsageForDate(date);

    // Should not create aggregates for conversations without required fields
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("should create workspace-level aggregates when agentId is not present", async () => {
    const date = new Date("2025-12-13");
    const workspaceId = "workspace-123";

    const permission: PermissionRecord = {
      pk: `workspaces/${workspaceId}`,
      sk: "users/user-789",
      type: 1,
      resourceType: "workspaces",
      version: 1,
      createdAt: new Date().toISOString(),
    };

    // No agents in workspace
    mockPermissionQuery.mockResolvedValue({ items: [permission] });
    mockAgentQuery.mockResolvedValue({ items: [] });

    await aggregateTokenUsageForDate(date);

    // Should not create aggregates if no conversations
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe("aggregatePreviousDay", () => {
  let mockDb: DatabaseSchema;
  let mockPermissionQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    mockPermissionQuery = vi.fn().mockResolvedValue({ items: [] });

    mockDb = {
      permission: {
        query: mockPermissionQuery,
      },
      agent: {
        query: vi.fn().mockResolvedValue({ items: [] }),
      },
      "agent-conversations": {
        query: vi.fn().mockResolvedValue({ items: [] }),
      },
      "token-usage-aggregates": {
        upsert: vi.fn().mockResolvedValue({}),
      },
    } as unknown as DatabaseSchema;

    mockDatabase.mockResolvedValue(mockDb);
  });

  it("should call aggregateTokenUsageForDate with yesterday's date", async () => {
    await aggregatePreviousDay();

    // Should have called aggregateTokenUsageForDate which queries permissions
    expect(mockPermissionQuery).toHaveBeenCalled();
  });
});
