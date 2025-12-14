import { describe, it, expect, vi, beforeEach } from "vitest";

import type { SubscriptionRecord } from "../../tables/schema";
import {
  isSubscriptionActive,
  getEffectivePlan,
  shouldSendGracePeriodWarning,
  checkGracePeriod,
} from "../subscriptionStatus";

// Mock dependencies using vi.hoisted
const {
  mockDatabase,
  mockGetUserEmailById,
  mockSendSubscriptionDowngradedEmail,
} = vi.hoisted(() => {
  const database = vi.fn();
  const getUserEmailById = vi.fn();
  const sendSubscriptionDowngradedEmail = vi.fn();
  return {
    mockDatabase: database,
    mockGetUserEmailById: getUserEmailById,
    mockSendSubscriptionDowngradedEmail: sendSubscriptionDowngradedEmail,
  };
});

vi.mock("../../tables", () => ({
  database: () => mockDatabase(),
}));

vi.mock("../subscriptionUtils", () => ({
  getUserEmailById: mockGetUserEmailById,
}));

vi.mock("../subscriptionEmails", () => ({
  sendSubscriptionDowngradedEmail: mockSendSubscriptionDowngradedEmail,
}));

describe("subscriptionStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isSubscriptionActive", () => {
    it("should return true for free plan without Lemon Squeezy ID", () => {
      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "free",
        status: "active",
        createdAt: new Date().toISOString(),
        version: 1,
      };

      expect(isSubscriptionActive(subscription)).toBe(true);
    });

    it("should return false for cancelled subscription", () => {
      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "starter",
        status: "cancelled",
        lemonSqueezySubscriptionId: "ls-sub-123",
        createdAt: new Date().toISOString(),
        version: 1,
      };

      expect(isSubscriptionActive(subscription)).toBe(false);
    });

    it("should return false for expired subscription", () => {
      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "starter",
        status: "expired",
        lemonSqueezySubscriptionId: "ls-sub-123",
        createdAt: new Date().toISOString(),
        version: 1,
      };

      expect(isSubscriptionActive(subscription)).toBe(false);
    });

    it("should return false if past grace period", () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "starter",
        status: "past_due",
        gracePeriodEndsAt: pastDate.toISOString(),
        lemonSqueezySubscriptionId: "ls-sub-123",
        createdAt: new Date().toISOString(),
        version: 1,
      };

      expect(isSubscriptionActive(subscription)).toBe(false);
    });

    it("should return false if subscription has ended", () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "starter",
        status: "active",
        endsAt: pastDate.toISOString(),
        lemonSqueezySubscriptionId: "ls-sub-123",
        createdAt: new Date().toISOString(),
        version: 1,
      };

      expect(isSubscriptionActive(subscription)).toBe(false);
    });

    it("should return true for active subscription", () => {
      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "starter",
        status: "active",
        lemonSqueezySubscriptionId: "ls-sub-123",
        createdAt: new Date().toISOString(),
        version: 1,
      };

      expect(isSubscriptionActive(subscription)).toBe(true);
    });

    it("should return true for trial subscription", () => {
      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "starter",
        status: "on_trial",
        lemonSqueezySubscriptionId: "ls-sub-123",
        createdAt: new Date().toISOString(),
        version: 1,
      };

      expect(isSubscriptionActive(subscription)).toBe(true);
    });

    it("should return true if grace period has not expired and status is past_due", () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);

      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "starter",
        status: "past_due",
        gracePeriodEndsAt: futureDate.toISOString(),
        lemonSqueezySubscriptionId: "ls-sub-123",
        createdAt: new Date().toISOString(),
        version: 1,
      };

      // past_due subscriptions should remain active during grace period
      // This allows users to continue using the service while they fix payment issues
      expect(isSubscriptionActive(subscription)).toBe(true);
    });
  });

  describe("getEffectivePlan", () => {
    it("should return plan for active subscription", () => {
      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "pro",
        status: "active",
        lemonSqueezySubscriptionId: "ls-sub-123",
        createdAt: new Date().toISOString(),
        version: 1,
      };

      expect(getEffectivePlan(subscription)).toBe("pro");
    });

    it("should return free for inactive subscription", () => {
      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "starter",
        status: "cancelled",
        lemonSqueezySubscriptionId: "ls-sub-123",
        createdAt: new Date().toISOString(),
        version: 1,
      };

      expect(getEffectivePlan(subscription)).toBe("free");
    });
  });

  describe("shouldSendGracePeriodWarning", () => {
    it("should return false if no grace period", () => {
      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "starter",
        status: "active",
        createdAt: new Date().toISOString(),
        version: 1,
      };

      expect(shouldSendGracePeriodWarning(subscription)).toBe(false);
    });

    it("should return true if 3 days remaining", () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 3);

      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "starter",
        status: "past_due",
        gracePeriodEndsAt: futureDate.toISOString(),
        createdAt: new Date().toISOString(),
        version: 1,
      };

      expect(shouldSendGracePeriodWarning(subscription)).toBe(true);
    });

    it("should return true if less than 3 days remaining", () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1);

      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "starter",
        status: "past_due",
        gracePeriodEndsAt: futureDate.toISOString(),
        createdAt: new Date().toISOString(),
        version: 1,
      };

      expect(shouldSendGracePeriodWarning(subscription)).toBe(true);
    });

    it("should return false if more than 3 days remaining", () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);

      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "starter",
        status: "past_due",
        gracePeriodEndsAt: futureDate.toISOString(),
        createdAt: new Date().toISOString(),
        version: 1,
      };

      expect(shouldSendGracePeriodWarning(subscription)).toBe(false);
    });

    it("should return false if grace period has expired", () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "starter",
        status: "past_due",
        gracePeriodEndsAt: pastDate.toISOString(),
        createdAt: new Date().toISOString(),
        version: 1,
      };

      expect(shouldSendGracePeriodWarning(subscription)).toBe(false);
    });
  });

  describe("checkGracePeriod", () => {
    it("should do nothing if no grace period", async () => {
      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "starter",
        status: "active",
        createdAt: new Date().toISOString(),
        version: 1,
      };

      await checkGracePeriod(subscription);

      expect(mockDatabase).not.toHaveBeenCalled();
    });

    it("should do nothing if grace period has not expired", async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);

      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "starter",
        status: "past_due",
        gracePeriodEndsAt: futureDate.toISOString(),
        createdAt: new Date().toISOString(),
        version: 1,
      };

      await checkGracePeriod(subscription);

      expect(mockDatabase).not.toHaveBeenCalled();
    });

    it("should downgrade subscription if grace period expired", async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "starter",
        status: "past_due",
        gracePeriodEndsAt: pastDate.toISOString(),
        lemonSqueezySubscriptionId: "ls-sub-123",
        lemonSqueezyCustomerId: "ls-cust-123",
        lemonSqueezyVariantId: "ls-var-123",
        createdAt: new Date().toISOString(),
        version: 1,
      };

      const mockDb = {
        subscription: {
          update: vi.fn().mockResolvedValue(undefined),
        },
      };
      mockDatabase.mockResolvedValue(mockDb);
      mockGetUserEmailById.mockResolvedValue("user@example.com");

      await checkGracePeriod(subscription);

      expect(mockDb.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          plan: "free",
          status: "expired",
          gracePeriodEndsAt: undefined,
          lemonSqueezySubscriptionId: undefined,
          lemonSqueezyCustomerId: undefined,
          lemonSqueezyVariantId: undefined,
          renewsAt: undefined,
          endsAt: undefined,
        })
      );
      expect(mockSendSubscriptionDowngradedEmail).toHaveBeenCalledWith(
        subscription,
        "user@example.com"
      );
    });

    it("should not throw if email sending fails", async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "starter",
        status: "past_due",
        gracePeriodEndsAt: pastDate.toISOString(),
        lemonSqueezySubscriptionId: "ls-sub-123",
        createdAt: new Date().toISOString(),
        version: 1,
      };

      const mockDb = {
        subscription: {
          update: vi.fn().mockResolvedValue(undefined),
        },
      };
      mockDatabase.mockResolvedValue(mockDb);
      mockGetUserEmailById.mockResolvedValue("user@example.com");
      mockSendSubscriptionDowngradedEmail.mockRejectedValue(
        new Error("Email failed")
      );

      await expect(checkGracePeriod(subscription)).resolves.not.toThrow();

      expect(mockDb.subscription.update).toHaveBeenCalled();
    });
  });
});


