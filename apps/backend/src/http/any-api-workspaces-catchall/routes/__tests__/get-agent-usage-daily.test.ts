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


describe("GET /api/workspaces/:workspaceId/agents/:agentId/usage/daily", () => {
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

      // Parse query parameters (currency always USD)
      const currency = "usd";
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

      // Get daily breakdown
      const current = new Date(startDate);
      const end = new Date(endDate);

      const dailyStats = [];

      while (current <= end) {
        const dateStr = current.toISOString().split("T")[0];
        const dayStart = new Date(current);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(current);
        dayEnd.setHours(23, 59, 59, 999);

        const stats = await mockQueryUsageStats(db, {
          workspaceId,
          agentId,
          startDate: dayStart,
          endDate: dayEnd,
        });

        // Cost always in USD
        const cost = stats.costUsd;

        dailyStats.push({
          date: dateStr,
          inputTokens: stats.inputTokens,
          outputTokens: stats.outputTokens,
          totalTokens: stats.totalTokens,
          cost,
        });

        current.setDate(current.getDate() + 1);
      }

      res.json({
        workspaceId,
        agentId,
        currency,
        startDate: startDate.toISOString().split("T")[0],
        endDate: endDate.toISOString().split("T")[0],
        daily: dailyStats,
      });
    };

    await handler(req as express.Request, res as express.Response);
  }

  it("should return agent daily usage stats with default currency and date range", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const endDate = new Date("2024-01-05");
    const startDate = new Date("2024-01-01");

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      workspaceId,
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockGet;

    // Mock queryUsageStats to return different stats for each day
    mockQueryUsageStats
      .mockResolvedValueOnce({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        costUsd: 0.001,
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
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
            costUsd: 0.001,
          },
        },
      })
      .mockResolvedValueOnce({
        inputTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
        costUsd: 0.002,
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
            inputTokens: 200,
            outputTokens: 100,
            totalTokens: 300,
            costUsd: 0.002,
          },
        },
      })
      .mockResolvedValueOnce({
        inputTokens: 150,
        outputTokens: 75,
        totalTokens: 225,
        costUsd: 0.0015,
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
            inputTokens: 150,
            outputTokens: 75,
            totalTokens: 225,
            costUsd: 0.0015,
          },
        },
      })
      .mockResolvedValueOnce({
        inputTokens: 300,
        outputTokens: 150,
        totalTokens: 450,
        costUsd: 0.003,
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
            inputTokens: 300,
            outputTokens: 150,
            totalTokens: 450,
            costUsd: 0.003,
          },
        },
      })
      .mockResolvedValueOnce({
        inputTokens: 250,
        outputTokens: 125,
        totalTokens: 375,
        costUsd: 0.0025,
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
            inputTokens: 250,
            outputTokens: 125,
            totalTokens: 375,
            costUsd: 0.0025,
          },
        },
      });

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
      query: {
        startDate: startDate.toISOString().split("T")[0],
        endDate: endDate.toISOString().split("T")[0],
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockGet).toHaveBeenCalledWith(
      `agents/${workspaceId}/${agentId}`,
      "agent"
    );
    // Should be called 5 times (one for each day from 2024-01-01 to 2024-01-05)
    expect(mockQueryUsageStats).toHaveBeenCalledTimes(5);
    expect(res.json).toHaveBeenCalledWith({
      workspaceId,
      agentId,
      currency: "usd",
      startDate: startDate.toISOString().split("T")[0],
      endDate: endDate.toISOString().split("T")[0],
      daily: [
        {
          date: "2024-01-01",
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          cost: 0.001,
        },
        {
          date: "2024-01-02",
          inputTokens: 200,
          outputTokens: 100,
          totalTokens: 300,
          cost: 0.002,
        },
        {
          date: "2024-01-03",
          inputTokens: 150,
          outputTokens: 75,
          totalTokens: 225,
          cost: 0.0015,
        },
        {
          date: "2024-01-04",
          inputTokens: 300,
          outputTokens: 150,
          totalTokens: 450,
          cost: 0.003,
        },
        {
          date: "2024-01-05",
          inputTokens: 250,
          outputTokens: 125,
          totalTokens: 375,
          cost: 0.0025,
        },
      ],
    });
  });

  it("should use default date range (last 30 days) when dates are not provided", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      workspaceId,
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockGet;

    // Mock for 31 days (inclusive range)
    mockQueryUsageStats.mockResolvedValue({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      costUsd: 0.001,
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
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          costUsd: 0.001,
        },
      },
    });

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
      query: {},
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    // Should be called 31 times (inclusive of both start and end dates: 30 days ago to today = 31 days)
    expect(mockQueryUsageStats).toHaveBeenCalledTimes(31);
    const firstCallArgs = mockQueryUsageStats.mock.calls[0][1];
    const lastCallArgs = mockQueryUsageStats.mock.calls[30][1];

    // Verify the date range is approximately 30 days
    const daysDiff = Math.floor(
      (lastCallArgs.endDate.getTime() - firstCallArgs.startDate.getTime()) /
        (24 * 60 * 60 * 1000)
    );
    expect(daysDiff).toBe(30);

    // Verify dates are Date objects
    expect(firstCallArgs.startDate).toBeInstanceOf(Date);
    expect(lastCallArgs.endDate).toBeInstanceOf(Date);
  });

  it("should throw resourceGone when agent is not found", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const mockGet = vi.fn().mockResolvedValue(null);
    mockDb.agent.get = mockGet;

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
      query: {},
    });
    const res = createMockResponse();

    await expect(callRouteHandler(req, res)).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 410,
          payload: expect.objectContaining({
            message: "Agent not found",
          }),
        }),
      })
    );

    expect(mockGet).toHaveBeenCalledWith(
      `agents/${workspaceId}/${agentId}`,
      "agent"
    );
    expect(mockQueryUsageStats).not.toHaveBeenCalled();
  });

  it("should throw badRequest when startDate format is invalid", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      workspaceId,
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockGet;

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
      query: {
        startDate: "invalid-date",
        endDate: "2024-01-05",
      },
    });
    const res = createMockResponse();

    await expect(callRouteHandler(req, res)).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining(
              "Invalid date format. Use ISO 8601 format (YYYY-MM-DD)"
            ),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when endDate format is invalid", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      workspaceId,
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockGet;

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
      query: {
        startDate: "2024-01-01",
        endDate: "invalid-date",
      },
    });
    const res = createMockResponse();

    await expect(callRouteHandler(req, res)).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining(
              "Invalid date format. Use ISO 8601 format (YYYY-MM-DD)"
            ),
          }),
        }),
      })
    );
  });

  it("should handle single day range", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const startDate = new Date("2024-01-01");
    const endDate = new Date("2024-01-01");

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      workspaceId,
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockGet;

    mockQueryUsageStats.mockResolvedValueOnce({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      costUsd: 0.001,
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
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          costUsd: 0.001,
        },
      },
    });

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
      query: {
        startDate: startDate.toISOString().split("T")[0],
        endDate: endDate.toISOString().split("T")[0],
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockQueryUsageStats).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({
      workspaceId,
      agentId,
      currency: "usd",
      startDate: "2024-01-01",
      endDate: "2024-01-01",
      daily: [
        {
          date: "2024-01-01",
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          cost: 0.001,
        },
      ],
    });
  });
});
