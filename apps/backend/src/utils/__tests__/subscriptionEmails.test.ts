import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SubscriptionRecord } from "../../tables/schema";
import {
  sendPaymentFailedEmail,
  sendGracePeriodExpiringEmail,
  sendSubscriptionDowngradedEmail,
  sendSubscriptionCancelledEmail,
} from "../subscriptionEmails";

// Mock dependencies using vi.hoisted
const { mockSendEmail, mockGetPlanLimits } = vi.hoisted(() => {
  const sendEmail = vi.fn();
  const getPlanLimits = vi.fn();
  return {
    mockSendEmail: sendEmail,
    mockGetPlanLimits: getPlanLimits,
  };
});

vi.mock("../../send-email", () => ({
  sendEmail: mockSendEmail,
}));

vi.mock("../subscriptionPlans", () => ({
  getPlanLimits: mockGetPlanLimits,
}));

describe("subscriptionEmails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BASE_URL = "https://app.helpmaton.com";
    mockGetPlanLimits.mockReturnValue({
      maxWorkspaces: 1,
      maxDocuments: 10,
      maxAgents: 1,
    });
  });

  describe("sendPaymentFailedEmail", () => {
    it("should send payment failed email with Lemon Squeezy portal URL", async () => {
      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "starter",
        status: "past_due",
        lemonSqueezyCustomerId: "ls-cust-123",
        createdAt: new Date().toISOString(),
        version: 1,
      };

      await sendPaymentFailedEmail(subscription, "user@example.com");

      expect(mockSendEmail).toHaveBeenCalledWith({
        to: "user@example.com",
        subject: "Payment Failed - Action Required",
        text: expect.stringContaining("Payment Failed"),
        html: expect.stringContaining("Payment Failed"),
      });

      const callArgs = mockSendEmail.mock.calls[0][0];
      expect(callArgs.html).toContain(
        "https://helpmaton.lemonsqueezy.com/my-account/customer/ls-cust-123"
      );
      expect(callArgs.html).toContain("starter");
    });

    it("should use base URL if no Lemon Squeezy customer ID", async () => {
      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "pro",
        status: "past_due",
        createdAt: new Date().toISOString(),
        version: 1,
      };

      await sendPaymentFailedEmail(subscription, "user@example.com");

      const callArgs = mockSendEmail.mock.calls[0][0];
      // The URL should be in the format: ${BASE_URL}/subscription
      expect(callArgs.html).toContain("/subscription");
      expect(callArgs.text).toContain("/subscription");
    });
  });

  describe("sendGracePeriodExpiringEmail", () => {
    it("should send grace period expiring email", async () => {
      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "starter",
        status: "past_due",
        lemonSqueezyCustomerId: "ls-cust-123",
        createdAt: new Date().toISOString(),
        version: 1,
      };

      await sendGracePeriodExpiringEmail(subscription, "user@example.com", 3);

      expect(mockSendEmail).toHaveBeenCalledWith({
        to: "user@example.com",
        subject: "Your Subscription Will Expire Soon",
        text: expect.stringContaining("3 days"),
        html: expect.stringContaining("3 days"),
      });

      const callArgs = mockSendEmail.mock.calls[0][0];
      expect(callArgs.html).toContain("3 days");
      expect(callArgs.html).toContain("starter");
    });

    it("should use singular form for 1 day", async () => {
      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "pro",
        status: "past_due",
        createdAt: new Date().toISOString(),
        version: 1,
      };

      await sendGracePeriodExpiringEmail(subscription, "user@example.com", 1);

      const callArgs = mockSendEmail.mock.calls[0][0];
      expect(callArgs.html).toContain("1 day");
      expect(callArgs.html).not.toContain("1 days");
    });
  });

  describe("sendSubscriptionDowngradedEmail", () => {
    it("should send downgraded email with free plan limits", async () => {
      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "starter",
        status: "expired",
        createdAt: new Date().toISOString(),
        version: 1,
      };

      await sendSubscriptionDowngradedEmail(subscription, "user@example.com");

      expect(mockSendEmail).toHaveBeenCalledWith({
        to: "user@example.com",
        subject: "Your Subscription Has Been Downgraded",
        text: expect.stringContaining("downgraded"),
        html: expect.stringContaining("downgraded"),
      });

      const callArgs = mockSendEmail.mock.calls[0][0];
      expect(callArgs.html).toContain("free plan");
      expect(callArgs.html).toContain("1 workspace");
      expect(callArgs.html).toContain("10 documents");
      expect(callArgs.html).toContain("1 agent");
    });
  });

  describe("sendSubscriptionCancelledEmail", () => {
    it("should send cancelled email without end date", async () => {
      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "starter",
        status: "cancelled",
        createdAt: new Date().toISOString(),
        version: 1,
      };

      await sendSubscriptionCancelledEmail(subscription, "user@example.com");

      expect(mockSendEmail).toHaveBeenCalledWith({
        to: "user@example.com",
        subject: "Your Subscription Has Been Cancelled",
        text: expect.stringContaining("cancelled"),
        html: expect.stringContaining("cancelled"),
      });

      const callArgs = mockSendEmail.mock.calls[0][0];
      expect(callArgs.html).not.toContain("will remain active until");
    });

    it("should send cancelled email with end date", async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);

      const subscription: SubscriptionRecord = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "pro",
        status: "cancelled",
        endsAt: futureDate.toISOString(),
        createdAt: new Date().toISOString(),
        version: 1,
      };

      await sendSubscriptionCancelledEmail(subscription, "user@example.com");

      const callArgs = mockSendEmail.mock.calls[0][0];
      expect(callArgs.html).toContain("will remain active until");
    });
  });
});



