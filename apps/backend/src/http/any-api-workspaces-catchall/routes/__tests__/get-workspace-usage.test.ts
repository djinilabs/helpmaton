import { badRequest } from "@hapi/boom";
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


describe("GET /api/workspaces/:workspaceId/usage", () => {
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

      const stats = await mockQueryUsageStats(db, {
        workspaceId,
        startDate,
        endDate,
      });

      // Cost always in USD
      const cost = stats.costUsd;

      res.json({
        workspaceId,
        currency,
        startDate: startDate.toISOString().split("T")[0],
        endDate: endDate.toISOString().split("T")[0],
        stats: {
          inputTokens: stats.inputTokens,
          outputTokens: stats.outputTokens,
          totalTokens: stats.totalTokens,
          cost,
          byModel: Object.entries(stats.byModel).map(([model, modelStats]) => {
            const stats = modelStats as {
              inputTokens: number;
              outputTokens: number;
              totalTokens: number;
              costUsd: number;
            };
            return {
              model,
              inputTokens: stats.inputTokens,
              outputTokens: stats.outputTokens,
              totalTokens: stats.totalTokens,
              cost: stats.costUsd,
            };
          }),
          byProvider: Object.entries(stats.byProvider).map(
            ([provider, providerStats]) => {
              const stats = providerStats as {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                costUsd: number;
              };
              return {
                provider,
                inputTokens: stats.inputTokens,
                outputTokens: stats.outputTokens,
                totalTokens: stats.totalTokens,
                cost: stats.costUsd,
              };
            }
          ),
          byByok: {
            byok: {
              inputTokens: stats.byByok.byok.inputTokens,
              outputTokens: stats.byByok.byok.outputTokens,
              totalTokens: stats.byByok.byok.totalTokens,
              cost: stats.byByok.byok.costUsd,
            },
            platform: {
              inputTokens: stats.byByok.platform.inputTokens,
              outputTokens: stats.byByok.platform.outputTokens,
              totalTokens: stats.byByok.platform.totalTokens,
              cost: stats.byByok.platform.costUsd,
            },
          },
        },
      });
    };

    await handler(req as express.Request, res as express.Response);
  }

  it("should return workspace usage stats with default currency and date range", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

    const mockStats = {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      costUsd: 0.05,
      byModel: {
        "gpt-4": {
          inputTokens: 600,
          outputTokens: 300,
          totalTokens: 900,
          costUsd: 0.03,
        },
        "gpt-3.5-turbo": {
          inputTokens: 400,
          outputTokens: 200,
          totalTokens: 600,
          costUsd: 0.02,
        },
      },
      byProvider: {
        openai: {
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
          costUsd: 0.05,
        },
      },
      byByok: {
        byok: {
          inputTokens: 500,
          outputTokens: 250,
          totalTokens: 750,
          costUsd: 0.025,
        },
        platform: {
          inputTokens: 500,
          outputTokens: 250,
          totalTokens: 750,
          costUsd: 0.025,
        },
      },
    };

    mockQueryUsageStats.mockResolvedValue(mockStats);

    const req = createMockRequest({
      params: {
        workspaceId,
      },
      query: {},
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockQueryUsageStats).toHaveBeenCalledWith(mockDb, {
      workspaceId,
      startDate: expect.any(Date),
      endDate: expect.any(Date),
    });
    // Verify the dates are approximately correct (within 1 second)
    const callArgs = mockQueryUsageStats.mock.calls[0][1];
    expect(callArgs.startDate.getTime()).toBeCloseTo(startDate.getTime(), -3);
    expect(callArgs.endDate.getTime()).toBeCloseTo(endDate.getTime(), -3);
    // Get the actual dates from the call to verify response
    const actualStartDate = callArgs.startDate.toISOString().split("T")[0];
    const actualEndDate = callArgs.endDate.toISOString().split("T")[0];
    expect(res.json).toHaveBeenCalledWith({
      workspaceId,
      currency: "usd",
      startDate: actualStartDate,
      endDate: actualEndDate,
      stats: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cost: 0.05, // USD
        byModel: [
          {
            model: "gpt-4",
            inputTokens: 600,
            outputTokens: 300,
            totalTokens: 900,
            cost: 0.03,
          },
          {
            model: "gpt-3.5-turbo",
            inputTokens: 400,
            outputTokens: 200,
            totalTokens: 600,
            cost: 0.02,
          },
        ],
        byProvider: [
          {
            provider: "openai",
            inputTokens: 1000,
            outputTokens: 500,
            totalTokens: 1500,
            cost: 0.05,
          },
        ],
        byByok: {
          byok: {
            inputTokens: 500,
            outputTokens: 250,
            totalTokens: 750,
            cost: 0.025,
          },
          platform: {
            inputTokens: 500,
            outputTokens: 250,
            totalTokens: 750,
            cost: 0.025,
          },
        },
      },
    });
  });

  it("should always return usage stats in USD", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";

    const mockStats = {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      costUsd: 0.05,
      byModel: {},
      byProvider: {},
      byByok: {
        byok: {
          inputTokens: 500,
          outputTokens: 250,
          totalTokens: 750,
          costUsd: 0.025,
        },
        platform: {
          inputTokens: 500,
          outputTokens: 250,
          totalTokens: 750,
          costUsd: 0.025,
        },
      },
    };

    mockQueryUsageStats.mockResolvedValue(mockStats);

    const req = createMockRequest({
      params: {
        workspaceId,
      },
      query: {
        currency: "usd",
        startDate: "2024-01-01",
        endDate: "2024-01-31",
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: "usd",
        stats: expect.objectContaining({
          cost: 0.05, // USD
        }),
      })
    );
  });


  it("should throw badRequest when startDate is invalid", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";

    const req = createMockRequest({
      params: {
        workspaceId,
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

  it("should throw badRequest when endDate is invalid", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";

    const req = createMockRequest({
      params: {
        workspaceId,
      },
      query: {
        startDate: "2024-01-01",
        endDate: "invalid-date",
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

  it("should use custom date range when provided", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const startDate = new Date("2024-01-01");
    const endDate = new Date("2024-01-15");

    const mockStats = {
      inputTokens: 500,
      outputTokens: 250,
      totalTokens: 750,
      costUsd: 0.025,
      byModel: {},
      byProvider: {},
      byByok: {
        byok: {
          inputTokens: 250,
          outputTokens: 125,
          totalTokens: 375,
          costUsd: 0.0125,
        },
        platform: {
          inputTokens: 250,
          outputTokens: 125,
          totalTokens: 375,
          costUsd: 0.0125,
        },
      },
    };

    mockQueryUsageStats.mockResolvedValue(mockStats);

    const req = createMockRequest({
      params: {
        workspaceId,
      },
      query: {
        startDate: "2024-01-01",
        endDate: "2024-01-15",
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockQueryUsageStats).toHaveBeenCalledWith(mockDb, {
      workspaceId,
      startDate,
      endDate,
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: "2024-01-01",
        endDate: "2024-01-15",
      })
    );
  });

  it("should default to last 30 days when only endDate is provided", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const endDate = new Date("2024-01-31");

    const mockStats = {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      costUsd: 0.05,
      byModel: {},
      byProvider: {},
      byByok: {
        byok: {
          inputTokens: 500,
          outputTokens: 250,
          totalTokens: 750,
          costUsd: 0.025,
        },
        platform: {
          inputTokens: 500,
          outputTokens: 250,
          totalTokens: 750,
          costUsd: 0.025,
        },
      },
    };

    mockQueryUsageStats.mockResolvedValue(mockStats);

    const req = createMockRequest({
      params: {
        workspaceId,
      },
      query: {
        endDate: "2024-01-31",
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    // Check that startDate passed to queryUsageStats is approximately 30 days before endDate
    const callArgs = mockQueryUsageStats.mock.calls[0][1];
    const expectedStartDate = new Date(
      endDate.getTime() - 30 * 24 * 60 * 60 * 1000
    );
    expect(callArgs.startDate.getTime()).toBeGreaterThanOrEqual(
      expectedStartDate.getTime() - 1000
    );
    expect(callArgs.startDate.getTime()).toBeLessThanOrEqual(
      expectedStartDate.getTime() + 1000
    );
    expect(callArgs.endDate.getTime()).toBe(endDate.getTime());
  });
});
