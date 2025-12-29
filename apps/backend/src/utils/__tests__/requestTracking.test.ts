import { describe, it, expect, vi, beforeEach } from "vitest";

import type {
  RequestBucketRecord,
  SubscriptionRecord,
} from "../../tables/schema";
import {
  getCurrentHourTimestamp,
  getLast24HourTimestamps,
  incrementRequestBucketByCategory,
  getRequestCountLast24HoursByCategory,
  checkDailyRequestLimit,
  incrementSearchRequestBucket,
  incrementFetchRequestBucket,
  getSearchRequestCountLast24Hours,
  getFetchRequestCountLast24Hours,
  checkTavilyDailyLimit,
  // Legacy functions for backward compatibility
  incrementRequestBucket,
  getRequestCountLast24Hours,
  incrementTavilyCallBucket,
  getTavilyCallCountLast24Hours,
} from "../requestTracking";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const {
  mockDatabase,
  mockGetSubscriptionById,
  mockGetUserEmailById,
  mockGetPlanLimits,
  mockSendEmail,
  mockGetWorkspaceSubscription,
} = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockGetSubscriptionById: vi.fn(),
    mockGetUserEmailById: vi.fn(),
    mockGetPlanLimits: vi.fn(),
    mockSendEmail: vi.fn(),
    mockGetWorkspaceSubscription: vi.fn(),
  };
});

// Mock the database module
vi.mock("../../tables/database", () => ({
  database: mockDatabase,
}));

// Mock subscription utilities
vi.mock("../subscriptionUtils", () => ({
  getSubscriptionById: mockGetSubscriptionById,
  getUserEmailById: mockGetUserEmailById,
  getWorkspaceSubscription: mockGetWorkspaceSubscription,
}));

// Mock subscription plans
vi.mock("../subscriptionPlans", () => ({
  getPlanLimits: mockGetPlanLimits,
}));

// Mock send email
vi.mock("../../send-email", () => ({
  sendEmail: mockSendEmail,
}));

describe("requestTracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset Date.now() mock if it was set
    vi.useRealTimers();
  });

  describe("getCurrentHourTimestamp", () => {
    it("should return timestamp truncated to hour", () => {
      const now = new Date("2024-01-15T14:37:22.123Z");
      vi.setSystemTime(now);

      const result = getCurrentHourTimestamp();

      // Should be truncated to hour: 14:00:00.000Z
      expect(result).toBe("2024-01-15T14:00:00.000Z");
    });

    it("should handle midnight correctly", () => {
      const now = new Date("2024-01-15T00:00:00.000Z");
      vi.setSystemTime(now);

      const result = getCurrentHourTimestamp();

      expect(result).toBe("2024-01-15T00:00:00.000Z");
    });
  });

  describe("getLast24HourTimestamps", () => {
    it("should return array of 24 hour timestamps", () => {
      const now = new Date("2024-01-15T14:00:00.000Z");
      vi.setSystemTime(now);

      const timestamps = getLast24HourTimestamps();

      expect(timestamps).toHaveLength(24);
      // Most recent first
      expect(timestamps[0]).toBe("2024-01-15T14:00:00.000Z");
      expect(timestamps[1]).toBe("2024-01-15T13:00:00.000Z");
      expect(timestamps[23]).toBe("2024-01-14T15:00:00.000Z");
    });

    it("should handle day boundaries correctly", () => {
      const now = new Date("2024-01-15T02:00:00.000Z");
      vi.setSystemTime(now);

      const timestamps = getLast24HourTimestamps();

      expect(timestamps[0]).toBe("2024-01-15T02:00:00.000Z");
      expect(timestamps[2]).toBe("2024-01-15T00:00:00.000Z");
      expect(timestamps[3]).toBe("2024-01-14T23:00:00.000Z");
    });
  });

  describe("incrementRequestBucketByCategory", () => {
    const mockDb = {
      "request-buckets": {
        atomicUpdate: vi.fn(),
      },
    };

    beforeEach(() => {
      mockDatabase.mockResolvedValue(mockDb);
    });

    it("should create new bucket if it doesn't exist for llm category", async () => {
      const subscriptionId = "sub-123";
      const category = "llm" as const;
      const now = new Date("2024-01-15T14:00:00.000Z");
      vi.setSystemTime(now);

      const createdBucket: RequestBucketRecord = {
        pk: `request-buckets/${subscriptionId}/${category}/2024-01-15T14:00:00.000Z`,
        subscriptionId,
        category,
        hourTimestamp: "2024-01-15T14:00:00.000Z",
        count: 1,
        expires: Math.floor(now.getTime() / 1000) + 25 * 60 * 60,
        version: 1,
        createdAt: now.toISOString(),
      };

      mockDb["request-buckets"].atomicUpdate.mockImplementation(
        async (pk, sk, updater) => {
          await updater(undefined);
          return createdBucket;
        }
      );

      const result = await incrementRequestBucketByCategory(
        subscriptionId,
        category
      );

      expect(mockDb["request-buckets"].atomicUpdate).toHaveBeenCalledWith(
        `request-buckets/${subscriptionId}/${category}/2024-01-15T14:00:00.000Z`,
        undefined,
        expect.any(Function),
        { maxRetries: 3 }
      );
      expect(result.count).toBe(1);
      expect(result.category).toBe("llm");
    });

    it("should create new bucket for search category", async () => {
      const subscriptionId = "sub-123";
      const category = "search" as const;
      const now = new Date("2024-01-15T14:00:00.000Z");
      vi.setSystemTime(now);

      const createdBucket: RequestBucketRecord = {
        pk: `request-buckets/${subscriptionId}/${category}/2024-01-15T14:00:00.000Z`,
        subscriptionId,
        category,
        hourTimestamp: "2024-01-15T14:00:00.000Z",
        count: 1,
        expires: Math.floor(now.getTime() / 1000) + 25 * 60 * 60,
        version: 1,
        createdAt: now.toISOString(),
      };

      mockDb["request-buckets"].atomicUpdate.mockImplementation(
        async (pk, sk, updater) => {
          await updater(undefined);
          return createdBucket;
        }
      );

      const result = await incrementRequestBucketByCategory(
        subscriptionId,
        category
      );

      expect(result.category).toBe("search");
    });

    it("should create new bucket for fetch category", async () => {
      const subscriptionId = "sub-123";
      const category = "fetch" as const;
      const now = new Date("2024-01-15T14:00:00.000Z");
      vi.setSystemTime(now);

      const createdBucket: RequestBucketRecord = {
        pk: `request-buckets/${subscriptionId}/${category}/2024-01-15T14:00:00.000Z`,
        subscriptionId,
        category,
        hourTimestamp: "2024-01-15T14:00:00.000Z",
        count: 1,
        expires: Math.floor(now.getTime() / 1000) + 25 * 60 * 60,
        version: 1,
        createdAt: now.toISOString(),
      };

      mockDb["request-buckets"].atomicUpdate.mockImplementation(
        async (pk, sk, updater) => {
          await updater(undefined);
          return createdBucket;
        }
      );

      const result = await incrementRequestBucketByCategory(
        subscriptionId,
        category
      );

      expect(result.category).toBe("fetch");
    });

    it("should increment existing bucket", async () => {
      const subscriptionId = "sub-123";
      const category = "llm" as const;
      const now = new Date("2024-01-15T14:00:00.000Z");
      vi.setSystemTime(now);

      const existingBucket: RequestBucketRecord = {
        pk: `request-buckets/${subscriptionId}/${category}/2024-01-15T14:00:00.000Z`,
        subscriptionId,
        category,
        hourTimestamp: "2024-01-15T14:00:00.000Z",
        count: 5,
        expires: Math.floor(now.getTime() / 1000) + 25 * 60 * 60,
        version: 1,
        createdAt: now.toISOString(),
      };

      const updatedBucket = { ...existingBucket, count: 6 };

      mockDb["request-buckets"].atomicUpdate.mockImplementation(
        async (pk, sk, updater) => {
          await updater(existingBucket);
          return updatedBucket;
        }
      );

      const result = await incrementRequestBucketByCategory(
        subscriptionId,
        category
      );

      expect(result.count).toBe(6);
    });

    it("should throw error if table doesn't exist", async () => {
      const subscriptionId = "sub-123";
      const category = "llm" as const;
      const mockDbWithoutTable = {} as typeof mockDb;

      mockDatabase.mockResolvedValue(mockDbWithoutTable);

      await expect(
        incrementRequestBucketByCategory(subscriptionId, category)
      ).rejects.toThrow("request-buckets table not found");
    });
  });

  describe("getRequestCountLast24HoursByCategory", () => {
    const mockDb = {
      "request-buckets": {
        query: vi.fn(),
      },
    };

    beforeEach(() => {
      mockDatabase.mockResolvedValue(mockDb);
    });

    it("should sum counts from all buckets for llm category", async () => {
      const subscriptionId = "sub-123";
      const category = "llm" as const;
      const now = new Date("2024-01-15T14:00:00.000Z");
      vi.setSystemTime(now);

      const buckets: RequestBucketRecord[] = [
        {
          pk: `request-buckets/${subscriptionId}/${category}/2024-01-15T14:00:00.000Z`,
          subscriptionId,
          category,
          hourTimestamp: "2024-01-15T14:00:00.000Z",
          count: 10,
          expires: 0,
          version: 1,
          createdAt: now.toISOString(),
        },
        {
          pk: `request-buckets/${subscriptionId}/${category}/2024-01-15T13:00:00.000Z`,
          subscriptionId,
          category,
          hourTimestamp: "2024-01-15T13:00:00.000Z",
          count: 5,
          expires: 0,
          version: 1,
          createdAt: now.toISOString(),
        },
      ];

      mockDb["request-buckets"].query.mockResolvedValue({
        items: buckets,
      });

      const result = await getRequestCountLast24HoursByCategory(
        subscriptionId,
        category
      );

      expect(result).toBe(15); // 10 + 5
      expect(mockDb["request-buckets"].query).toHaveBeenCalledWith({
        IndexName: "bySubscriptionIdAndCategoryAndHour",
          KeyConditionExpression:
          "subscriptionId = :subscriptionId AND category = :category AND hourTimestamp BETWEEN :oldest AND :newest",
        ExpressionAttributeValues: {
          ":subscriptionId": subscriptionId,
          ":category": category,
          ":oldest": expect.any(String),
          ":newest": expect.any(String),
        },
      });
    });

    it("should return 0 when no buckets exist", async () => {
      const subscriptionId = "sub-123";
      const category = "llm" as const;

      mockDb["request-buckets"].query.mockResolvedValue({
        items: [],
      });

      const result = await getRequestCountLast24HoursByCategory(
        subscriptionId,
        category
      );

      expect(result).toBe(0);
    });
  });

  describe("incrementSearchRequestBucket", () => {
    const mockDb = {
      "request-buckets": {
        atomicUpdate: vi.fn(),
      },
    };

    beforeEach(() => {
      mockDatabase.mockResolvedValue(mockDb);
    });

    it("should look up subscriptionId and increment search bucket", async () => {
      const workspaceId = "workspace-123";
      const subscriptionId = "sub-123";
      const now = new Date("2024-01-15T14:00:00.000Z");
      vi.setSystemTime(now);

      const subscription: SubscriptionRecord = {
        pk: `subscriptions/${subscriptionId}`,
        userId: "user-123",
        plan: "starter",
        status: "active",
          version: 1,
          createdAt: now.toISOString(),
      };

      mockGetWorkspaceSubscription.mockResolvedValue(subscription);

      const createdBucket: RequestBucketRecord = {
        pk: `request-buckets/${subscriptionId}/search/2024-01-15T14:00:00.000Z`,
          subscriptionId,
        category: "search",
        hourTimestamp: "2024-01-15T14:00:00.000Z",
        count: 1,
        expires: Math.floor(now.getTime() / 1000) + 25 * 60 * 60,
          version: 1,
          createdAt: now.toISOString(),
      };

      mockDb["request-buckets"].atomicUpdate.mockImplementation(
        async (pk, sk, updater) => {
          await updater(undefined);
          return createdBucket;
        }
      );

      const result = await incrementSearchRequestBucket(workspaceId);

      expect(mockGetWorkspaceSubscription).toHaveBeenCalledWith(workspaceId);
      expect(result.category).toBe("search");
      expect(result.count).toBe(1);
    });

    it("should throw error if subscription not found", async () => {
      const workspaceId = "workspace-123";

      mockGetWorkspaceSubscription.mockResolvedValue(undefined);

      await expect(incrementSearchRequestBucket(workspaceId)).rejects.toThrow(
        "Could not find subscription"
      );
    });
  });

  describe("incrementFetchRequestBucket", () => {
    const mockDb = {
      "request-buckets": {
        atomicUpdate: vi.fn(),
      },
    };

    beforeEach(() => {
      mockDatabase.mockResolvedValue(mockDb);
    });

    it("should look up subscriptionId and increment fetch bucket", async () => {
      const workspaceId = "workspace-123";
      const subscriptionId = "sub-123";
      const now = new Date("2024-01-15T14:00:00.000Z");
      vi.setSystemTime(now);

      const subscription: SubscriptionRecord = {
        pk: `subscriptions/${subscriptionId}`,
        userId: "user-123",
        plan: "starter",
        status: "active",
        version: 1,
        createdAt: now.toISOString(),
      };

      mockGetWorkspaceSubscription.mockResolvedValue(subscription);

      const createdBucket: RequestBucketRecord = {
        pk: `request-buckets/${subscriptionId}/fetch/2024-01-15T14:00:00.000Z`,
        subscriptionId,
        category: "fetch",
        hourTimestamp: "2024-01-15T14:00:00.000Z",
        count: 1,
        expires: Math.floor(now.getTime() / 1000) + 25 * 60 * 60,
        version: 1,
        createdAt: now.toISOString(),
      };

      mockDb["request-buckets"].atomicUpdate.mockImplementation(
        async (pk, sk, updater) => {
          await updater(undefined);
          return createdBucket;
        }
      );

      const result = await incrementFetchRequestBucket(workspaceId);

      expect(mockGetWorkspaceSubscription).toHaveBeenCalledWith(workspaceId);
      expect(result.category).toBe("fetch");
      expect(result.count).toBe(1);
    });
  });

  describe("getSearchRequestCountLast24Hours", () => {
    const mockDb = {
      "request-buckets": {
        query: vi.fn(),
      },
    };

    beforeEach(() => {
      mockDatabase.mockResolvedValue(mockDb);
    });

    it("should look up subscriptionId and return search count", async () => {
      const workspaceId = "workspace-123";
      const subscriptionId = "sub-123";
      const now = new Date("2024-01-15T14:00:00.000Z");
      vi.setSystemTime(now);

      const subscription: SubscriptionRecord = {
        pk: `subscriptions/${subscriptionId}`,
        userId: "user-123",
        plan: "starter",
        status: "active",
        version: 1,
        createdAt: now.toISOString(),
      };

      mockGetWorkspaceSubscription.mockResolvedValue(subscription);

      const buckets: RequestBucketRecord[] = [
        {
          pk: `request-buckets/${subscriptionId}/search/2024-01-15T14:00:00.000Z`,
          subscriptionId,
          category: "search",
          hourTimestamp: "2024-01-15T14:00:00.000Z",
          count: 5,
          expires: 0,
          version: 1,
          createdAt: now.toISOString(),
        },
      ];

      mockDb["request-buckets"].query.mockResolvedValue({
        items: buckets,
      });

      const result = await getSearchRequestCountLast24Hours(workspaceId);

      expect(result).toBe(5);
    });
  });

  describe("getFetchRequestCountLast24Hours", () => {
    const mockDb = {
      "request-buckets": {
        query: vi.fn(),
      },
    };

    beforeEach(() => {
      mockDatabase.mockResolvedValue(mockDb);
    });

    it("should look up subscriptionId and return fetch count", async () => {
      const workspaceId = "workspace-123";
      const subscriptionId = "sub-123";
      const now = new Date("2024-01-15T14:00:00.000Z");
      vi.setSystemTime(now);

      const subscription: SubscriptionRecord = {
        pk: `subscriptions/${subscriptionId}`,
        userId: "user-123",
        plan: "starter",
        status: "active",
        version: 1,
        createdAt: now.toISOString(),
      };

      mockGetWorkspaceSubscription.mockResolvedValue(subscription);

      const buckets: RequestBucketRecord[] = [
        {
          pk: `request-buckets/${subscriptionId}/fetch/2024-01-15T14:00:00.000Z`,
          subscriptionId,
          category: "fetch",
          hourTimestamp: "2024-01-15T14:00:00.000Z",
          count: 3,
          expires: 0,
          version: 1,
          createdAt: now.toISOString(),
        },
      ];

      mockDb["request-buckets"].query.mockResolvedValue({
        items: buckets,
      });

      const result = await getFetchRequestCountLast24Hours(workspaceId);

      expect(result).toBe(3);
    });
  });

  describe("checkDailyRequestLimit", () => {
    const mockDb = {
      subscription: {
        update: vi.fn(),
      },
      "request-buckets": {
        query: vi.fn(),
      },
    };

    beforeEach(() => {
      mockDatabase.mockResolvedValue(mockDb);
    });

    it("should allow request when under limit", async () => {
      const subscriptionId = "sub-123";
      const subscription = {
        pk: `subscriptions/${subscriptionId}`,
        userId: "user-123",
        plan: "free" as const,
      };

      mockGetSubscriptionById.mockResolvedValue(subscription);
      mockGetPlanLimits.mockReturnValue({
        maxWorkspaces: 1,
        maxDocuments: 10,
        maxDocumentSizeBytes: 1024 * 1024,
        maxAgents: 1,
        maxManagers: 1,
        maxDailyRequests: 50,
      });

      mockDb["request-buckets"].query.mockResolvedValue({
        items: [{ count: 30 }],
      });

      await expect(
        checkDailyRequestLimit(subscriptionId)
      ).resolves.not.toThrow();

      expect(mockDb["request-buckets"].query).toHaveBeenCalledWith(
        expect.objectContaining({
          IndexName: "bySubscriptionIdAndCategoryAndHour",
          ExpressionAttributeValues: expect.objectContaining({
            ":subscriptionId": subscriptionId,
            ":category": "llm",
          }),
        })
      );
    });

    it("should throw 429 when limit exceeded", async () => {
      const subscriptionId = "sub-123";
      const subscription = {
        pk: `subscriptions/${subscriptionId}`,
        userId: "user-123",
        plan: "free" as const,
      };

      mockGetSubscriptionById.mockResolvedValue(subscription);
      mockGetPlanLimits.mockReturnValue({
        maxWorkspaces: 1,
        maxDocuments: 10,
        maxDocumentSizeBytes: 1024 * 1024,
        maxAgents: 1,
        maxManagers: 1,
        maxDailyRequests: 50,
      });

      mockDb["request-buckets"].query.mockResolvedValue({
        items: [{ count: 50 }],
      });

      await expect(checkDailyRequestLimit(subscriptionId)).rejects.toThrow();

      const error = await checkDailyRequestLimit(subscriptionId).catch(
        (e) => e
      );
      expect(error.isBoom).toBe(true);
      expect(error.output.statusCode).toBe(429);
    });
  });

  describe("checkTavilyDailyLimit", () => {
    const mockDb = {
      "request-buckets": {
        query: vi.fn(),
      },
    };

    beforeEach(() => {
      mockDatabase.mockResolvedValue(mockDb);
      mockGetWorkspaceSubscription.mockClear();
    });

    it("should sum search and fetch counts for free tier", async () => {
      const workspaceId = "workspace-123";
      const subscriptionId = "sub-123";
      const now = new Date("2024-01-15T14:00:00.000Z");
      vi.setSystemTime(now);

      const subscription: SubscriptionRecord = {
        pk: `subscriptions/${subscriptionId}`,
        userId: "user-123",
        plan: "free",
        status: "active",
        version: 1,
        createdAt: now.toISOString(),
      };

      mockGetWorkspaceSubscription.mockResolvedValue(subscription);

      // Mock queries for both search and fetch categories
      mockDb["request-buckets"].query
        .mockResolvedValueOnce({
          items: [{ count: 5 }], // search count
        })
        .mockResolvedValueOnce({
          items: [{ count: 5 }], // fetch count
        });

      const result = await checkTavilyDailyLimit(workspaceId);

      expect(result).toEqual({ withinFreeLimit: true, callCount: 10 });
      expect(mockDb["request-buckets"].query).toHaveBeenCalledTimes(2);
    });

    it("should throw error for free tier exceeding limit", async () => {
      const workspaceId = "workspace-123";
      const subscriptionId = "sub-123";
      const now = new Date("2024-01-15T14:00:00.000Z");
      vi.setSystemTime(now);

      const subscription: SubscriptionRecord = {
        pk: `subscriptions/${subscriptionId}`,
        userId: "user-123",
        plan: "free",
        status: "active",
        version: 1,
        createdAt: now.toISOString(),
      };

      mockGetWorkspaceSubscription.mockResolvedValue(subscription);

      // Mock queries: 6 search + 5 fetch = 11 total (exceeds limit of 10)
      mockDb["request-buckets"].query
        .mockResolvedValueOnce({
          items: [{ count: 6 }], // search count
        })
        .mockResolvedValueOnce({
          items: [{ count: 5 }], // fetch count
        });

      await expect(checkTavilyDailyLimit(workspaceId)).rejects.toThrow(
        "Daily Tavily API call limit exceeded"
      );
    });

    it("should allow paid tier exceeding free limit", async () => {
      const workspaceId = "workspace-123";
      const subscriptionId = "sub-123";
      const now = new Date("2024-01-15T14:00:00.000Z");
      vi.setSystemTime(now);

      const subscription: SubscriptionRecord = {
        pk: `subscriptions/${subscriptionId}`,
        userId: "user-123",
        plan: "pro",
        status: "active",
          version: 1,
          createdAt: now.toISOString(),
      };

      mockGetWorkspaceSubscription.mockResolvedValue(subscription);

      // Mock queries: 6 search + 5 fetch = 11 total (exceeds free limit of 10, but paid tier can continue)
      mockDb["request-buckets"].query
        .mockResolvedValueOnce({
          items: [{ count: 6 }], // search count
        })
        .mockResolvedValueOnce({
          items: [{ count: 5 }], // fetch count
      });

      const result = await checkTavilyDailyLimit(workspaceId);

      expect(result).toEqual({ withinFreeLimit: false, callCount: 11 });
    });

    it("should disable free tier in testing environment", async () => {
      const workspaceId = "workspace-123";
      const subscriptionId = "sub-123";
      const now = new Date("2024-01-15T14:00:00.000Z");
      vi.setSystemTime(now);

      const subscription: SubscriptionRecord = {
        pk: `subscriptions/${subscriptionId}`,
        userId: "user-123",
        plan: "free",
        status: "active",
        version: 1,
        createdAt: now.toISOString(),
      };

      mockGetWorkspaceSubscription.mockResolvedValue(subscription);

      mockDb["request-buckets"].query
        .mockResolvedValueOnce({
          items: [],
        })
        .mockResolvedValueOnce({
          items: [],
      });

      const originalArcEnv = process.env.ARC_ENV;
      process.env.ARC_ENV = "testing";

      try {
        const result = await checkTavilyDailyLimit(workspaceId);

        expect(result).toEqual({ withinFreeLimit: false, callCount: 0 });
      } finally {
        if (originalArcEnv !== undefined) {
          process.env.ARC_ENV = originalArcEnv;
        } else {
          delete process.env.ARC_ENV;
        }
      }
    });
  });

  describe("Legacy functions (backward compatibility)", () => {
      const mockDb = {
      "request-buckets": {
        atomicUpdate: vi.fn(),
        query: vi.fn(),
        },
      };

    beforeEach(() => {
      mockDatabase.mockResolvedValue(mockDb);
    });

    it("incrementRequestBucket should use llm category", async () => {
      const subscriptionId = "sub-123";
      const now = new Date("2024-01-15T14:00:00.000Z");
      vi.setSystemTime(now);

      const createdBucket: RequestBucketRecord = {
        pk: `request-buckets/${subscriptionId}/llm/2024-01-15T14:00:00.000Z`,
        subscriptionId,
        category: "llm",
        hourTimestamp: "2024-01-15T14:00:00.000Z",
          count: 1,
        expires: Math.floor(now.getTime() / 1000) + 25 * 60 * 60,
          version: 1,
          createdAt: now.toISOString(),
      };

      mockDb["request-buckets"].atomicUpdate.mockImplementation(
        async (pk, sk, updater) => {
          await updater(undefined);
          return createdBucket;
        }
      );

      const result = await incrementRequestBucket(subscriptionId);

      expect(result.category).toBe("llm");
    });

    it("getRequestCountLast24Hours should use llm category", async () => {
      const subscriptionId = "sub-123";

      mockDb["request-buckets"].query.mockResolvedValue({
        items: [{ count: 10 }],
      });

      const result = await getRequestCountLast24Hours(subscriptionId);

      expect(result).toBe(10);
      expect(mockDb["request-buckets"].query).toHaveBeenCalledWith(
        expect.objectContaining({
          ExpressionAttributeValues: expect.objectContaining({
            ":category": "llm",
          }),
        })
      );
    });

    it("incrementTavilyCallBucket should increment search bucket", async () => {
      const workspaceId = "workspace-123";
      const subscriptionId = "sub-123";
      const now = new Date("2024-01-15T14:00:00.000Z");
      vi.setSystemTime(now);

      const subscription: SubscriptionRecord = {
        pk: `subscriptions/${subscriptionId}`,
        userId: "user-123",
        plan: "starter",
        status: "active",
          version: 1,
          createdAt: now.toISOString(),
      };

      mockGetWorkspaceSubscription.mockResolvedValue(subscription);

      const createdBucket: RequestBucketRecord = {
        pk: `request-buckets/${subscriptionId}/search/2024-01-15T14:00:00.000Z`,
        subscriptionId,
        category: "search",
        hourTimestamp: "2024-01-15T14:00:00.000Z",
        count: 1,
        expires: Math.floor(now.getTime() / 1000) + 25 * 60 * 60,
        version: 1,
        createdAt: now.toISOString(),
      };

      mockDb["request-buckets"].atomicUpdate.mockImplementation(
        async (pk, sk, updater) => {
          await updater(undefined);
          return createdBucket;
        }
      );

      const result = await incrementTavilyCallBucket(workspaceId);

      expect(result.category).toBe("search");
    });

    it("getTavilyCallCountLast24Hours should sum search and fetch", async () => {
      const workspaceId = "workspace-123";
      const subscriptionId = "sub-123";
      const now = new Date("2024-01-15T14:00:00.000Z");
      vi.setSystemTime(now);

      const subscription: SubscriptionRecord = {
        pk: `subscriptions/${subscriptionId}`,
        userId: "user-123",
        plan: "starter",
        status: "active",
          version: 1,
          createdAt: now.toISOString(),
      };

      mockGetWorkspaceSubscription.mockResolvedValue(subscription);

      mockDb["request-buckets"].query
        .mockResolvedValueOnce({
          items: [{ count: 5 }], // search
        })
        .mockResolvedValueOnce({
          items: [{ count: 3 }], // fetch
        });

      const result = await getTavilyCallCountLast24Hours(workspaceId);

      expect(result).toBe(8); // 5 + 3
    });
  });
});

