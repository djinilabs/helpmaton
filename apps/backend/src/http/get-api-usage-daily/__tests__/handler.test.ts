import { unauthorized } from "@hapi/boom";
import { describe, it, expect, vi, beforeEach } from "vitest";

// eslint-disable-next-line import/order
import {
  createAPIGatewayEventV2,
  createMockContext,
  createMockCallback,
  createMockDatabase,
} from "../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const {
  mockDatabase,
  mockRequireSession,
  mockQueryUsageStats,
  mockMergeUsageStats,
} = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockRequireSession: vi.fn(),
    mockQueryUsageStats: vi.fn(),
    mockMergeUsageStats: vi.fn(),
  };
});

// Mock the modules
vi.mock("../../../tables", () => ({
  database: mockDatabase,
}));

// Mock @architect/functions for database initialization
vi.mock("@architect/functions", () => ({
  tables: vi.fn().mockResolvedValue({
    reflect: vi.fn().mockResolvedValue({}),
    _client: {},
  }),
}));

vi.mock("../../utils/session", () => ({
  requireSession: mockRequireSession,
  userRef: (userId: string) => `users/${userId}`,
}));

vi.mock("../../../utils/aggregation", () => ({
  queryUsageStats: mockQueryUsageStats,
  mergeUsageStats: mockMergeUsageStats,
}));

// Import the handler after mocks are set up
import { handler } from "../index";

describe("get-api-usage-daily handler", () => {
  const mockContext = createMockContext();
  const mockCallback = createMockCallback();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return daily usage stats for authenticated user", async () => {
    const mockSession = {
      user: {
        id: "user-123",
        email: "user@example.com",
      },
    };

    const mockPermissions = [
      {
        pk: "workspaces/workspace-1",
        sk: "users/user-123",
        resourceType: "workspaces",
        type: 1,
      },
      {
        pk: "workspaces/workspace-2",
        sk: "users/user-123",
        resourceType: "workspaces",
        type: 2,
      },
    ];

    const mockUsageStatsDay1 = {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      costUsd: 0.001,
      conversationCount: 5,
      messagesIn: 10,
      messagesOut: 10,
      totalMessages: 20,
      byModel: {},
      byProvider: {},
      byByok: {
        byok: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        },
        platform: {
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
          costUsd: 0.001,
        },
      },
      toolExpenses: {},
    };

    const mockUsageStatsDay2 = {
      inputTokens: 2000,
      outputTokens: 1000,
      totalTokens: 3000,
      costUsd: 0.002,
      conversationCount: 8,
      messagesIn: 15,
      messagesOut: 15,
      totalMessages: 30,
      byModel: {},
      byProvider: {},
      byByok: {
        byok: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        },
        platform: {
          inputTokens: 2000,
          outputTokens: 1000,
          totalTokens: 3000,
          costUsd: 0.002,
        },
      },
      toolExpenses: {},
    };

    const mockMergedStatsDay1 = {
      inputTokens: 3000,
      outputTokens: 1500,
      totalTokens: 4500,
      costUsd: 0.003,
      conversationCount: 13,
      messagesIn: 25,
      messagesOut: 25,
      totalMessages: 50,
      byModel: {},
      byProvider: {},
      byByok: {
        byok: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        },
        platform: {
          inputTokens: 3000,
          outputTokens: 1500,
          totalTokens: 4500,
          costUsd: 0.003,
        },
      },
      toolExpenses: {},
    };

    const mockMergedStatsDay2 = {
      inputTokens: 4000,
      outputTokens: 2000,
      totalTokens: 6000,
      costUsd: 0.004,
      conversationCount: 16,
      messagesIn: 30,
      messagesOut: 30,
      totalMessages: 60,
      byModel: {},
      byProvider: {},
      byByok: {
        byok: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        },
        platform: {
          inputTokens: 4000,
          outputTokens: 2000,
          totalTokens: 6000,
          costUsd: 0.004,
        },
      },
      toolExpenses: {},
    };

    mockRequireSession.mockResolvedValue(mockSession);

    const mockDb = createMockDatabase();
    mockDb.permission.query = vi.fn().mockResolvedValue({
      items: mockPermissions,
    });
    mockDatabase.mockResolvedValue(mockDb);

    // Mock queryUsageStats to return different stats for each workspace and day
    // Day 1: workspace-1 returns stats1, workspace-2 returns stats2
    // Day 2: workspace-1 returns stats1, workspace-2 returns stats2
    mockQueryUsageStats
      .mockResolvedValueOnce(mockUsageStatsDay1) // Day 1, workspace-1
      .mockResolvedValueOnce(mockUsageStatsDay1) // Day 1, workspace-2
      .mockResolvedValueOnce(mockUsageStatsDay2) // Day 2, workspace-1
      .mockResolvedValueOnce(mockUsageStatsDay2); // Day 2, workspace-2

    mockMergeUsageStats
      .mockReturnValueOnce(mockMergedStatsDay1) // Day 1 merged
      .mockReturnValueOnce(mockMergedStatsDay2); // Day 2 merged

    const event = createAPIGatewayEventV2({
      routeKey: "GET /api/usage/daily",
      rawPath: "/api/usage/daily",
      queryStringParameters: {
        startDate: "2024-01-01",
        endDate: "2024-01-02",
      },
    });

    const result = await handler(event, mockContext, mockCallback);

    expect(mockRequireSession).toHaveBeenCalledWith(event);
    expect(mockDatabase).toHaveBeenCalledTimes(1);
    expect(mockDb.permission.query).toHaveBeenCalledWith({
      IndexName: "byResourceTypeAndEntityId",
      KeyConditionExpression: "resourceType = :resourceType AND sk = :userRef",
      ExpressionAttributeValues: {
        ":resourceType": "workspaces",
        ":userRef": "users/user-123",
      },
    });

    // Should query stats for 2 days × 2 workspaces = 4 times
    expect(mockQueryUsageStats).toHaveBeenCalledTimes(4);
    expect(mockMergeUsageStats).toHaveBeenCalledTimes(2);

    const typedResult = result as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };
    const body = JSON.parse(typedResult.body || "{}");
    expect(typedResult.statusCode).toBe(200);
    expect(body.userId).toBe("user-123");
    expect(body.currency).toBe("usd");
    expect(body.startDate).toBe("2024-01-01");
    expect(body.endDate).toBe("2024-01-02");
    expect(body.daily).toHaveLength(2);
    expect(body.daily[0].date).toBe("2024-01-01");
    expect(body.daily[0].inputTokens).toBe(3000);
    expect(body.daily[0].outputTokens).toBe(1500);
    expect(body.daily[0].totalTokens).toBe(4500);
    expect(body.daily[0].cost).toBe(0.003);
    expect(body.daily[0].conversationCount).toBe(13);
    expect(body.daily[0].messagesIn).toBe(25);
    expect(body.daily[0].messagesOut).toBe(25);
    expect(body.daily[0].totalMessages).toBe(50);
    expect(body.daily[1].date).toBe("2024-01-02");
    expect(body.daily[1].inputTokens).toBe(4000);
    expect(body.daily[1].outputTokens).toBe(2000);
    expect(body.daily[1].totalTokens).toBe(6000);
    expect(body.daily[1].cost).toBe(0.004);
  });

  it("should return unauthorized when user is not authenticated", async () => {
    mockRequireSession.mockRejectedValue(unauthorized());

    const event = createAPIGatewayEventV2({
      routeKey: "GET /api/usage/daily",
      rawPath: "/api/usage/daily",
    });

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body || "{}");
    expect(body.message).toBe("Unauthorized");
    expect(mockRequireSession).toHaveBeenCalledWith(event);
    expect(mockDatabase).not.toHaveBeenCalled();
  });

  it("should return unauthorized when session has no user", async () => {
    mockRequireSession.mockResolvedValue({});

    const event = createAPIGatewayEventV2({
      routeKey: "GET /api/usage/daily",
      rawPath: "/api/usage/daily",
    });

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body || "{}");
    expect(body.message).toBe("Unauthorized");
    expect(mockRequireSession).toHaveBeenCalledWith(event);
  });

  it("should handle invalid date format", async () => {
    const mockSession = {
      user: {
        id: "user-123",
      },
    };

    mockRequireSession.mockResolvedValue(mockSession);

    const mockDb = createMockDatabase();
    mockDb.permission.query = vi.fn().mockResolvedValue({ items: [] });
    mockDatabase.mockResolvedValue(mockDb);

    const event = createAPIGatewayEventV2({
      routeKey: "GET /api/usage/daily",
      rawPath: "/api/usage/daily",
      queryStringParameters: {
        startDate: "invalid-date",
        endDate: "2024-01-01",
      },
    });

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body || "{}");
    expect(body.message).toContain("Invalid date format");
  });

  it("should use default date range (last 30 days) when not specified", async () => {
    const mockSession = {
      user: {
        id: "user-123",
      },
    };

    const mockPermissions = [
      {
        pk: "workspaces/workspace-1",
        sk: "users/user-123",
        resourceType: "workspaces",
        type: 1,
      },
    ];

    const emptyStats = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      conversationCount: 0,
      messagesIn: 0,
      messagesOut: 0,
      totalMessages: 0,
      byModel: {},
      byProvider: {},
      byByok: {
        byok: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        },
        platform: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        },
      },
      toolExpenses: {},
    };

    mockRequireSession.mockResolvedValue(mockSession);

    const mockDb = createMockDatabase();
    mockDb.permission.query = vi.fn().mockResolvedValue({
      items: mockPermissions,
    });
    mockDatabase.mockResolvedValue(mockDb);

    mockQueryUsageStats.mockResolvedValue(emptyStats);
    mockMergeUsageStats.mockReturnValue(emptyStats);

    const event = createAPIGatewayEventV2({
      routeKey: "GET /api/usage/daily",
      rawPath: "/api/usage/daily",
      // No date parameters
    });

    const result = await handler(event, mockContext, mockCallback);

    // Should query for 31 days (default: last 30 days + today = 31 days inclusive)
    expect(mockQueryUsageStats).toHaveBeenCalledTimes(31);
    expect(mockMergeUsageStats).toHaveBeenCalledTimes(31);

    const typedResult = result as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };
    const body = JSON.parse(typedResult.body || "{}");
    expect(body.daily).toHaveLength(31);
  });

  it("should handle empty workspace list", async () => {
    const mockSession = {
      user: {
        id: "user-123",
      },
    };

    mockRequireSession.mockResolvedValue(mockSession);

    const mockDb = createMockDatabase();
    mockDb.permission.query = vi.fn().mockResolvedValue({ items: [] });
    mockDatabase.mockResolvedValue(mockDb);

    const emptyStats = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      conversationCount: 0,
      messagesIn: 0,
      messagesOut: 0,
      totalMessages: 0,
      byModel: {},
      byProvider: {},
      byByok: {
        byok: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        },
        platform: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        },
      },
      toolExpenses: {},
    };

    mockMergeUsageStats.mockReturnValue(emptyStats);

    const event = createAPIGatewayEventV2({
      routeKey: "GET /api/usage/daily",
      rawPath: "/api/usage/daily",
      queryStringParameters: {
        startDate: "2024-01-01",
        endDate: "2024-01-01",
      },
    });

    const result = await handler(event, mockContext, mockCallback);

    // Should not call queryUsageStats when there are no workspaces
    expect(mockQueryUsageStats).not.toHaveBeenCalled();
    // But should still call mergeUsageStats with empty args for each day
    expect(mockMergeUsageStats).toHaveBeenCalledTimes(1);

    const typedResult = result as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };
    const body = JSON.parse(typedResult.body || "{}");
    expect(body.daily).toHaveLength(1);
    expect(body.daily[0].inputTokens).toBe(0);
    expect(body.daily[0].cost).toBe(0);
  });

  it("should handle single day date range", async () => {
    const mockSession = {
      user: {
        id: "user-123",
      },
    };

    const mockPermissions = [
      {
        pk: "workspaces/workspace-1",
        sk: "users/user-123",
        resourceType: "workspaces",
        type: 1,
      },
    ];

    const mockUsageStats = {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      costUsd: 0.001,
      conversationCount: 5,
      messagesIn: 10,
      messagesOut: 10,
      totalMessages: 20,
      byModel: {},
      byProvider: {},
      byByok: {
        byok: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        },
        platform: {
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
          costUsd: 0.001,
        },
      },
      toolExpenses: {},
    };

    mockRequireSession.mockResolvedValue(mockSession);

    const mockDb = createMockDatabase();
    mockDb.permission.query = vi.fn().mockResolvedValue({
      items: mockPermissions,
    });
    mockDatabase.mockResolvedValue(mockDb);

    mockQueryUsageStats.mockResolvedValue(mockUsageStats);
    mockMergeUsageStats.mockReturnValue(mockUsageStats);

    const event = createAPIGatewayEventV2({
      routeKey: "GET /api/usage/daily",
      rawPath: "/api/usage/daily",
      queryStringParameters: {
        startDate: "2024-01-01",
        endDate: "2024-01-01",
      },
    });

    const result = await handler(event, mockContext, mockCallback);

    expect(mockQueryUsageStats).toHaveBeenCalledTimes(1);
    expect(mockMergeUsageStats).toHaveBeenCalledTimes(1);

    const typedResult = result as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };
    const body = JSON.parse(typedResult.body || "{}");
    expect(body.daily).toHaveLength(1);
    expect(body.daily[0].date).toBe("2024-01-01");
  });

  it("should handle multiple workspaces correctly", async () => {
    const mockSession = {
      user: {
        id: "user-123",
      },
    };

    const mockPermissions = [
      {
        pk: "workspaces/workspace-1",
        sk: "users/user-123",
        resourceType: "workspaces",
        type: 1,
      },
      {
        pk: "workspaces/workspace-2",
        sk: "users/user-123",
        resourceType: "workspaces",
        type: 2,
      },
      {
        pk: "workspaces/workspace-3",
        sk: "users/user-123",
        resourceType: "workspaces",
        type: 1,
      },
    ];

    const mockUsageStats1 = {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      costUsd: 0.001,
      conversationCount: 5,
      messagesIn: 10,
      messagesOut: 10,
      totalMessages: 20,
      byModel: {},
      byProvider: {},
      byByok: {
        byok: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        },
        platform: {
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
          costUsd: 0.001,
        },
      },
      toolExpenses: {},
    };

    const mockUsageStats2 = {
      inputTokens: 2000,
      outputTokens: 1000,
      totalTokens: 3000,
      costUsd: 0.002,
      conversationCount: 8,
      messagesIn: 15,
      messagesOut: 15,
      totalMessages: 30,
      byModel: {},
      byProvider: {},
      byByok: {
        byok: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        },
        platform: {
          inputTokens: 2000,
          outputTokens: 1000,
          totalTokens: 3000,
          costUsd: 0.002,
        },
      },
      toolExpenses: {},
    };

    const mockUsageStats3 = {
      inputTokens: 500,
      outputTokens: 250,
      totalTokens: 750,
      costUsd: 0.0005,
      conversationCount: 2,
      messagesIn: 4,
      messagesOut: 4,
      totalMessages: 8,
      byModel: {},
      byProvider: {},
      byByok: {
        byok: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        },
        platform: {
          inputTokens: 500,
          outputTokens: 250,
          totalTokens: 750,
          costUsd: 0.0005,
        },
      },
      toolExpenses: {},
    };

    const mockMergedStats = {
      inputTokens: 3500,
      outputTokens: 1750,
      totalTokens: 5250,
      costUsd: 0.0035,
      conversationCount: 15,
      messagesIn: 29,
      messagesOut: 29,
      totalMessages: 58,
      byModel: {},
      byProvider: {},
      byByok: {
        byok: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        },
        platform: {
          inputTokens: 3500,
          outputTokens: 1750,
          totalTokens: 5250,
          costUsd: 0.0035,
        },
      },
      toolExpenses: {},
    };

    mockRequireSession.mockResolvedValue(mockSession);

    const mockDb = createMockDatabase();
    mockDb.permission.query = vi.fn().mockResolvedValue({
      items: mockPermissions,
    });
    mockDatabase.mockResolvedValue(mockDb);

    mockQueryUsageStats
      .mockResolvedValueOnce(mockUsageStats1)
      .mockResolvedValueOnce(mockUsageStats2)
      .mockResolvedValueOnce(mockUsageStats3);
    mockMergeUsageStats.mockReturnValue(mockMergedStats);

    const event = createAPIGatewayEventV2({
      routeKey: "GET /api/usage/daily",
      rawPath: "/api/usage/daily",
      queryStringParameters: {
        startDate: "2024-01-01",
        endDate: "2024-01-01",
      },
    });

    const result = await handler(event, mockContext, mockCallback);

    // Should query stats for 3 workspaces
    expect(mockQueryUsageStats).toHaveBeenCalledTimes(3);
    expect(mockMergeUsageStats).toHaveBeenCalledWith(
      mockUsageStats1,
      mockUsageStats2,
      mockUsageStats3
    );

    const typedResult = result as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };
    const body = JSON.parse(typedResult.body || "{}");
    expect(body.daily[0].inputTokens).toBe(3500);
    expect(body.daily[0].cost).toBe(0.0035);
  });
});
