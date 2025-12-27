import { describe, it, expect, vi, beforeEach } from "vitest";

import type {
  LLMRequestBucketRecord,
  SubscriptionRecord,
  TavilyCallBucketRecord,
} from "../../tables/schema";
import {
  getCurrentHourTimestamp,
  getLast24HourTimestamps,
  incrementRequestBucket,
  getRequestCountLast24Hours,
  checkDailyRequestLimit,
  incrementTavilyCallBucket,
  getTavilyCallCountLast24Hours,
  checkTavilyDailyLimit,
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

  describe("incrementRequestBucket", () => {
    const mockDb = {
      "llm-request-buckets": {
        atomicUpdate: vi.fn(),
      },
    };

    beforeEach(() => {
      mockDatabase.mockResolvedValue(mockDb);
    });

    it("should create new bucket if it doesn't exist", async () => {
      const subscriptionId = "sub-123";
      const now = new Date("2024-01-15T14:00:00.000Z");
      vi.setSystemTime(now);

      const createdBucket: LLMRequestBucketRecord = {
        pk: `llm-request-buckets/${subscriptionId}/2024-01-15T14:00:00.000Z`,
        subscriptionId,
        hourTimestamp: "2024-01-15T14:00:00.000Z",
        count: 1,
        expires: Math.floor(now.getTime() / 1000) + 25 * 60 * 60,
        version: 1,
        createdAt: now.toISOString(),
      };

      // Mock atomicUpdate to call the updater function with undefined (record doesn't exist)
      mockDb["llm-request-buckets"].atomicUpdate.mockImplementation(
        async (pk, sk, updater) => {
          await updater(undefined);
          return createdBucket;
        }
      );

      const result = await incrementRequestBucket(subscriptionId);

      expect(mockDb["llm-request-buckets"].atomicUpdate).toHaveBeenCalledWith(
        `llm-request-buckets/${subscriptionId}/2024-01-15T14:00:00.000Z`,
        undefined,
        expect.any(Function),
        { maxRetries: 3 }
      );
      expect(result.count).toBe(1);
    });

    it("should increment existing bucket", async () => {
      const subscriptionId = "sub-123";
      const now = new Date("2024-01-15T14:00:00.000Z");
      vi.setSystemTime(now);

      const existingBucket: LLMRequestBucketRecord = {
        pk: `llm-request-buckets/${subscriptionId}/2024-01-15T14:00:00.000Z`,
        subscriptionId,
        hourTimestamp: "2024-01-15T14:00:00.000Z",
        count: 5,
        expires: Math.floor(now.getTime() / 1000) + 25 * 60 * 60,
        version: 1,
        createdAt: now.toISOString(),
      };

      const updatedBucket = { ...existingBucket, count: 6 };

      // Mock atomicUpdate to call the updater function with existing bucket
      mockDb["llm-request-buckets"].atomicUpdate.mockImplementation(
        async (pk, sk, updater) => {
          await updater(existingBucket);
          return updatedBucket;
        }
      );

      const result = await incrementRequestBucket(subscriptionId);

      expect(mockDb["llm-request-buckets"].atomicUpdate).toHaveBeenCalledWith(
        existingBucket.pk,
        undefined,
        expect.any(Function),
        { maxRetries: 3 }
      );
      expect(result.count).toBe(6);
    });

    it("should retry on version conflict", async () => {
      const subscriptionId = "sub-123";
      const now = new Date("2024-01-15T14:00:00.000Z");
      vi.setSystemTime(now);

      const existingBucket: LLMRequestBucketRecord = {
        pk: `llm-request-buckets/${subscriptionId}/2024-01-15T14:00:00.000Z`,
        subscriptionId,
        hourTimestamp: "2024-01-15T14:00:00.000Z",
        count: 5,
        expires: Math.floor(now.getTime() / 1000) + 25 * 60 * 60,
        version: 1,
        createdAt: now.toISOString(),
      };

      const updatedBucket = { ...existingBucket, count: 6 };

      // Mock sleep to speed up test
      vi.spyOn(global, "setTimeout").mockImplementation((fn) => {
        (fn as () => void)();
        return {} as NodeJS.Timeout;
      });

      // Simulate atomicUpdate handling retries internally and eventually succeeding
      // The updater function should be called with the existing bucket
      mockDb["llm-request-buckets"].atomicUpdate.mockImplementation(
        async (pk, sk, updater) => {
          // Simulate that atomicUpdate internally retries and eventually succeeds
          // by calling the updater with the current bucket
          await updater(existingBucket);
          return updatedBucket;
        }
      );

      const result = await incrementRequestBucket(subscriptionId, 3);

      // Verify atomicUpdate was called with correct parameters
      expect(mockDb["llm-request-buckets"].atomicUpdate).toHaveBeenCalledWith(
        existingBucket.pk,
        undefined,
        expect.any(Function),
        { maxRetries: 3 }
      );
      expect(result.count).toBe(6);
    });

    it("should throw error after max retries", async () => {
      const subscriptionId = "sub-123";
      const now = new Date("2024-01-15T14:00:00.000Z");
      vi.setSystemTime(now);

      // Mock sleep to speed up test
      vi.spyOn(global, "setTimeout").mockImplementation((fn) => {
        (fn as () => void)();
        return {} as NodeJS.Timeout;
      });

      // atomicUpdate should fail after max retries
      const { conflict } = await import("@hapi/boom");
      mockDb["llm-request-buckets"].atomicUpdate.mockRejectedValue(
        conflict("Failed to atomically update record after 2 retries")
      );

      await expect(incrementRequestBucket(subscriptionId, 2)).rejects.toThrow(
        "Failed to atomically update record after 2 retries"
      );
    });
  });

  describe("getRequestCountLast24Hours", () => {
    const mockDb = {
      "llm-request-buckets": {
        query: vi.fn(),
      },
    };

    beforeEach(() => {
      mockDatabase.mockResolvedValue(mockDb);
    });

    it("should sum counts from all buckets", async () => {
      const subscriptionId = "sub-123";
      const now = new Date("2024-01-15T14:00:00.000Z");
      vi.setSystemTime(now);

      const buckets: LLMRequestBucketRecord[] = [
        {
          pk: `llm-request-buckets/${subscriptionId}/2024-01-15T14:00:00.000Z`,
          subscriptionId,
          hourTimestamp: "2024-01-15T14:00:00.000Z",
          count: 10,
          expires: 0,
          version: 1,
          createdAt: now.toISOString(),
        },
        {
          pk: `llm-request-buckets/${subscriptionId}/2024-01-15T13:00:00.000Z`,
          subscriptionId,
          hourTimestamp: "2024-01-15T13:00:00.000Z",
          count: 5,
          expires: 0,
          version: 1,
          createdAt: now.toISOString(),
        },
        {
          pk: `llm-request-buckets/${subscriptionId}/2024-01-15T12:00:00.000Z`,
          subscriptionId,
          hourTimestamp: "2024-01-15T12:00:00.000Z",
          count: 8,
          expires: 0,
          version: 1,
          createdAt: now.toISOString(),
        },
      ];

      mockDb["llm-request-buckets"].query.mockResolvedValue({
        items: buckets,
      });

      const result = await getRequestCountLast24Hours(subscriptionId);

      expect(result).toBe(23); // 10 + 5 + 8
      expect(mockDb["llm-request-buckets"].query).toHaveBeenCalledWith(
        expect.objectContaining({
          IndexName: "bySubscriptionIdAndHour",
          KeyConditionExpression:
            "subscriptionId = :subscriptionId AND hourTimestamp BETWEEN :oldest AND :newest",
        })
      );
    });

    it("should return 0 when no buckets exist", async () => {
      const subscriptionId = "sub-123";

      mockDb["llm-request-buckets"].query.mockResolvedValue({
        items: [],
      });

      const result = await getRequestCountLast24Hours(subscriptionId);

      expect(result).toBe(0);
    });

    it("should handle buckets with missing count field", async () => {
      const subscriptionId = "sub-123";
      const now = new Date("2024-01-15T14:00:00.000Z");
      vi.setSystemTime(now);

      const buckets: LLMRequestBucketRecord[] = [
        {
          pk: `llm-request-buckets/${subscriptionId}/2024-01-15T14:00:00.000Z`,
          subscriptionId,
          hourTimestamp: "2024-01-15T14:00:00.000Z",
          count: 10,
          expires: 0,
          version: 1,
          createdAt: now.toISOString(),
        },
        {
          pk: `llm-request-buckets/${subscriptionId}/2024-01-15T13:00:00.000Z`,
          subscriptionId,
          hourTimestamp: "2024-01-15T13:00:00.000Z",
          // @ts-expect-error - testing missing count field
          count: undefined,
          expires: 0,
          version: 1,
          createdAt: now.toISOString(),
        },
      ];

      mockDb["llm-request-buckets"].query.mockResolvedValue({
        items: buckets,
      });

      const result = await getRequestCountLast24Hours(subscriptionId);

      expect(result).toBe(10); // Only the bucket with count is included
    });
  });

  describe("checkDailyRequestLimit", () => {
    const mockDb = {
      subscription: {
        update: vi.fn(),
      },
      "llm-request-buckets": {
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

      // Mock getRequestCountLast24Hours to return 30 (under limit)
      mockDb["llm-request-buckets"].query.mockResolvedValue({
        items: [
          {
            count: 30,
          },
        ],
      });

      await expect(
        checkDailyRequestLimit(subscriptionId)
      ).resolves.not.toThrow();

      expect(mockGetSubscriptionById).toHaveBeenCalledWith(subscriptionId);
      expect(mockSendEmail).not.toHaveBeenCalled();
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

      // Mock getRequestCountLast24Hours to return 50 (at limit)
      mockDb["llm-request-buckets"].query.mockResolvedValue({
        items: [
          {
            count: 50,
          },
        ],
      });

      await expect(checkDailyRequestLimit(subscriptionId)).rejects.toThrow();

      const error = await checkDailyRequestLimit(subscriptionId).catch(
        (e) => e
      );
      expect(error.isBoom).toBe(true);
      expect(error.output.statusCode).toBe(429);
      expect(error.message).toContain("Daily request limit exceeded");
    });

    it("should send email when limit exceeded and no email sent recently", async () => {
      const subscriptionId = "sub-123";
      const subscription = {
        pk: `subscriptions/${subscriptionId}`,
        userId: "user-123",
        plan: "free" as const,
        lastLimitEmailSentAt: undefined,
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
      mockGetUserEmailById.mockResolvedValue("user@example.com");
      mockSendEmail.mockResolvedValue({ message: "Email sent" });

      // Mock getRequestCountLast24Hours to return 50 (at limit)
      mockDb["llm-request-buckets"].query.mockResolvedValue({
        items: [
          {
            count: 50,
          },
        ],
      });

      const updatedSubscription = {
        ...subscription,
        lastLimitEmailSentAt: new Date().toISOString(),
      };
      mockDb.subscription.update.mockResolvedValue(updatedSubscription);

      await expect(checkDailyRequestLimit(subscriptionId)).rejects.toThrow();

      expect(mockGetUserEmailById).toHaveBeenCalledWith("user-123");
      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "user@example.com",
          subject: "Daily Request Limit Reached - Helpmaton",
        })
      );
      expect(mockDb.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          lastLimitEmailSentAt: expect.any(String),
        })
      );
    });

    it("should not send email if email was sent less than 24 hours ago", async () => {
      const subscriptionId = "sub-123";
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago
      const subscription = {
        pk: `subscriptions/${subscriptionId}`,
        userId: "user-123",
        plan: "free" as const,
        lastLimitEmailSentAt: oneHourAgo.toISOString(),
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

      // Mock getRequestCountLast24Hours to return 50 (at limit)
      mockDb["llm-request-buckets"].query.mockResolvedValue({
        items: [
          {
            count: 50,
          },
        ],
      });

      await expect(checkDailyRequestLimit(subscriptionId)).rejects.toThrow();

      expect(mockSendEmail).not.toHaveBeenCalled();
      expect(mockDb.subscription.update).not.toHaveBeenCalled();
    });

    it("should send email if last email was more than 24 hours ago", async () => {
      const subscriptionId = "sub-123";
      const now = new Date();
      const twentyFiveHoursAgo = new Date(now.getTime() - 25 * 60 * 60 * 1000); // 25 hours ago
      const subscription = {
        pk: `subscriptions/${subscriptionId}`,
        userId: "user-123",
        plan: "starter" as const,
        lastLimitEmailSentAt: twentyFiveHoursAgo.toISOString(),
      };

      mockGetSubscriptionById.mockResolvedValue(subscription);
      mockGetPlanLimits.mockReturnValue({
        maxWorkspaces: 1,
        maxDocuments: 100,
        maxDocumentSizeBytes: 10 * 1024 * 1024,
        maxAgents: 5,
        maxManagers: 1,
        maxDailyRequests: 2500,
      });
      mockGetUserEmailById.mockResolvedValue("user@example.com");
      mockSendEmail.mockResolvedValue({ message: "Email sent" });

      // Mock getRequestCountLast24Hours to return 2500 (at limit)
      mockDb["llm-request-buckets"].query.mockResolvedValue({
        items: [
          {
            count: 2500,
          },
        ],
      });

      await expect(checkDailyRequestLimit(subscriptionId)).rejects.toThrow();

      expect(mockSendEmail).toHaveBeenCalled();
      expect(mockDb.subscription.update).toHaveBeenCalled();
    });

    it("should not fail if email sending fails", async () => {
      const subscriptionId = "sub-123";
      const subscription = {
        pk: `subscriptions/${subscriptionId}`,
        userId: "user-123",
        plan: "free" as const,
        lastLimitEmailSentAt: undefined,
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
      mockGetUserEmailById.mockResolvedValue("user@example.com");
      mockSendEmail.mockRejectedValue(new Error("Email service unavailable"));

      // Mock getRequestCountLast24Hours to return 50 (at limit)
      mockDb["llm-request-buckets"].query.mockResolvedValue({
        items: [
          {
            count: 50,
          },
        ],
      });

      // Should still throw 429 even if email fails
      await expect(checkDailyRequestLimit(subscriptionId)).rejects.toThrow();

      const error = await checkDailyRequestLimit(subscriptionId).catch(
        (e) => e
      );
      expect(error.isBoom).toBe(true);
      expect(error.output.statusCode).toBe(429);
    });

    it("should not send email if user email not found", async () => {
      const subscriptionId = "sub-123";
      const subscription = {
        pk: `subscriptions/${subscriptionId}`,
        userId: "user-123",
        plan: "free" as const,
        lastLimitEmailSentAt: undefined,
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
      mockGetUserEmailById.mockResolvedValue(undefined);

      // Mock getRequestCountLast24Hours to return 50 (at limit)
      mockDb["llm-request-buckets"].query.mockResolvedValue({
        items: [
          {
            count: 50,
          },
        ],
      });

      await expect(checkDailyRequestLimit(subscriptionId)).rejects.toThrow();

      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it("should allow request when plan has no limit", async () => {
      // Note: This test uses "pro" plan but mocks maxDailyRequests as undefined
      // to test the conditional logic that allows requests when no limit is configured.
      // In reality, the Pro plan has maxDailyRequests: 25000, but this test validates
      // the behavior when a plan has no limit configured.
      const subscriptionId = "sub-123";
      const subscription = {
        pk: `subscriptions/${subscriptionId}`,
        userId: "user-123",
        plan: "pro" as const,
      };

      mockGetSubscriptionById.mockResolvedValue(subscription);
      mockGetPlanLimits.mockReturnValue({
        maxWorkspaces: 5,
        maxDocuments: 1000,
        maxDocumentSizeBytes: 100 * 1024 * 1024,
        maxAgents: 50,
        maxDailyRequests: undefined, // No limit
      });

      await expect(
        checkDailyRequestLimit(subscriptionId)
      ).resolves.not.toThrow();

      expect(mockGetSubscriptionById).toHaveBeenCalledWith(subscriptionId);
    });

    it("should throw error if subscription not found", async () => {
      const subscriptionId = "sub-123";

      mockGetSubscriptionById.mockResolvedValue(undefined);

      await expect(checkDailyRequestLimit(subscriptionId)).rejects.toThrow(
        "Subscription sub-123 not found"
      );
    });
  });

  describe("incrementTavilyCallBucket", () => {
    const mockDb = {
      "tavily-call-buckets": {
        atomicUpdate: vi.fn(),
      },
    };

    beforeEach(() => {
      mockDatabase.mockResolvedValue(mockDb);
    });

    it("should create new bucket if it doesn't exist", async () => {
      const workspaceId = "workspace-123";
      const now = new Date("2024-01-15T14:00:00.000Z");
      vi.setSystemTime(now);

      const createdBucket: TavilyCallBucketRecord = {
        pk: `tavily-call-buckets/${workspaceId}/2024-01-15T14:00:00.000Z`,
        workspaceId,
        hourTimestamp: "2024-01-15T14:00:00.000Z",
        count: 1,
        expires: Math.floor(now.getTime() / 1000) + 25 * 60 * 60,
        version: 1,
        createdAt: now.toISOString(),
      };

      mockDb["tavily-call-buckets"].atomicUpdate.mockImplementation(
        async (pk, sk, updater) => {
          await updater(undefined);
          return createdBucket;
        }
      );

      const result = await incrementTavilyCallBucket(workspaceId);

      expect(mockDb["tavily-call-buckets"].atomicUpdate).toHaveBeenCalledWith(
        `tavily-call-buckets/${workspaceId}/2024-01-15T14:00:00.000Z`,
        undefined,
        expect.any(Function),
        { maxRetries: 3 }
      );
      expect(result.count).toBe(1);
    });

    it("should increment existing bucket", async () => {
      const workspaceId = "workspace-123";
      const now = new Date("2024-01-15T14:00:00.000Z");
      vi.setSystemTime(now);

      const existingBucket: TavilyCallBucketRecord = {
        pk: `tavily-call-buckets/${workspaceId}/2024-01-15T14:00:00.000Z`,
        workspaceId,
        hourTimestamp: "2024-01-15T14:00:00.000Z",
        count: 5,
        expires: Math.floor(now.getTime() / 1000) + 25 * 60 * 60,
        version: 1,
        createdAt: now.toISOString(),
      };

      const updatedBucket = { ...existingBucket, count: 6 };

      mockDb["tavily-call-buckets"].atomicUpdate.mockImplementation(
        async (pk, sk, updater) => {
          await updater(existingBucket);
          return updatedBucket;
        }
      );

      const result = await incrementTavilyCallBucket(workspaceId);

      expect(mockDb["tavily-call-buckets"].atomicUpdate).toHaveBeenCalledWith(
        existingBucket.pk,
        undefined,
        expect.any(Function),
        { maxRetries: 3 }
      );
      expect(result.count).toBe(6);
    });

    it("should throw error if table doesn't exist", async () => {
      const workspaceId = "workspace-123";
      const mockDbWithoutTable = {} as typeof mockDb;

      mockDatabase.mockResolvedValue(mockDbWithoutTable);

      await expect(incrementTavilyCallBucket(workspaceId)).rejects.toThrow(
        "tavily-call-buckets table not found"
      );
    });
  });

  describe("getTavilyCallCountLast24Hours", () => {
    const mockDb = {
      "tavily-call-buckets": {
        query: vi.fn(),
      },
    };

    beforeEach(() => {
      mockDatabase.mockResolvedValue(mockDb);
    });

    it("should sum counts from all buckets", async () => {
      const workspaceId = "workspace-123";
      const now = new Date("2024-01-15T14:00:00.000Z");
      vi.setSystemTime(now);

      const buckets: TavilyCallBucketRecord[] = [
        {
          pk: `tavily-call-buckets/${workspaceId}/2024-01-15T14:00:00.000Z`,
          workspaceId,
          hourTimestamp: "2024-01-15T14:00:00.000Z",
          count: 10,
          expires: 0,
          version: 1,
          createdAt: now.toISOString(),
        },
        {
          pk: `tavily-call-buckets/${workspaceId}/2024-01-15T13:00:00.000Z`,
          workspaceId,
          hourTimestamp: "2024-01-15T13:00:00.000Z",
          count: 5,
          expires: 0,
          version: 1,
          createdAt: now.toISOString(),
        },
        {
          pk: `tavily-call-buckets/${workspaceId}/2024-01-15T12:00:00.000Z`,
          workspaceId,
          hourTimestamp: "2024-01-15T12:00:00.000Z",
          count: 8,
          expires: 0,
          version: 1,
          createdAt: now.toISOString(),
        },
      ];

      mockDb["tavily-call-buckets"].query.mockResolvedValue({
        items: buckets,
      });

      const result = await getTavilyCallCountLast24Hours(workspaceId);

      expect(result).toBe(23); // 10 + 5 + 8
      expect(mockDb["tavily-call-buckets"].query).toHaveBeenCalledWith({
        IndexName: "byWorkspaceIdAndHour",
        KeyConditionExpression:
          "workspaceId = :workspaceId AND hourTimestamp BETWEEN :oldest AND :newest",
        ExpressionAttributeValues: {
          ":workspaceId": workspaceId,
          ":oldest": expect.any(String),
          ":newest": expect.any(String),
        },
      });
    });

    it("should return 0 if no buckets found", async () => {
      const workspaceId = "workspace-123";
      const now = new Date("2024-01-15T14:00:00.000Z");
      vi.setSystemTime(now);

      mockDb["tavily-call-buckets"].query.mockResolvedValue({
        items: [],
      });

      const result = await getTavilyCallCountLast24Hours(workspaceId);

      expect(result).toBe(0);
    });

    it("should handle buckets with missing count field", async () => {
      const workspaceId = "workspace-123";
      const now = new Date("2024-01-15T14:00:00.000Z");
      vi.setSystemTime(now);

      const buckets = [
        {
          pk: `tavily-call-buckets/${workspaceId}/2024-01-15T14:00:00.000Z`,
          workspaceId,
          hourTimestamp: "2024-01-15T14:00:00.000Z",
          count: 10,
        },
        {
          pk: `tavily-call-buckets/${workspaceId}/2024-01-15T13:00:00.000Z`,
          workspaceId,
          hourTimestamp: "2024-01-15T13:00:00.000Z",
          // Missing count field
        },
      ];

      mockDb["tavily-call-buckets"].query.mockResolvedValue({
        items: buckets,
      });

      const result = await getTavilyCallCountLast24Hours(workspaceId);

      expect(result).toBe(10); // Only counts the bucket with count field
    });
  });

  describe("checkTavilyDailyLimit", () => {
    beforeEach(() => {
      mockGetWorkspaceSubscription.mockClear();
    });

    it("should allow free tier within limit", async () => {
      const workspaceId = "workspace-123";
      const mockDb = {
        "tavily-call-buckets": {
          query: vi.fn().mockResolvedValue({ items: [] }),
        },
      };

      mockDatabase.mockResolvedValue(mockDb);
      mockGetWorkspaceSubscription.mockResolvedValue(undefined); // No subscription = free tier

      const result = await checkTavilyDailyLimit(workspaceId);

      expect(result).toEqual({ withinFreeLimit: true, callCount: 0 });
    });

    it("should throw error for free tier exceeding limit", async () => {
      const workspaceId = "workspace-123";
      const now = new Date("2024-01-15T14:00:00.000Z");
      vi.setSystemTime(now);

      const buckets: TavilyCallBucketRecord[] = Array.from(
        { length: 10 },
        (_, i) => ({
          pk: `tavily-call-buckets/${workspaceId}/2024-01-15T${
            14 - i
          }:00:00.000Z`,
          workspaceId,
          hourTimestamp: `2024-01-15T${14 - i}:00:00.000Z`,
          count: 1,
          expires: 0,
          version: 1,
          createdAt: now.toISOString(),
        })
      );

      const mockDb = {
        "tavily-call-buckets": {
          query: vi.fn().mockResolvedValue({ items: buckets }),
        },
      };

      mockDatabase.mockResolvedValue(mockDb);
      mockGetWorkspaceSubscription.mockResolvedValue(undefined); // Free tier

      await expect(checkTavilyDailyLimit(workspaceId)).rejects.toThrow(
        "Daily Tavily API call limit exceeded"
      );
    });

    it("should allow paid tier within free limit", async () => {
      const workspaceId = "workspace-123";
      const mockDb = {
        "tavily-call-buckets": {
          query: vi.fn().mockResolvedValue({ items: [] }),
        },
      };

      mockDatabase.mockResolvedValue(mockDb);
      mockGetWorkspaceSubscription.mockResolvedValue({
        plan: "starter",
      } as Partial<SubscriptionRecord>);

      const result = await checkTavilyDailyLimit(workspaceId);

      expect(result).toEqual({ withinFreeLimit: true, callCount: 0 });
    });

    it("should allow paid tier exceeding free limit (requires credits)", async () => {
      const workspaceId = "workspace-123";
      const now = new Date("2024-01-15T14:00:00.000Z");
      vi.setSystemTime(now);

      const buckets: TavilyCallBucketRecord[] = Array.from(
        { length: 15 },
        (_, i) => ({
          pk: `tavily-call-buckets/${workspaceId}/2024-01-15T${
            14 - i
          }:00:00.000Z`,
          workspaceId,
          hourTimestamp: `2024-01-15T${14 - i}:00:00.000Z`,
          count: 1,
          expires: 0,
          version: 1,
          createdAt: now.toISOString(),
        })
      );

      const mockDb = {
        "tavily-call-buckets": {
          query: vi.fn().mockResolvedValue({ items: buckets }),
        },
      };

      mockDatabase.mockResolvedValue(mockDb);
      mockGetWorkspaceSubscription.mockResolvedValue({
        plan: "pro",
      } as Partial<SubscriptionRecord>);

      const result = await checkTavilyDailyLimit(workspaceId);

      expect(result).toEqual({ withinFreeLimit: false, callCount: 15 });
    });

    it("should treat free plan as free tier", async () => {
      const workspaceId = "workspace-123";
      const now = new Date("2024-01-15T14:00:00.000Z");
      vi.setSystemTime(now);

      const buckets: TavilyCallBucketRecord[] = Array.from(
        { length: 10 },
        (_, i) => ({
          pk: `tavily-call-buckets/${workspaceId}/2024-01-15T${
            14 - i
          }:00:00.000Z`,
          workspaceId,
          hourTimestamp: `2024-01-15T${14 - i}:00:00.000Z`,
          count: 1,
          expires: 0,
          version: 1,
          createdAt: now.toISOString(),
        })
      );

      const mockDb = {
        "tavily-call-buckets": {
          query: vi.fn().mockResolvedValue({ items: buckets }),
        },
      };

      mockDatabase.mockResolvedValue(mockDb);
      mockGetWorkspaceSubscription.mockResolvedValue({
        plan: "free",
      } as Partial<SubscriptionRecord>);

      await expect(checkTavilyDailyLimit(workspaceId)).rejects.toThrow(
        "Daily Tavily API call limit exceeded"
      );
    });

    it("should disable free tier in testing environment (ARC_ENV=testing)", async () => {
      const workspaceId = "workspace-123";
      const mockDb = {
        "tavily-call-buckets": {
          query: vi.fn().mockResolvedValue({ items: [] }),
        },
      };

      mockDatabase.mockResolvedValue(mockDb);
      mockGetWorkspaceSubscription.mockResolvedValue(undefined); // No subscription = free tier

      // Set ARC_ENV to "testing" to simulate local sandbox
      const originalArcEnv = process.env.ARC_ENV;
      process.env.ARC_ENV = "testing";

      try {
        const result = await checkTavilyDailyLimit(workspaceId);

        // Should return withinFreeLimit: false even though it's free tier with 0 calls
        expect(result).toEqual({ withinFreeLimit: false, callCount: 0 });
      } finally {
        // Restore original ARC_ENV
        if (originalArcEnv !== undefined) {
          process.env.ARC_ENV = originalArcEnv;
        } else {
          delete process.env.ARC_ENV;
        }
      }
    });

    it("should disable free tier in testing environment even for paid tiers", async () => {
      const workspaceId = "workspace-123";
      const mockDb = {
        "tavily-call-buckets": {
          query: vi.fn().mockResolvedValue({ items: [] }),
        },
      };

      mockDatabase.mockResolvedValue(mockDb);
      mockGetWorkspaceSubscription.mockResolvedValue({
        plan: "pro",
      } as Partial<SubscriptionRecord>);

      // Set ARC_ENV to "testing" to simulate local sandbox
      const originalArcEnv = process.env.ARC_ENV;
      process.env.ARC_ENV = "testing";

      try {
        const result = await checkTavilyDailyLimit(workspaceId);

        // Should return withinFreeLimit: false even though it's paid tier with 0 calls (within free limit)
        expect(result).toEqual({ withinFreeLimit: false, callCount: 0 });
      } finally {
        // Restore original ARC_ENV
        if (originalArcEnv !== undefined) {
          process.env.ARC_ENV = originalArcEnv;
        } else {
          delete process.env.ARC_ENV;
        }
      }
    });
  });
});
