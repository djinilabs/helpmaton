/**
 * Unit tests for Agent Error Notifications
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendAgentErrorNotification } from "../agentErrorNotifications";
import { InsufficientCreditsError } from "../creditErrors";

// Mock dependencies using vi.hoisted
const { mockDatabase, mockSendEmail, mockGetSubscriptionById } = vi.hoisted(
  () => {
    const database = vi.fn();
    const sendEmail = vi.fn();
    const getSubscriptionById = vi.fn();
    return {
      mockDatabase: database,
      mockSendEmail: sendEmail,
      mockGetSubscriptionById: getSubscriptionById,
    };
  }
);

vi.mock("../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../send-email", () => ({
  sendEmail: mockSendEmail,
}));

vi.mock("../subscriptionUtils", () => ({
  getSubscriptionById: mockGetSubscriptionById,
}));

describe("sendAgentErrorNotification", () => {
  const workspaceId = "test-workspace-id";
  const subscriptionId = "test-subscription-id";
  const userId = "test-user-id";
  const userEmail = "test@example.com";

  let mockDb: {
    workspace: {
      get: ReturnType<typeof vi.fn>;
    };
    "next-auth": {
      get: ReturnType<typeof vi.fn>;
    };
    subscription: {
      update: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock database
    mockDb = {
      workspace: {
        get: vi.fn(),
      },
      "next-auth": {
        get: vi.fn(),
      },
      subscription: {
        update: vi.fn(),
      },
    };

    mockDatabase.mockResolvedValue(mockDb as never);

    // Setup default workspace mock
    mockDb.workspace.get.mockResolvedValue({
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      subscriptionId,
    });

    // Setup default subscription mock
    mockGetSubscriptionById.mockResolvedValue({
      pk: `subscriptions/${subscriptionId}`,
      sk: "subscription",
      userId,
      plan: "starter",
      status: "active",
      version: 1,
      createdAt: new Date().toISOString(),
    } as never);

    // Setup default user mock
    mockDb["next-auth"].get.mockResolvedValue({
      pk: `users/${userId}`,
      sk: "USER",
      email: userEmail,
    });

    // Setup default email mock to resolve successfully
    mockSendEmail.mockResolvedValue({});

    // Setup default subscription update mock
    mockDb.subscription.update.mockResolvedValue({});
  });

  describe("Credit Error Notifications", () => {
    it("should send email for credit error when no previous email sent", async () => {
      const error = new InsufficientCreditsError(
        workspaceId,
        1000000, // 1 USD in millionths
        500000, // 0.5 USD in millionths
        "usd"
      );

      await sendAgentErrorNotification(workspaceId, "credit", error);

      // Should send email
      expect(mockSendEmail).toHaveBeenCalledTimes(1);
      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: userEmail,
          subject: "Insufficient Credits - Helpmaton",
        })
      );

      // Should update subscription with timestamp
      expect(mockDb.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          lastCreditErrorEmailSentAt: expect.any(String),
        })
      );
    });

    it("should not send email if sent within last hour", async () => {
      const oneHourAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 minutes ago

      mockGetSubscriptionById.mockResolvedValue({
        pk: `subscriptions/${subscriptionId}`,
        sk: "subscription",
        userId,
        plan: "starter",
        status: "active",
        lastCreditErrorEmailSentAt: oneHourAgo,
        version: 1,
        createdAt: new Date().toISOString(),
      } as never);

      const error = new InsufficientCreditsError(
        workspaceId,
        1000000,
        500000,
        "usd"
      );

      await sendAgentErrorNotification(workspaceId, "credit", error);

      // Should NOT send email
      expect(mockSendEmail).not.toHaveBeenCalled();
      // Should NOT update subscription
      expect(mockDb.subscription.update).not.toHaveBeenCalled();
    });

    it("should send email if more than 1 hour passed since last email", async () => {
      const twoHoursAgo = new Date(
        Date.now() - 2 * 60 * 60 * 1000
      ).toISOString();

      mockGetSubscriptionById.mockResolvedValue({
        pk: `subscriptions/${subscriptionId}`,
        sk: "subscription",
        userId,
        plan: "starter",
        status: "active",
        lastCreditErrorEmailSentAt: twoHoursAgo,
        version: 1,
        createdAt: new Date().toISOString(),
      } as never);

      const error = new InsufficientCreditsError(
        workspaceId,
        1000000,
        500000,
        "usd"
      );

      await sendAgentErrorNotification(workspaceId, "credit", error);

      // Should send email
      expect(mockSendEmail).toHaveBeenCalledTimes(1);
      // Should update subscription
      expect(mockDb.subscription.update).toHaveBeenCalled();
    });

    it("should not throw error if email sending fails", async () => {
      mockSendEmail.mockRejectedValue(new Error("Email sending failed"));

      const error = new InsufficientCreditsError(
        workspaceId,
        1000000,
        500000,
        "usd"
      );

      // Should not throw
      await expect(
        sendAgentErrorNotification(workspaceId, "credit", error)
      ).resolves.not.toThrow();
    });

    it("should handle missing workspace gracefully", async () => {
      mockDb.workspace.get.mockResolvedValue(undefined);

      const error = new InsufficientCreditsError(
        workspaceId,
        1000000,
        500000,
        "usd"
      );

      // Should not throw
      await expect(
        sendAgentErrorNotification(workspaceId, "credit", error)
      ).resolves.not.toThrow();

      // Should not send email
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it("should handle missing user email gracefully", async () => {
      mockDb["next-auth"].get.mockResolvedValue({
        pk: `users/${userId}`,
        sk: "USER",
        // No email field
      });

      const error = new InsufficientCreditsError(
        workspaceId,
        1000000,
        500000,
        "usd"
      );

      // Should not throw
      await expect(
        sendAgentErrorNotification(workspaceId, "credit", error)
      ).resolves.not.toThrow();

      // Should not send email
      expect(mockSendEmail).not.toHaveBeenCalled();
    });
  });

  describe("Spending Limit Error Notifications", () => {
    it("should send email for spending limit error when no previous email sent", async () => {
      const error = {
        name: "SpendingLimitExceededError",
        message: "Spending limit exceeded",
        statusCode: 402,
        failedLimits: [
          {
            scope: "workspace" as const,
            timeFrame: "daily",
            limit: 1000000,
            current: 1200000,
          },
        ],
      };

      await sendAgentErrorNotification(
        workspaceId,
        "spendingLimit",
        error as never
      );

      // Should send email
      expect(mockSendEmail).toHaveBeenCalledTimes(1);
      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: userEmail,
          subject: "Spending Limit Reached - Helpmaton",
        })
      );

      // Should update subscription with timestamp
      expect(mockDb.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          lastSpendingLimitErrorEmailSentAt: expect.any(String),
        })
      );
    });

    it("should not send email if sent within last hour", async () => {
      const thirtyMinutesAgo = new Date(
        Date.now() - 30 * 60 * 1000
      ).toISOString();

      mockGetSubscriptionById.mockResolvedValue({
        pk: `subscriptions/${subscriptionId}`,
        sk: "subscription",
        userId,
        plan: "pro",
        status: "active",
        lastSpendingLimitErrorEmailSentAt: thirtyMinutesAgo,
        version: 1,
        createdAt: new Date().toISOString(),
      } as never);

      const error = {
        name: "SpendingLimitExceededError",
        message: "Spending limit exceeded",
        statusCode: 402,
        failedLimits: [],
      };

      await sendAgentErrorNotification(
        workspaceId,
        "spendingLimit",
        error as never
      );

      // Should NOT send email
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it("should send email if more than 1 hour passed since last email", async () => {
      const ninetyMinutesAgo = new Date(
        Date.now() - 90 * 60 * 1000
      ).toISOString();

      mockGetSubscriptionById.mockResolvedValue({
        pk: `subscriptions/${subscriptionId}`,
        sk: "subscription",
        userId,
        plan: "pro",
        status: "active",
        lastSpendingLimitErrorEmailSentAt: ninetyMinutesAgo,
        version: 1,
        createdAt: new Date().toISOString(),
      } as never);

      const error = {
        name: "SpendingLimitExceededError",
        message: "Spending limit exceeded",
        statusCode: 402,
        failedLimits: [],
      };

      await sendAgentErrorNotification(
        workspaceId,
        "spendingLimit",
        error as never
      );

      // Should send email
      expect(mockSendEmail).toHaveBeenCalledTimes(1);
      // Should update subscription
      expect(mockDb.subscription.update).toHaveBeenCalled();
    });
  });

  describe("Rate Limiting", () => {
    it("should track separate timestamps for credit and spending limit errors", async () => {
      const thirtyMinutesAgo = new Date(
        Date.now() - 30 * 60 * 1000
      ).toISOString();

      mockGetSubscriptionById.mockResolvedValue({
        pk: `subscriptions/${subscriptionId}`,
        sk: "subscription",
        userId,
        plan: "starter",
        status: "active",
        lastCreditErrorEmailSentAt: thirtyMinutesAgo,
        // No lastSpendingLimitErrorEmailSentAt
        version: 1,
        createdAt: new Date().toISOString(),
      } as never);

      const creditError = new InsufficientCreditsError(
        workspaceId,
        1000000,
        500000,
        "usd"
      );

      const spendingError = {
        name: "SpendingLimitExceededError",
        message: "Spending limit exceeded",
        statusCode: 402,
        failedLimits: [],
      };

      // Credit error should be rate limited
      await sendAgentErrorNotification(workspaceId, "credit", creditError);
      expect(mockSendEmail).not.toHaveBeenCalled();

      // Spending error should NOT be rate limited (different timestamp)
      await sendAgentErrorNotification(
        workspaceId,
        "spendingLimit",
        spendingError as never
      );
      expect(mockSendEmail).toHaveBeenCalledTimes(1);
    });
  });
});


