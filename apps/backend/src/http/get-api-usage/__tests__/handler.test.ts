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

describe("get-api-usage handler", () => {
  const mockContext = createMockContext();
  const mockCallback = createMockCallback();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return usage stats for authenticated user", async () => {
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

    const mockUsageStats1 = {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      costUsd: 0.001,
      costByType: {
        textGeneration: 0.001,
        embeddings: 0,
        reranking: 0,
        tavily: 0,
        exa: 0,
        scrape: 0,
        imageGeneration: 0,
        eval: 0,
      },
      rerankingCostUsd: 0,
      evalCostUsd: 0,
      byModel: {
        "gemini-2.5-flash": {
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
          costUsd: 0.001,
        },
      },
      byProvider: {
        google: {
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
          costUsd: 0.001,
        },
      },
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
      costByType: {
        textGeneration: 0.002,
        embeddings: 0,
        reranking: 0,
        tavily: 0,
        exa: 0,
        scrape: 0,
        imageGeneration: 0,
        eval: 0,
      },
      rerankingCostUsd: 0,
      evalCostUsd: 0,
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
          costEur: 0.0018,
          costGbp: 0.0016,
        },
      },
      toolExpenses: {},
    };

    const mockMergedStats = {
      inputTokens: 3000,
      outputTokens: 1500,
      totalTokens: 4500,
      costUsd: 0.003,
      costByType: {
        textGeneration: 0.003,
        embeddings: 0,
        reranking: 0,
        tavily: 0,
        exa: 0,
        scrape: 0,
        imageGeneration: 0,
        eval: 0,
      },
      rerankingCostUsd: 0,
      evalCostUsd: 0,
      byModel: {
        "gemini-2.5-flash": {
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
          costUsd: 0.001,
        },
      },
      byProvider: {
        google: {
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
          costUsd: 0.001,
        },
      },
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
          costEur: 0.0027,
          costGbp: 0.0024,
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
      .mockResolvedValueOnce(mockUsageStats2);
    mockMergeUsageStats.mockReturnValue(mockMergedStats);

    const event = createAPIGatewayEventV2({
      routeKey: "GET /api/usage",
      rawPath: "/api/usage",
      queryStringParameters: {
        currency: "usd",
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
    expect(mockQueryUsageStats).toHaveBeenCalledTimes(2);
    expect(mockMergeUsageStats).toHaveBeenCalledWith(
      mockUsageStats1,
      mockUsageStats2
    );

    const typedResult = result as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };
    const body = JSON.parse(typedResult.body || "{}");
    expect(typedResult.statusCode).toBe(200);
    expect(body.userId).toBe("user-123");
    expect(body.currency).toBe("usd");
    expect(body.workspaceCount).toBe(2);
    expect(body.stats.inputTokens).toBe(3000);
    expect(body.stats.outputTokens).toBe(1500);
    expect(body.stats.totalTokens).toBe(4500);
    expect(body.stats.cost).toBe(0.003);
  });

  it("should return unauthorized when user is not authenticated", async () => {
    mockRequireSession.mockRejectedValue(unauthorized());

    const event = createAPIGatewayEventV2({
      routeKey: "GET /api/usage",
      rawPath: "/api/usage",
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
      routeKey: "GET /api/usage",
      rawPath: "/api/usage",
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

  it("should ignore currency parameter (always uses USD)", async () => {
    const mockSession = {
      user: {
        id: "user-123",
      },
    };

    mockRequireSession.mockResolvedValue(mockSession);

    const mockDb = createMockDatabase();
    mockDb.permission.query = vi.fn().mockResolvedValue({ items: [] });
    mockDatabase.mockResolvedValue(mockDb);

    mockQueryUsageStats.mockResolvedValue({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      costByType: {
        textGeneration: 0,
        embeddings: 0,
        reranking: 0,
        tavily: 0,
        exa: 0,
        scrape: 0,
        imageGeneration: 0,
        eval: 0,
      },
      rerankingCostUsd: 0,
      evalCostUsd: 0,
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
    });

    const event = createAPIGatewayEventV2({
      routeKey: "GET /api/usage",
      rawPath: "/api/usage",
      queryStringParameters: {
        currency: "invalid",
      },
    });

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    // Currency parameter is ignored, always returns USD
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body || "{}");
    expect(body.currency).toBe("usd");
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
      routeKey: "GET /api/usage",
      rawPath: "/api/usage",
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

  it("should use default currency (usd) when not specified", async () => {
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
      costByType: {
        textGeneration: 0.001,
        embeddings: 0,
        reranking: 0,
        tavily: 0,
        exa: 0,
        scrape: 0,
        imageGeneration: 0,
        eval: 0,
      },
      rerankingCostUsd: 0,
      evalCostUsd: 0,
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
      routeKey: "GET /api/usage",
      rawPath: "/api/usage",
      // No currency parameter
    });

    const result = await handler(event, mockContext, mockCallback);

    const typedResult = result as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };
    const body = JSON.parse(typedResult.body || "{}");
    expect(body.currency).toBe("usd");
    expect(body.stats.cost).toBe(0.001);
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
      routeKey: "GET /api/usage",
      rawPath: "/api/usage",
    });

    const result = await handler(event, mockContext, mockCallback);

    expect(mockQueryUsageStats).not.toHaveBeenCalled();
    expect(mockMergeUsageStats).toHaveBeenCalledWith();

    const typedResult = result as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };
    const body = JSON.parse(typedResult.body || "{}");
    expect(body.workspaceCount).toBe(0);
    expect(body.stats.inputTokens).toBe(0);
  });
});
