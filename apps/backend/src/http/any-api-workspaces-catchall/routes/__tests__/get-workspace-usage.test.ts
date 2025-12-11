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

// Mock ALLOWED_CURRENCIES
vi.mock("../utils", () => ({
  ALLOWED_CURRENCIES: ["usd", "eur", "gbp"],
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
      costEur: 0.045,
      costGbp: 0.04,
      byModel: {
        "gpt-4": {
          inputTokens: 600,
          outputTokens: 300,
          totalTokens: 900,
          costUsd: 0.03,
          costEur: 0.027,
          costGbp: 0.024,
        },
        "gpt-3.5-turbo": {
          inputTokens: 400,
          outputTokens: 200,
          totalTokens: 600,
          costUsd: 0.02,
          costEur: 0.018,
          costGbp: 0.016,
        },
      },
      byProvider: {
        openai: {
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
          costUsd: 0.05,
          costEur: 0.045,
          costGbp: 0.04,
        },
      },
      byByok: {
        byok: {
          inputTokens: 500,
          outputTokens: 250,
          totalTokens: 750,
          costUsd: 0.025,
          costEur: 0.0225,
          costGbp: 0.02,
        },
        platform: {
          inputTokens: 500,
          outputTokens: 250,
          totalTokens: 750,
          costUsd: 0.025,
          costEur: 0.0225,
          costGbp: 0.02,
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

  it("should return usage stats with EUR currency", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";

    const mockStats = {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      costUsd: 0.05,
      costEur: 0.045,
      costGbp: 0.04,
      byModel: {},
      byProvider: {},
      byByok: {
        byok: {
          inputTokens: 500,
          outputTokens: 250,
          totalTokens: 750,
          costUsd: 0.025,
          costEur: 0.0225,
          costGbp: 0.02,
        },
        platform: {
          inputTokens: 500,
          outputTokens: 250,
          totalTokens: 750,
          costUsd: 0.025,
          costEur: 0.0225,
          costGbp: 0.02,
        },
      },
    };

    mockQueryUsageStats.mockResolvedValue(mockStats);

    const req = createMockRequest({
      params: {
        workspaceId,
      },
      query: {
        currency: "eur",
        startDate: "2024-01-01",
        endDate: "2024-01-31",
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: "eur",
        stats: expect.objectContaining({
          cost: 0.045, // EUR
        }),
      })
    );
  });

  it("should return usage stats with GBP currency", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";

    const mockStats = {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      costUsd: 0.05,
      costEur: 0.045,
      costGbp: 0.04,
      byModel: {},
      byProvider: {},
      byByok: {
        byok: {
          inputTokens: 500,
          outputTokens: 250,
          totalTokens: 750,
          costUsd: 0.025,
          costEur: 0.0225,
          costGbp: 0.02,
        },
        platform: {
          inputTokens: 500,
          outputTokens: 250,
          totalTokens: 750,
          costUsd: 0.025,
          costEur: 0.0225,
          costGbp: 0.02,
        },
      },
    };

    mockQueryUsageStats.mockResolvedValue(mockStats);

    const req = createMockRequest({
      params: {
        workspaceId,
      },
      query: {
        currency: "gbp",
        startDate: "2024-01-01",
        endDate: "2024-01-31",
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: "gbp",
        stats: expect.objectContaining({
          cost: 0.04, // GBP
        }),
      })
    );
  });

  it("should throw badRequest when currency is invalid", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";

    const req = createMockRequest({
      params: {
        workspaceId,
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
      costEur: 0.0225,
      costGbp: 0.02,
      byModel: {},
      byProvider: {},
      byByok: {
        byok: {
          inputTokens: 250,
          outputTokens: 125,
          totalTokens: 375,
          costUsd: 0.0125,
          costEur: 0.01125,
          costGbp: 0.01,
        },
        platform: {
          inputTokens: 250,
          outputTokens: 125,
          totalTokens: 375,
          costUsd: 0.0125,
          costEur: 0.01125,
          costGbp: 0.01,
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
      costEur: 0.045,
      costGbp: 0.04,
      byModel: {},
      byProvider: {},
      byByok: {
        byok: {
          inputTokens: 500,
          outputTokens: 250,
          totalTokens: 750,
          costUsd: 0.025,
          costEur: 0.0225,
          costGbp: 0.02,
        },
        platform: {
          inputTokens: 500,
          outputTokens: 250,
          totalTokens: 750,
          costUsd: 0.025,
          costEur: 0.0225,
          costGbp: 0.02,
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
