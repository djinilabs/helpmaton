import { badRequest, resourceGone } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDatabase, mockQueryUsageStats } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockQueryUsageStats: vi.fn(),
  };
});

// Mock the modules
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/aggregation", () => ({
  queryUsageStats: mockQueryUsageStats,
}));

// Mock ALLOWED_CURRENCIES
vi.mock("../utils", () => ({
  ALLOWED_CURRENCIES: ["usd", "eur", "gbp"],
}));

describe("GET /api/workspaces/:workspaceId/agents/:agentId/usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>
  ) {
    // Extract the handler logic directly
    const handler = async (req: express.Request, res: express.Response) => {
      const db = await mockDatabase();
      const workspaceId = req.params.workspaceId;
      const agentId = req.params.agentId;

      // Verify agent belongs to workspace
      const agentPk = `agents/${workspaceId}/${agentId}`;
      const agent = await db.agent.get(agentPk, "agent");
      if (!agent) {
        throw resourceGone("Agent not found");
      }

      // Parse query parameters
      const currencyParam = req.query.currency as string | undefined;
      const ALLOWED_CURRENCIES = ["usd", "eur", "gbp"];
      const currency: "usd" | "eur" | "gbp" = currencyParam
        ? ALLOWED_CURRENCIES.includes(currencyParam as "usd" | "eur" | "gbp")
          ? (currencyParam as "usd" | "eur" | "gbp")
          : (() => {
              throw badRequest(
                `Invalid currency. Allowed values: ${ALLOWED_CURRENCIES.join(
                  ", "
                )}`
              );
            })()
        : "usd";
      const startDateStr = req.query.startDate as string;
      const endDateStr = req.query.endDate as string;

      const endDate = endDateStr ? new Date(endDateStr) : new Date();
      const startDate = startDateStr
        ? new Date(startDateStr)
        : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000); // Default to last 30 days

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw badRequest(
          "Invalid date format. Use ISO 8601 format (YYYY-MM-DD)"
        );
      }

      const stats = await mockQueryUsageStats(db, {
        workspaceId,
        agentId,
        startDate,
        endDate,
      });

      // Select cost based on currency
      const cost =
        currency === "usd"
          ? stats.costUsd
          : currency === "eur"
          ? stats.costEur
          : stats.costGbp;

      res.json({
        workspaceId,
        agentId,
        currency,
        startDate: startDate.toISOString().split("T")[0],
        endDate: endDate.toISOString().split("T")[0],
        stats: {
          inputTokens: stats.inputTokens,
          outputTokens: stats.outputTokens,
          totalTokens: stats.totalTokens,
          cost,
          byModel: (
            Object.entries(stats.byModel) as [
              string,
              {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                costUsd: number;
                costEur: number;
                costGbp: number;
              }
            ][]
          ).map(([model, modelStats]) => ({
            model,
            inputTokens: modelStats.inputTokens,
            outputTokens: modelStats.outputTokens,
            totalTokens: modelStats.totalTokens,
            cost:
              currency === "usd"
                ? modelStats.costUsd
                : currency === "eur"
                ? modelStats.costEur
                : modelStats.costGbp,
          })),
          byProvider: (
            Object.entries(stats.byProvider) as [
              string,
              {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                costUsd: number;
                costEur: number;
                costGbp: number;
              }
            ][]
          ).map(([provider, providerStats]) => ({
            provider,
            inputTokens: providerStats.inputTokens,
            outputTokens: providerStats.outputTokens,
            totalTokens: providerStats.totalTokens,
            cost:
              currency === "usd"
                ? providerStats.costUsd
                : currency === "eur"
                ? providerStats.costEur
                : providerStats.costGbp,
          })),
          byByok: {
            byok: {
              inputTokens: stats.byByok.byok.inputTokens,
              outputTokens: stats.byByok.byok.outputTokens,
              totalTokens: stats.byByok.byok.totalTokens,
              cost:
                currency === "usd"
                  ? stats.byByok.byok.costUsd
                  : currency === "eur"
                  ? stats.byByok.byok.costEur
                  : stats.byByok.byok.costGbp,
            },
            platform: {
              inputTokens: stats.byByok.platform.inputTokens,
              outputTokens: stats.byByok.platform.outputTokens,
              totalTokens: stats.byByok.platform.totalTokens,
              cost:
                currency === "usd"
                  ? stats.byByok.platform.costUsd
                  : currency === "eur"
                  ? stats.byByok.platform.costEur
                  : stats.byByok.platform.costGbp,
            },
          },
        },
      });
    };

    await handler(req as express.Request, res as express.Response);
  }

  it("should return agent usage stats with default currency (usd)", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      name: "Test Agent",
    };

    const mockStats = {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      costUsd: 0.01,
      costEur: 0.009,
      costGbp: 0.008,
      byModel: {
        "gpt-4": {
          inputTokens: 800,
          outputTokens: 400,
          totalTokens: 1200,
          costUsd: 0.008,
          costEur: 0.007,
          costGbp: 0.006,
        },
      },
      byProvider: {
        openai: {
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
          costUsd: 0.01,
          costEur: 0.009,
          costGbp: 0.008,
        },
      },
      byByok: {
        byok: {
          inputTokens: 500,
          outputTokens: 250,
          totalTokens: 750,
          costUsd: 0.005,
          costEur: 0.0045,
          costGbp: 0.004,
        },
        platform: {
          inputTokens: 500,
          outputTokens: 250,
          totalTokens: 750,
          costUsd: 0.005,
          costEur: 0.0045,
          costGbp: 0.004,
        },
      },
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    mockQueryUsageStats.mockResolvedValue(mockStats);

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
      query: {},
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockAgentGet).toHaveBeenCalledWith(
      `agents/${workspaceId}/${agentId}`,
      "agent"
    );
    expect(mockQueryUsageStats).toHaveBeenCalled();
    const callArgs = mockQueryUsageStats.mock.calls[0];
    expect(callArgs[1]).toMatchObject({
      workspaceId,
      agentId,
    });
    expect(callArgs[1].startDate).toBeInstanceOf(Date);
    expect(callArgs[1].endDate).toBeInstanceOf(Date);

    const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(response.workspaceId).toBe(workspaceId);
    expect(response.agentId).toBe(agentId);
    expect(response.currency).toBe("usd");
    expect(response.stats.inputTokens).toBe(1000);
    expect(response.stats.outputTokens).toBe(500);
    expect(response.stats.totalTokens).toBe(1500);
    expect(response.stats.cost).toBe(0.01);
    expect(response.stats.byModel).toHaveLength(1);
    expect(response.stats.byProvider).toHaveLength(1);
  });

  it("should return agent usage stats with eur currency", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      name: "Test Agent",
    };

    const mockStats = {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      costUsd: 0.01,
      costEur: 0.009,
      costGbp: 0.008,
      byModel: {},
      byProvider: {},
      byByok: {
        byok: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          costEur: 0,
          costGbp: 0,
        },
        platform: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          costEur: 0,
          costGbp: 0,
        },
      },
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    mockQueryUsageStats.mockResolvedValue(mockStats);

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
      query: {
        currency: "eur",
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(response.currency).toBe("eur");
    expect(response.stats.cost).toBe(0.009);
  });

  it("should return agent usage stats with gbp currency", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      name: "Test Agent",
    };

    const mockStats = {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      costUsd: 0.01,
      costEur: 0.009,
      costGbp: 0.008,
      byModel: {},
      byProvider: {},
      byByok: {
        byok: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          costEur: 0,
          costGbp: 0,
        },
        platform: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          costEur: 0,
          costGbp: 0,
        },
      },
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    mockQueryUsageStats.mockResolvedValue(mockStats);

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
      query: {
        currency: "gbp",
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(response.currency).toBe("gbp");
    expect(response.stats.cost).toBe(0.008);
  });

  it("should throw badRequest when currency is invalid", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      name: "Test Agent",
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
      query: {
        currency: "invalid",
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
      ).toContain("Invalid currency");
    }

    expect(mockQueryUsageStats).not.toHaveBeenCalled();
  });

  it("should throw resourceGone when agent does not exist", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const mockAgentGet = vi.fn().mockResolvedValue(null);
    mockDb.agent.get = mockAgentGet;

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
      query: {},
    });
    const res = createMockResponse();

    try {
      await callRouteHandler(req, res);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(
        (error as { output?: { statusCode: number } }).output?.statusCode
      ).toBe(410);
      expect(
        (error as { output?: { payload: { message: string } } }).output?.payload
          .message
      ).toContain("Agent not found");
    }

    expect(mockQueryUsageStats).not.toHaveBeenCalled();
  });

  it("should use custom date range when provided", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      name: "Test Agent",
    };

    const mockStats = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      costEur: 0,
      costGbp: 0,
      byModel: {},
      byProvider: {},
      byByok: {
        byok: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          costEur: 0,
          costGbp: 0,
        },
        platform: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          costEur: 0,
          costGbp: 0,
        },
      },
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    mockQueryUsageStats.mockResolvedValue(mockStats);

    const startDate = "2024-01-01";
    const endDate = "2024-01-31";

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
      query: {
        startDate,
        endDate,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockQueryUsageStats).toHaveBeenCalled();
    const callArgs = mockQueryUsageStats.mock.calls[0];
    expect(callArgs[1].startDate).toEqual(new Date(startDate));
    expect(callArgs[1].endDate).toEqual(new Date(endDate));

    const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(response.startDate).toBe(startDate);
    expect(response.endDate).toBe(endDate);
  });

  it("should default to last 30 days when dates not provided", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      name: "Test Agent",
    };

    const mockStats = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      costEur: 0,
      costGbp: 0,
      byModel: {},
      byProvider: {},
      byByok: {
        byok: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          costEur: 0,
          costGbp: 0,
        },
        platform: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          costEur: 0,
          costGbp: 0,
        },
      },
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    mockQueryUsageStats.mockResolvedValue(mockStats);

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
      query: {},
    });
    const res = createMockResponse();

    const beforeCall = new Date();
    await callRouteHandler(req, res);
    const afterCall = new Date();

    expect(mockQueryUsageStats).toHaveBeenCalled();
    const callArgs = mockQueryUsageStats.mock.calls[0];
    const startDate = callArgs[1].startDate as Date;
    const endDate = callArgs[1].endDate as Date;

    // Check that endDate is approximately now
    expect(endDate.getTime()).toBeGreaterThanOrEqual(
      beforeCall.getTime() - 1000
    );
    expect(endDate.getTime()).toBeLessThanOrEqual(afterCall.getTime() + 1000);

    // Check that startDate is approximately 30 days before endDate
    const expectedStartDate = new Date(
      endDate.getTime() - 30 * 24 * 60 * 60 * 1000
    );
    expect(startDate.getTime()).toBeGreaterThanOrEqual(
      expectedStartDate.getTime() - 1000
    );
    expect(startDate.getTime()).toBeLessThanOrEqual(
      expectedStartDate.getTime() + 1000
    );
  });

  it("should throw badRequest when date format is invalid", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      name: "Test Agent",
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
      query: {
        startDate: "invalid-date",
        endDate: "2024-01-31",
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
      ).toContain("Invalid date format");
    }

    expect(mockQueryUsageStats).not.toHaveBeenCalled();
  });

  it("should handle stats with multiple models and providers", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      name: "Test Agent",
    };

    const mockStats = {
      inputTokens: 2000,
      outputTokens: 1000,
      totalTokens: 3000,
      costUsd: 0.02,
      costEur: 0.018,
      costGbp: 0.016,
      byModel: {
        "gpt-4": {
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
          costUsd: 0.01,
          costEur: 0.009,
          costGbp: 0.008,
        },
        "gpt-3.5-turbo": {
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
          costUsd: 0.01,
          costEur: 0.009,
          costGbp: 0.008,
        },
      },
      byProvider: {
        openai: {
          inputTokens: 1500,
          outputTokens: 750,
          totalTokens: 2250,
          costUsd: 0.015,
          costEur: 0.0135,
          costGbp: 0.012,
        },
        anthropic: {
          inputTokens: 500,
          outputTokens: 250,
          totalTokens: 750,
          costUsd: 0.005,
          costEur: 0.0045,
          costGbp: 0.004,
        },
      },
      byByok: {
        byok: {
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
          costUsd: 0.01,
          costEur: 0.009,
          costGbp: 0.008,
        },
        platform: {
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
          costUsd: 0.01,
          costEur: 0.009,
          costGbp: 0.008,
        },
      },
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    mockQueryUsageStats.mockResolvedValue(mockStats);

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
      query: {},
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(response.stats.byModel).toHaveLength(2);
    expect(response.stats.byProvider).toHaveLength(2);
    expect(response.stats.byModel[0].model).toBe("gpt-4");
    expect(response.stats.byModel[1].model).toBe("gpt-3.5-turbo");
    expect(response.stats.byProvider[0].provider).toBe("openai");
    expect(response.stats.byProvider[1].provider).toBe("anthropic");
  });
});
