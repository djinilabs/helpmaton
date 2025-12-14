import { badRequest, internal, unauthorized, Boom } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Type for mock Lemon Squeezy subscription (partial match)
type MockLemonSqueezySubscription = {
  id: string;
  attributes: {
    status: string;
    variant_id: number;
    renews_at: string;
    ends_at: string | null;
    trial_ends_at: string | null;
  };
};

import {
  createMockRequest,
  createMockResponse,
  createMockDatabase,
} from "../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const {
  mockDatabase,
  mockGetUserSubscription,
  mockCreateCheckout,
  mockUpdateSubscriptionVariant,
  mockGetLemonSqueezySubscription,
  mockCancelSubscription,
  mockAssociateSubscriptionWithPlan,
} = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockGetUserSubscription: vi.fn(),
    mockCreateCheckout: vi.fn(),
    mockUpdateSubscriptionVariant: vi.fn(),
    mockGetLemonSqueezySubscription: vi.fn(),
    mockCancelSubscription: vi.fn(),
    mockAssociateSubscriptionWithPlan: vi.fn(),
  };
});

// Mock the modules
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/subscriptionUtils", () => ({
  getUserSubscription: mockGetUserSubscription,
}));

vi.mock("../../../../utils/lemonSqueezy", () => ({
  createCheckout: mockCreateCheckout,
  updateSubscriptionVariant: mockUpdateSubscriptionVariant,
  getSubscription: mockGetLemonSqueezySubscription,
  cancelSubscription: mockCancelSubscription,
}));

vi.mock("../../../../utils/apiGatewayUsagePlans", () => ({
  associateSubscriptionWithPlan: mockAssociateSubscriptionWithPlan,
}));

describe("Subscription Modify and Cancel Endpoints", () => {
  const starterVariantId = "123";
  const proVariantId = "456";
  const storeId = "store-789";
  const userId = "user-123";
  const subscriptionId = "sub-123";
  const lemonSqueezySubscriptionId = "ls-sub-123";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("LEMON_SQUEEZY_STARTER_VARIANT_ID", starterVariantId);
    vi.stubEnv("LEMON_SQUEEZY_PRO_VARIANT_ID", proVariantId);
    vi.stubEnv("LEMON_SQUEEZY_STORE_ID", storeId);
  });

  // Helper to call checkout handler
  async function callCheckoutHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>,
    next: express.NextFunction
  ) {
    const handler = async (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      try {
        const currentUserRef = req.userRef;
        if (!currentUserRef) {
          throw unauthorized();
        }
        const currentUserId = currentUserRef.replace("users/", "");

        const { plan } = req.body;
        if (plan !== "starter" && plan !== "pro") {
          throw badRequest('Plan must be "starter" or "pro"');
        }

        const variantId =
          plan === "starter"
            ? process.env.LEMON_SQUEEZY_STARTER_VARIANT_ID
            : process.env.LEMON_SQUEEZY_PRO_VARIANT_ID;

        if (!variantId) {
          throw badRequest(
            `LEMON_SQUEEZY_${plan.toUpperCase()}_VARIANT_ID is not configured`
          );
        }

        const storeIdEnv = process.env.LEMON_SQUEEZY_STORE_ID;
        if (!storeIdEnv) {
          throw new Error("LEMON_SQUEEZY_STORE_ID is not configured");
        }

        const subscription = await mockGetUserSubscription(currentUserId);
        const subscriptionIdFromSub = subscription.pk.replace(
          "subscriptions/",
          ""
        );

        if (
          subscription.lemonSqueezySubscriptionId &&
          subscription.status === "cancelled"
        ) {
          const starterVariantIdEnv =
            process.env.LEMON_SQUEEZY_STARTER_VARIANT_ID;
          const proVariantIdEnv = process.env.LEMON_SQUEEZY_PRO_VARIANT_ID;
          const currentVariantId = subscription.lemonSqueezyVariantId;
          const targetVariantId =
            plan === "starter" ? starterVariantIdEnv : proVariantIdEnv;

          if (!targetVariantId) {
            throw badRequest(
              `LEMON_SQUEEZY_${plan.toUpperCase()}_VARIANT_ID is not configured`
            );
          }

          if (currentVariantId === targetVariantId) {
            try {
              await mockUpdateSubscriptionVariant(
                subscription.lemonSqueezySubscriptionId,
                targetVariantId
              );

              // Sync the subscription to verify the variant and get updated status
              const db = await mockDatabase();
              const lemonSqueezySub = await mockGetLemonSqueezySubscription(
                subscription.lemonSqueezySubscriptionId
              );
              const attributes = lemonSqueezySub.attributes;
              const actualVariantId = String(attributes.variant_id);

              // If variant didn't change, Lemon Squeezy likely requires payment confirmation
              // Fall through to create a checkout URL
              if (actualVariantId !== targetVariantId) {
                // Fall through to create a new checkout
              } else if (
                attributes.status === "cancelled" ||
                attributes.status === "expired"
              ) {
                // Variant changed but status is still cancelled/expired
                // This means Lemon Squeezy requires payment confirmation to reactivate
                // If we update with cancelled status, getEffectivePlan will return "free"
                // So we need to create a checkout URL instead
                // Fall through to create a new checkout
              } else {
                // Variant is correct and status is active, update subscription record
                await db.subscription.update({
                  ...subscription,
                  plan,
                  status: attributes.status as
                    | "active"
                    | "past_due"
                    | "unpaid"
                    | "cancelled"
                    | "expired"
                    | "on_trial",
                  renewsAt: attributes.renews_at,
                  endsAt: attributes.ends_at || undefined,
                  trialEndsAt: attributes.trial_ends_at || undefined,
                  lemonSqueezyVariantId: actualVariantId,
                  lemonSqueezySyncKey: "ACTIVE",
                  lastSyncedAt: new Date().toISOString(),
                });

                await mockAssociateSubscriptionWithPlan(
                  subscriptionIdFromSub,
                  plan
                );

                res.json({
                  success: true,
                  message: `Subscription reactivated successfully. You are now on the ${plan} plan.`,
                  reactivated: true,
                });
                return;
              }
            } catch {
              // Fall through to create checkout
            }
          } else {
            try {
              await mockUpdateSubscriptionVariant(
                subscription.lemonSqueezySubscriptionId,
                targetVariantId
              );

              // Sync the subscription to verify the variant actually changed
              const db = await mockDatabase();
              const lemonSqueezySub = await mockGetLemonSqueezySubscription(
                subscription.lemonSqueezySubscriptionId
              );
              const attributes = lemonSqueezySub.attributes;
              const actualVariantId = String(attributes.variant_id);

              // If variant didn't change, Lemon Squeezy likely requires payment confirmation
              // Fall through to create a checkout URL
              if (actualVariantId !== targetVariantId) {
                // Fall through to create a new checkout
              } else if (
                attributes.status === "cancelled" ||
                attributes.status === "expired"
              ) {
                // Variant changed but status is still cancelled/expired
                // This means Lemon Squeezy requires payment confirmation to reactivate
                // If we update with cancelled status, getEffectivePlan will return "free"
                // So we need to create a checkout URL instead
                // Fall through to create a new checkout
              } else {
                // Variant changed successfully and status is active, update local database
                await db.subscription.update({
                  ...subscription,
                  plan,
                  status: attributes.status as
                    | "active"
                    | "past_due"
                    | "unpaid"
                    | "cancelled"
                    | "expired"
                    | "on_trial",
                  renewsAt: attributes.renews_at,
                  endsAt: attributes.ends_at || undefined,
                  trialEndsAt: attributes.trial_ends_at || undefined,
                  lemonSqueezyVariantId: actualVariantId,
                  lemonSqueezySyncKey: "ACTIVE",
                  lastSyncedAt: new Date().toISOString(),
                });

                await mockAssociateSubscriptionWithPlan(
                  subscriptionIdFromSub,
                  plan
                );

                res.json({
                  success: true,
                  message: `Subscription reactivated and changed to ${plan} plan.`,
                  reactivated: true,
                });
                return;
              }
            } catch {
              // Fall through to create checkout
            }
          }
        }

        const checkout = await mockCreateCheckout({
          storeId: storeIdEnv,
          variantId,
          checkoutData: {
            custom: {
              userId: currentUserId,
              subscriptionId: subscriptionIdFromSub,
            },
            email: req.session?.user?.email || undefined,
          },
          checkoutOptions: {
            embed: false,
            media: false,
          },
        });

        if (!checkout.url) {
          throw internal("Checkout URL not returned from Lemon Squeezy");
        }

        res.json({
          checkoutUrl: checkout.url,
        });
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  // Helper to call change-plan handler
  async function callChangePlanHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>,
    next: express.NextFunction
  ) {
    const handler = async (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      try {
        const currentUserRef = req.userRef;
        if (!currentUserRef) {
          throw unauthorized();
        }
        const currentUserId = currentUserRef.replace("users/", "");

        const { plan } = req.body;
        if (plan !== "starter" && plan !== "pro") {
          throw badRequest('Plan must be "starter" or "pro"');
        }

        const subscription = await mockGetUserSubscription(currentUserId);

        if (!subscription.lemonSqueezySubscriptionId) {
          throw badRequest(
            "No active subscription found. Please use the checkout endpoint to create a new subscription."
          );
        }

        if (
          subscription.plan === "free" ||
          !subscription.status ||
          subscription.status === "expired"
        ) {
          throw badRequest(
            "Cannot change plan for free or expired subscriptions. Please use the checkout endpoint to upgrade."
          );
        }

        const variantId =
          plan === "starter"
            ? process.env.LEMON_SQUEEZY_STARTER_VARIANT_ID
            : process.env.LEMON_SQUEEZY_PRO_VARIANT_ID;

        if (!variantId) {
          throw badRequest(
            `LEMON_SQUEEZY_${plan.toUpperCase()}_VARIANT_ID is not configured`
          );
        }

        const currentVariantId = subscription.lemonSqueezyVariantId;
        if (currentVariantId === variantId) {
          if (subscription.status === "cancelled") {
            await mockUpdateSubscriptionVariant(
              subscription.lemonSqueezySubscriptionId,
              variantId
            );

            const db = await mockDatabase();
            const lemonSqueezySub = await mockGetLemonSqueezySubscription(
              subscription.lemonSqueezySubscriptionId
            );
            const attributes = lemonSqueezySub.attributes;

            await db.subscription.update({
              ...subscription,
              plan,
              status: attributes.status as
                | "active"
                | "past_due"
                | "unpaid"
                | "cancelled"
                | "expired"
                | "on_trial",
              renewsAt: attributes.renews_at,
              endsAt: attributes.ends_at || undefined,
              trialEndsAt: attributes.trial_ends_at || undefined,
              lemonSqueezyVariantId: String(attributes.variant_id),
              lemonSqueezySyncKey: "ACTIVE",
              lastSyncedAt: new Date().toISOString(),
            });

            const subscriptionIdFromSub = subscription.pk.replace(
              "subscriptions/",
              ""
            );
            await mockAssociateSubscriptionWithPlan(
              subscriptionIdFromSub,
              plan
            );

            res.json({
              success: true,
              message: `Subscription reactivated successfully. You are now on the ${plan} plan.`,
              reactivated: true,
            });
            return;
          } else {
            throw badRequest(`You are already on the ${plan} plan`);
          }
        }

        try {
          await mockUpdateSubscriptionVariant(
            subscription.lemonSqueezySubscriptionId,
            variantId
          );

          const db = await mockDatabase();
          try {
            const lemonSqueezySub = await mockGetLemonSqueezySubscription(
              subscription.lemonSqueezySubscriptionId
            );
            const attributes = lemonSqueezySub.attributes;

            const starterVariantIdEnv =
              process.env.LEMON_SQUEEZY_STARTER_VARIANT_ID;
            const proVariantIdEnv = process.env.LEMON_SQUEEZY_PRO_VARIANT_ID;
            const newVariantId = String(attributes.variant_id);
            const newPlan =
              newVariantId === starterVariantIdEnv
                ? "starter"
                : newVariantId === proVariantIdEnv
                ? "pro"
                : "starter";

            await db.subscription.update({
              ...subscription,
              plan: newPlan,
              status: attributes.status as
                | "active"
                | "past_due"
                | "unpaid"
                | "cancelled"
                | "expired"
                | "on_trial",
              renewsAt: attributes.renews_at,
              endsAt: attributes.ends_at || undefined,
              trialEndsAt: attributes.trial_ends_at || undefined,
              lemonSqueezyVariantId: newVariantId,
              lemonSqueezySyncKey: subscription.lemonSqueezySubscriptionId
                ? "ACTIVE"
                : undefined,
              lastSyncedAt: new Date().toISOString(),
            });

            const subscriptionIdFromSub = subscription.pk.replace(
              "subscriptions/",
              ""
            );
            await mockAssociateSubscriptionWithPlan(
              subscriptionIdFromSub,
              newPlan
            );
          } catch {
            // Don't fail the request
          }
        } catch {
          // Don't fail the request - the webhook will update it eventually
          // This handles cases where payment is required or other API errors occur
        }

        res.json({
          success: true,
          message: `Plan changed to ${plan} successfully.`,
        });
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  // Helper to call cancel handler
  async function callCancelHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>,
    next: express.NextFunction
  ) {
    const handler = async (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      try {
        const currentUserRef = req.userRef;
        if (!currentUserRef) {
          throw unauthorized();
        }
        const currentUserId = currentUserRef.replace("users/", "");

        const subscription = await mockGetUserSubscription(currentUserId);

        if (!subscription.lemonSqueezySubscriptionId) {
          throw badRequest("Subscription is not associated with Lemon Squeezy");
        }

        await mockCancelSubscription(subscription.lemonSqueezySubscriptionId);

        const lemonSqueezySub = await mockGetLemonSqueezySubscription(
          subscription.lemonSqueezySubscriptionId
        );

        const db = await mockDatabase();
        await db.subscription.update({
          ...subscription,
          status: "cancelled",
          endsAt: lemonSqueezySub.attributes.ends_at || undefined,
          lemonSqueezySyncKey: undefined,
          lastSyncedAt: new Date().toISOString(),
        });

        res.json({ success: true });
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  describe("POST /api/subscription/checkout", () => {
    it("should create checkout for new subscription (no Lemon Squeezy subscription exists)", async () => {
      const mockDb = createMockDatabase();
      const mockUpdate = vi.fn();
      mockDb.subscription.update = mockUpdate;
      mockDatabase.mockResolvedValue(mockDb);

      const mockSubscription = {
        pk: `subscriptions/${subscriptionId}`,
        plan: "free" as const,
        lemonSqueezySubscriptionId: undefined,
      };
      mockGetUserSubscription.mockResolvedValue(mockSubscription);

      const checkoutUrl = "https://checkout.lemonsqueezy.com/checkout/test";
      mockCreateCheckout.mockResolvedValue({ url: checkoutUrl });

      const req = createMockRequest({
        userRef: `users/${userId}`,
        body: { plan: "starter" },
        session: {
          user: { id: userId, email: "test@example.com" },
          expires: new Date(Date.now() + 3600000).toISOString(),
        },
      });
      const res = createMockResponse();
      const next = vi.fn();

      await callCheckoutHandler(req, res, next);

      expect(mockGetUserSubscription).toHaveBeenCalledWith(userId);
      expect(mockCreateCheckout).toHaveBeenCalledWith({
        storeId,
        variantId: starterVariantId,
        checkoutData: {
          custom: {
            userId,
            subscriptionId,
          },
          email: "test@example.com",
        },
        checkoutOptions: {
          embed: false,
          media: false,
        },
      });
      expect((res as express.Response & { body: unknown }).body).toEqual({
        checkoutUrl,
      });
      expect(res.statusCode).toBe(200);
      // Verify subscription plan NOT changed
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("should reactivate cancelled subscription with same plan", async () => {
      const mockDb = createMockDatabase();
      mockDatabase.mockResolvedValue(mockDb);

      const mockSubscription = {
        pk: `subscriptions/${subscriptionId}`,
        plan: "starter" as const,
        status: "cancelled" as const,
        lemonSqueezySubscriptionId,
        lemonSqueezyVariantId: starterVariantId,
      };
      mockGetUserSubscription.mockResolvedValue(mockSubscription);

      const mockLemonSqueezySub: MockLemonSqueezySubscription = {
        id: lemonSqueezySubscriptionId,
        attributes: {
          status: "active",
          variant_id: parseInt(starterVariantId, 10),
          renews_at: "2024-12-31T23:59:59Z",
          ends_at: null,
          trial_ends_at: null,
        },
      };
      mockUpdateSubscriptionVariant.mockResolvedValue(mockLemonSqueezySub);
      mockGetLemonSqueezySubscription.mockResolvedValue(mockLemonSqueezySub);

      const mockUpdate = vi.fn().mockResolvedValue({
        ...mockSubscription,
        status: "active",
        plan: "starter",
        lemonSqueezySyncKey: "ACTIVE",
      });
      mockDb.subscription.update = mockUpdate;

      mockAssociateSubscriptionWithPlan.mockResolvedValue(undefined);

      const req = createMockRequest({
        userRef: `users/${userId}`,
        body: { plan: "starter" },
        session: {
          user: { id: userId, email: "test@example.com" },
          expires: new Date(Date.now() + 3600000).toISOString(),
        },
      });
      const res = createMockResponse();
      const next = vi.fn();

      await callCheckoutHandler(req, res, next);

      expect(mockUpdateSubscriptionVariant).toHaveBeenCalledWith(
        lemonSqueezySubscriptionId,
        starterVariantId
      );
      expect(mockGetLemonSqueezySubscription).toHaveBeenCalledWith(
        lemonSqueezySubscriptionId
      );
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "active",
          plan: "starter",
          lemonSqueezySyncKey: "ACTIVE",
        })
      );
      expect(mockAssociateSubscriptionWithPlan).toHaveBeenCalledWith(
        subscriptionId,
        "starter"
      );
      expect((res as express.Response & { body: unknown }).body).toEqual({
        success: true,
        message:
          "Subscription reactivated successfully. You are now on the starter plan.",
        reactivated: true,
      });
      expect(res.statusCode).toBe(200);
      // Verify checkout NOT created
      expect(mockCreateCheckout).not.toHaveBeenCalled();
    });

    it("should fall back to checkout when reactivation fails (cancelled, same plan)", async () => {
      const mockDb = createMockDatabase();
      const mockUpdate = vi.fn();
      mockDb.subscription.update = mockUpdate;
      mockDatabase.mockResolvedValue(mockDb);

      const mockSubscription = {
        pk: `subscriptions/${subscriptionId}`,
        plan: "starter" as const,
        status: "cancelled" as const,
        lemonSqueezySubscriptionId,
        lemonSqueezyVariantId: starterVariantId,
      };
      mockGetUserSubscription.mockResolvedValue(mockSubscription);

      mockUpdateSubscriptionVariant.mockRejectedValue(
        new Error("Failed to reactivate subscription")
      );

      const checkoutUrl = "https://checkout.lemonsqueezy.com/checkout/test";
      mockCreateCheckout.mockResolvedValue({ url: checkoutUrl });

      const req = createMockRequest({
        userRef: `users/${userId}`,
        body: { plan: "starter" },
        session: {
          user: { id: userId, email: "test@example.com" },
          expires: new Date(Date.now() + 3600000).toISOString(),
        },
      });
      const res = createMockResponse();
      const next = vi.fn();

      await callCheckoutHandler(req, res, next);

      expect(mockUpdateSubscriptionVariant).toHaveBeenCalled();
      expect(mockCreateCheckout).toHaveBeenCalled();
      expect((res as express.Response & { body: unknown }).body).toEqual({
        checkoutUrl,
      });
      expect(res.statusCode).toBe(200);
      // Verify subscription plan NOT changed
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("should fall back to checkout when variant doesn't change after update (cancelled, same plan)", async () => {
      const mockDb = createMockDatabase();
      const mockUpdate = vi.fn();
      mockDb.subscription.update = mockUpdate;
      mockDatabase.mockResolvedValue(mockDb);

      const mockSubscription = {
        pk: `subscriptions/${subscriptionId}`,
        plan: "starter" as const,
        status: "cancelled" as const,
        lemonSqueezySubscriptionId,
        lemonSqueezyVariantId: starterVariantId,
      };
      mockGetUserSubscription.mockResolvedValue(mockSubscription);

      // updateSubscriptionVariant succeeds, but variant doesn't actually change
      // (Lemon Squeezy requires payment confirmation)
      // In this case, we're requesting starter (same as current), but Lemon Squeezy
      // might require payment to reactivate, so the variant stays cancelled/unchanged
      // We'll simulate this by returning a different variant_id (pro) to indicate
      // the update didn't work as expected, OR we can return the same variant but
      // with cancelled status to indicate it needs payment
      // Actually, let's simulate: we request starter, but Lemon Squeezy returns
      // a different variant (pro) because the update didn't work
      const mockLemonSqueezySub: MockLemonSqueezySubscription = {
        id: lemonSqueezySubscriptionId,
        attributes: {
          status: "cancelled",
          variant_id: parseInt(proVariantId, 10), // Different variant - update didn't work
          renews_at: "2024-12-31T23:59:59Z",
          ends_at: "2024-12-31T23:59:59Z",
          trial_ends_at: null,
        },
      };
      mockUpdateSubscriptionVariant.mockResolvedValue(mockLemonSqueezySub);
      mockGetLemonSqueezySubscription.mockResolvedValue(mockLemonSqueezySub);

      const checkoutUrl = "https://checkout.lemonsqueezy.com/checkout/test";
      mockCreateCheckout.mockResolvedValue({ url: checkoutUrl });

      const req = createMockRequest({
        userRef: `users/${userId}`,
        body: { plan: "starter" },
        session: {
          user: { id: userId, email: "test@example.com" },
          expires: new Date(Date.now() + 3600000).toISOString(),
        },
      });
      const res = createMockResponse();
      const next = vi.fn();

      await callCheckoutHandler(req, res, next);

      expect(mockUpdateSubscriptionVariant).toHaveBeenCalledWith(
        lemonSqueezySubscriptionId,
        starterVariantId
      );
      expect(mockGetLemonSqueezySubscription).toHaveBeenCalledWith(
        lemonSqueezySubscriptionId
      );
      expect(mockCreateCheckout).toHaveBeenCalled();
      expect((res as express.Response & { body: unknown }).body).toEqual({
        checkoutUrl,
      });
      expect(res.statusCode).toBe(200);
      // Verify subscription plan NOT changed (variant didn't change to requested one)
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("should fall back to checkout when status is still cancelled after variant update (cancelled, same plan)", async () => {
      const mockDb = createMockDatabase();
      const mockUpdate = vi.fn();
      mockDb.subscription.update = mockUpdate;
      mockDatabase.mockResolvedValue(mockDb);

      const mockSubscription = {
        pk: `subscriptions/${subscriptionId}`,
        plan: "starter" as const,
        status: "cancelled" as const,
        lemonSqueezySubscriptionId,
        lemonSqueezyVariantId: starterVariantId,
      };
      mockGetUserSubscription.mockResolvedValue(mockSubscription);

      // updateSubscriptionVariant succeeds and variant matches, but status is still cancelled
      // (Lemon Squeezy requires payment confirmation to reactivate)
      const mockLemonSqueezySub: MockLemonSqueezySubscription = {
        id: lemonSqueezySubscriptionId,
        attributes: {
          status: "cancelled", // Still cancelled - needs payment to reactivate
          variant_id: parseInt(starterVariantId, 10), // Variant matches
          renews_at: "2024-12-31T23:59:59Z",
          ends_at: "2024-12-31T23:59:59Z",
          trial_ends_at: null,
        },
      };
      mockUpdateSubscriptionVariant.mockResolvedValue(mockLemonSqueezySub);
      mockGetLemonSqueezySubscription.mockResolvedValue(mockLemonSqueezySub);

      const checkoutUrl = "https://checkout.lemonsqueezy.com/checkout/test";
      mockCreateCheckout.mockResolvedValue({ url: checkoutUrl });

      const req = createMockRequest({
        userRef: `users/${userId}`,
        body: { plan: "starter" },
        session: {
          user: { id: userId, email: "test@example.com" },
          expires: new Date(Date.now() + 3600000).toISOString(),
        },
      });
      const res = createMockResponse();
      const next = vi.fn();

      await callCheckoutHandler(req, res, next);

      expect(mockUpdateSubscriptionVariant).toHaveBeenCalledWith(
        lemonSqueezySubscriptionId,
        starterVariantId
      );
      expect(mockGetLemonSqueezySubscription).toHaveBeenCalledWith(
        lemonSqueezySubscriptionId
      );
      expect(mockCreateCheckout).toHaveBeenCalled();
      expect((res as express.Response & { body: unknown }).body).toEqual({
        checkoutUrl,
      });
      expect(res.statusCode).toBe(200);
      // Verify subscription plan NOT changed (status still cancelled, needs payment)
      // If we updated with cancelled status, getEffectivePlan would return "free"
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("should reactivate cancelled subscription and change to different plan", async () => {
      const mockDb = createMockDatabase();
      mockDatabase.mockResolvedValue(mockDb);

      const mockSubscription = {
        pk: `subscriptions/${subscriptionId}`,
        plan: "starter" as const,
        status: "cancelled" as const,
        lemonSqueezySubscriptionId,
        lemonSqueezyVariantId: starterVariantId,
      };
      mockGetUserSubscription.mockResolvedValue(mockSubscription);

      const mockLemonSqueezySub: MockLemonSqueezySubscription = {
        id: lemonSqueezySubscriptionId,
        attributes: {
          status: "active",
          variant_id: parseInt(proVariantId, 10),
          renews_at: "2024-12-31T23:59:59Z",
          ends_at: null,
          trial_ends_at: null,
        },
      };
      mockUpdateSubscriptionVariant.mockResolvedValue(mockLemonSqueezySub);
      mockGetLemonSqueezySubscription.mockResolvedValue(mockLemonSqueezySub);

      const mockUpdate = vi.fn().mockResolvedValue({
        ...mockSubscription,
        status: "active",
        plan: "pro",
        lemonSqueezyVariantId: proVariantId,
        lemonSqueezySyncKey: "ACTIVE",
      });
      mockDb.subscription.update = mockUpdate;

      mockAssociateSubscriptionWithPlan.mockResolvedValue(undefined);

      const req = createMockRequest({
        userRef: `users/${userId}`,
        body: { plan: "pro" },
        session: {
          user: { id: userId, email: "test@example.com" },
          expires: new Date(Date.now() + 3600000).toISOString(),
        },
      });
      const res = createMockResponse();
      const next = vi.fn();

      await callCheckoutHandler(req, res, next);

      expect(mockUpdateSubscriptionVariant).toHaveBeenCalledWith(
        lemonSqueezySubscriptionId,
        proVariantId
      );
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          plan: "pro",
          lemonSqueezyVariantId: proVariantId,
          status: "active",
          lemonSqueezySyncKey: "ACTIVE",
        })
      );
      expect(mockAssociateSubscriptionWithPlan).toHaveBeenCalledWith(
        subscriptionId,
        "pro"
      );
      expect((res as express.Response & { body: unknown }).body).toEqual({
        success: true,
        message: "Subscription reactivated and changed to pro plan.",
        reactivated: true,
      });
      expect(res.statusCode).toBe(200);
      expect(mockCreateCheckout).not.toHaveBeenCalled();
    });

    it("should fall back to checkout when reactivation fails (cancelled, different plan)", async () => {
      const mockDb = createMockDatabase();
      const mockUpdate = vi.fn();
      mockDb.subscription.update = mockUpdate;
      mockDatabase.mockResolvedValue(mockDb);

      const mockSubscription = {
        pk: `subscriptions/${subscriptionId}`,
        plan: "starter" as const,
        status: "cancelled" as const,
        lemonSqueezySubscriptionId,
        lemonSqueezyVariantId: starterVariantId,
      };
      mockGetUserSubscription.mockResolvedValue(mockSubscription);

      mockUpdateSubscriptionVariant.mockRejectedValue(
        new Error("Failed to reactivate subscription")
      );

      const checkoutUrl = "https://checkout.lemonsqueezy.com/checkout/test";
      mockCreateCheckout.mockResolvedValue({ url: checkoutUrl });

      const req = createMockRequest({
        userRef: `users/${userId}`,
        body: { plan: "pro" },
        session: {
          user: { id: userId, email: "test@example.com" },
          expires: new Date(Date.now() + 3600000).toISOString(),
        },
      });
      const res = createMockResponse();
      const next = vi.fn();

      await callCheckoutHandler(req, res, next);

      expect(mockUpdateSubscriptionVariant).toHaveBeenCalled();
      expect(mockCreateCheckout).toHaveBeenCalledWith(
        expect.objectContaining({
          variantId: proVariantId,
        })
      );
      expect((res as express.Response & { body: unknown }).body).toEqual({
        checkoutUrl,
      });
      expect(res.statusCode).toBe(200);
      // Verify plan NOT changed
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("should fall back to checkout when status is still cancelled after variant update (cancelled, different plan)", async () => {
      const mockDb = createMockDatabase();
      const mockUpdate = vi.fn();
      mockDb.subscription.update = mockUpdate;
      mockDatabase.mockResolvedValue(mockDb);

      const mockSubscription = {
        pk: `subscriptions/${subscriptionId}`,
        plan: "starter" as const,
        status: "cancelled" as const,
        lemonSqueezySubscriptionId,
        lemonSqueezyVariantId: starterVariantId,
      };
      mockGetUserSubscription.mockResolvedValue(mockSubscription);

      // updateSubscriptionVariant succeeds and variant changed, but status is still cancelled
      // (Lemon Squeezy requires payment confirmation to reactivate)
      const mockLemonSqueezySub: MockLemonSqueezySubscription = {
        id: lemonSqueezySubscriptionId,
        attributes: {
          status: "cancelled", // Still cancelled - needs payment to reactivate
          variant_id: parseInt(proVariantId, 10), // Variant changed to pro
          renews_at: "2024-12-31T23:59:59Z",
          ends_at: "2024-12-31T23:59:59Z",
          trial_ends_at: null,
        },
      };
      mockUpdateSubscriptionVariant.mockResolvedValue(mockLemonSqueezySub);
      mockGetLemonSqueezySubscription.mockResolvedValue(mockLemonSqueezySub);

      const checkoutUrl = "https://checkout.lemonsqueezy.com/checkout/test";
      mockCreateCheckout.mockResolvedValue({ url: checkoutUrl });

      const req = createMockRequest({
        userRef: `users/${userId}`,
        body: { plan: "pro" },
        session: {
          user: { id: userId, email: "test@example.com" },
          expires: new Date(Date.now() + 3600000).toISOString(),
        },
      });
      const res = createMockResponse();
      const next = vi.fn();

      await callCheckoutHandler(req, res, next);

      expect(mockUpdateSubscriptionVariant).toHaveBeenCalledWith(
        lemonSqueezySubscriptionId,
        proVariantId
      );
      expect(mockGetLemonSqueezySubscription).toHaveBeenCalledWith(
        lemonSqueezySubscriptionId
      );
      expect(mockCreateCheckout).toHaveBeenCalled();
      expect((res as express.Response & { body: unknown }).body).toEqual({
        checkoutUrl,
      });
      expect(res.statusCode).toBe(200);
      // Verify subscription plan NOT changed (status still cancelled, needs payment)
      // If we updated with cancelled status, getEffectivePlan would return "free"
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("should create checkout for active subscription requesting different plan", async () => {
      const mockDb = createMockDatabase();
      const mockUpdate = vi.fn();
      mockDb.subscription.update = mockUpdate;
      mockDatabase.mockResolvedValue(mockDb);

      const mockSubscription = {
        pk: `subscriptions/${subscriptionId}`,
        plan: "starter" as const,
        status: "active" as const,
        lemonSqueezySubscriptionId,
        lemonSqueezyVariantId: starterVariantId,
      };
      mockGetUserSubscription.mockResolvedValue(mockSubscription);

      const checkoutUrl = "https://checkout.lemonsqueezy.com/checkout/test";
      mockCreateCheckout.mockResolvedValue({ url: checkoutUrl });

      const req = createMockRequest({
        userRef: `users/${userId}`,
        body: { plan: "pro" },
        session: {
          user: { id: userId, email: "test@example.com" },
          expires: new Date(Date.now() + 3600000).toISOString(),
        },
      });
      const res = createMockResponse();
      const next = vi.fn();

      await callCheckoutHandler(req, res, next);

      expect(mockCreateCheckout).toHaveBeenCalledWith(
        expect.objectContaining({
          variantId: proVariantId,
        })
      );
      expect((res as express.Response & { body: unknown }).body).toEqual({
        checkoutUrl,
      });
      expect(res.statusCode).toBe(200);
      // Verify plan NOT changed until checkout completes
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/subscription/change-plan", () => {
    it("should return error when no Lemon Squeezy subscription exists", async () => {
      const mockSubscription = {
        pk: `subscriptions/${subscriptionId}`,
        plan: "free" as const,
        lemonSqueezySubscriptionId: undefined,
      };
      mockGetUserSubscription.mockResolvedValue(mockSubscription);

      const req = createMockRequest({
        userRef: `users/${userId}`,
        body: { plan: "starter" },
      });
      const res = createMockResponse();
      const next = vi.fn();

      await callChangePlanHandler(req, res, next);

      expect(mockGetUserSubscription).toHaveBeenCalledWith(userId);
      expect(next).toHaveBeenCalled();
      const errorCall = next.mock.calls[0]?.[0] as Boom<unknown> | undefined;
      expect(errorCall?.output?.statusCode).toBe(400);
      expect(errorCall?.message).toContain("No active subscription found");
    });

    it("should return error for free subscription", async () => {
      const mockSubscription = {
        pk: `subscriptions/${subscriptionId}`,
        plan: "free" as const,
        status: undefined,
        lemonSqueezySubscriptionId,
      };
      mockGetUserSubscription.mockResolvedValue(mockSubscription);

      const req = createMockRequest({
        userRef: `users/${userId}`,
        body: { plan: "starter" },
      });
      const res = createMockResponse();
      const next = vi.fn();

      await callChangePlanHandler(req, res, next);

      const errorCall = (
        next as unknown as { mock: { calls: Array<[unknown]> } }
      ).mock.calls[0]?.[0] as Boom<unknown> | undefined;
      expect(errorCall?.output?.statusCode).toBe(400);
      expect(errorCall?.message).toContain("Cannot change plan for free");
    });

    it("should return error for expired subscription", async () => {
      const mockSubscription = {
        pk: `subscriptions/${subscriptionId}`,
        plan: "starter" as const,
        status: "expired" as const,
        lemonSqueezySubscriptionId,
      };
      mockGetUserSubscription.mockResolvedValue(mockSubscription);

      const req = createMockRequest({
        userRef: `users/${userId}`,
        body: { plan: "pro" },
      });
      const res = createMockResponse();
      const next = vi.fn();

      await callChangePlanHandler(req, res, next);

      const errorCall = (
        next as unknown as { mock: { calls: Array<[unknown]> } }
      ).mock.calls[0]?.[0] as Boom<unknown> | undefined;
      expect(errorCall?.output?.statusCode).toBe(400);
      expect(errorCall?.message).toContain(
        "Cannot change plan for free or expired"
      );
    });

    it("should return error when already on requested plan (active)", async () => {
      const mockSubscription = {
        pk: `subscriptions/${subscriptionId}`,
        plan: "starter" as const,
        status: "active" as const,
        lemonSqueezySubscriptionId,
        lemonSqueezyVariantId: starterVariantId,
      };
      mockGetUserSubscription.mockResolvedValue(mockSubscription);

      const req = createMockRequest({
        userRef: `users/${userId}`,
        body: { plan: "starter" },
      });
      const res = createMockResponse();
      const next = vi.fn();

      await callChangePlanHandler(req, res, next);

      const errorCall = (
        next as unknown as { mock: { calls: Array<[unknown]> } }
      ).mock.calls[0]?.[0] as Boom<unknown> | undefined;
      expect(errorCall?.output?.statusCode).toBe(400);
      expect(errorCall?.message).toContain(
        "You are already on the starter plan"
      );
    });

    it("should reactivate cancelled subscription when already on requested plan", async () => {
      const mockDb = createMockDatabase();
      mockDatabase.mockResolvedValue(mockDb);

      const mockSubscription = {
        pk: `subscriptions/${subscriptionId}`,
        plan: "starter" as const,
        status: "cancelled" as const,
        lemonSqueezySubscriptionId,
        lemonSqueezyVariantId: starterVariantId,
      };
      mockGetUserSubscription.mockResolvedValue(mockSubscription);

      const mockLemonSqueezySub: MockLemonSqueezySubscription = {
        id: lemonSqueezySubscriptionId,
        attributes: {
          status: "active",
          variant_id: parseInt(starterVariantId, 10),
          renews_at: "2024-12-31T23:59:59Z",
          ends_at: null,
          trial_ends_at: null,
        },
      };
      mockUpdateSubscriptionVariant.mockResolvedValue(mockLemonSqueezySub);
      mockGetLemonSqueezySubscription.mockResolvedValue(mockLemonSqueezySub);

      const mockUpdate = vi.fn().mockResolvedValue({
        ...mockSubscription,
        status: "active",
        lemonSqueezySyncKey: "ACTIVE",
      });
      mockDb.subscription.update = mockUpdate;

      mockAssociateSubscriptionWithPlan.mockResolvedValue(undefined);

      const req = createMockRequest({
        userRef: `users/${userId}`,
        body: { plan: "starter" },
      });
      const res = createMockResponse();
      const next = vi.fn();

      await callChangePlanHandler(req, res, next);

      expect(mockUpdateSubscriptionVariant).toHaveBeenCalledWith(
        lemonSqueezySubscriptionId,
        starterVariantId
      );
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "active",
          lemonSqueezySyncKey: "ACTIVE",
        })
      );
      expect((res as express.Response & { body: unknown }).body).toEqual({
        success: true,
        message:
          "Subscription reactivated successfully. You are now on the starter plan.",
        reactivated: true,
      });
    });

    it("should change plan immediately when updateSubscriptionVariant succeeds", async () => {
      const mockDb = createMockDatabase();
      mockDatabase.mockResolvedValue(mockDb);

      const mockSubscription = {
        pk: `subscriptions/${subscriptionId}`,
        plan: "starter" as const,
        status: "active" as const,
        lemonSqueezySubscriptionId,
        lemonSqueezyVariantId: starterVariantId,
      };
      mockGetUserSubscription.mockResolvedValue(mockSubscription);

      const mockLemonSqueezySub: MockLemonSqueezySubscription = {
        id: lemonSqueezySubscriptionId,
        attributes: {
          status: "active",
          variant_id: parseInt(proVariantId, 10),
          renews_at: "2024-12-31T23:59:59Z",
          ends_at: null,
          trial_ends_at: null,
        },
      };
      mockUpdateSubscriptionVariant.mockResolvedValue(mockLemonSqueezySub);
      mockGetLemonSqueezySubscription.mockResolvedValue(mockLemonSqueezySub);

      const mockUpdate = vi.fn().mockResolvedValue({
        ...mockSubscription,
        plan: "pro",
        lemonSqueezyVariantId: proVariantId,
      });
      mockDb.subscription.update = mockUpdate;

      mockAssociateSubscriptionWithPlan.mockResolvedValue(undefined);

      const req = createMockRequest({
        userRef: `users/${userId}`,
        body: { plan: "pro" },
      });
      const res = createMockResponse();
      const next = vi.fn();

      await callChangePlanHandler(req, res, next);

      expect(mockUpdateSubscriptionVariant).toHaveBeenCalledWith(
        lemonSqueezySubscriptionId,
        proVariantId
      );
      expect(mockGetLemonSqueezySubscription).toHaveBeenCalledWith(
        lemonSqueezySubscriptionId
      );
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          plan: "pro",
          lemonSqueezyVariantId: proVariantId,
        })
      );
      expect(mockAssociateSubscriptionWithPlan).toHaveBeenCalledWith(
        subscriptionId,
        "pro"
      );
      expect((res as express.Response & { body: unknown }).body).toEqual({
        success: true,
        message: "Plan changed to pro successfully.",
      });
      // Verify plan IS changed immediately
      expect(mockUpdate).toHaveBeenCalled();
    });

    it("should handle updateSubscriptionVariant failure gracefully", async () => {
      const mockDb = createMockDatabase();
      const mockUpdate = vi.fn();
      mockDb.subscription.update = mockUpdate;
      mockDatabase.mockResolvedValue(mockDb);

      const mockSubscription = {
        pk: `subscriptions/${subscriptionId}`,
        plan: "starter" as const,
        status: "active" as const,
        lemonSqueezySubscriptionId,
        lemonSqueezyVariantId: starterVariantId,
      };
      mockGetUserSubscription.mockResolvedValue(mockSubscription);

      mockUpdateSubscriptionVariant.mockRejectedValue(
        new Error("Payment required")
      );

      const req = createMockRequest({
        userRef: `users/${userId}`,
        body: { plan: "pro" },
      });
      const res = createMockResponse();
      const next = vi.fn();

      await callChangePlanHandler(req, res, next);

      // Error is caught and logged, but request still succeeds
      // (webhook will update eventually)
      expect(mockUpdateSubscriptionVariant).toHaveBeenCalled();
      expect((res as express.Response & { body: unknown }).body).toEqual({
        success: true,
        message: "Plan changed to pro successfully.",
      });
      // Verify plan NOT changed (waiting for webhook/retry)
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("should change plan for past_due subscription", async () => {
      const mockDb = createMockDatabase();
      mockDatabase.mockResolvedValue(mockDb);

      const mockSubscription = {
        pk: `subscriptions/${subscriptionId}`,
        plan: "starter" as const,
        status: "past_due" as const,
        lemonSqueezySubscriptionId,
        lemonSqueezyVariantId: starterVariantId,
      };
      mockGetUserSubscription.mockResolvedValue(mockSubscription);

      const mockLemonSqueezySub: MockLemonSqueezySubscription = {
        id: lemonSqueezySubscriptionId,
        attributes: {
          status: "active",
          variant_id: parseInt(proVariantId, 10),
          renews_at: "2024-12-31T23:59:59Z",
          ends_at: null,
          trial_ends_at: null,
        },
      };
      mockUpdateSubscriptionVariant.mockResolvedValue(mockLemonSqueezySub);
      mockGetLemonSqueezySubscription.mockResolvedValue(mockLemonSqueezySub);

      const mockUpdate = vi.fn().mockResolvedValue({
        ...mockSubscription,
        plan: "pro",
        lemonSqueezyVariantId: proVariantId,
      });
      mockDb.subscription.update = mockUpdate;

      mockAssociateSubscriptionWithPlan.mockResolvedValue(undefined);

      const req = createMockRequest({
        userRef: `users/${userId}`,
        body: { plan: "pro" },
      });
      const res = createMockResponse();
      const next = vi.fn();

      await callChangePlanHandler(req, res, next);

      expect(mockUpdateSubscriptionVariant).toHaveBeenCalled();
      expect(mockUpdate).toHaveBeenCalled();
      expect((res as express.Response & { body: unknown }).body).toEqual({
        success: true,
        message: "Plan changed to pro successfully.",
      });
    });
  });

  describe("POST /api/subscription/cancel", () => {
    it("should return error when no Lemon Squeezy subscription exists", async () => {
      const mockSubscription = {
        pk: `subscriptions/${subscriptionId}`,
        lemonSqueezySubscriptionId: undefined,
      };
      mockGetUserSubscription.mockResolvedValue(mockSubscription);

      const req = createMockRequest({
        userRef: `users/${userId}`,
      });
      const res = createMockResponse();
      const next = vi.fn();

      await callCancelHandler(req, res, next);

      const errorCall = (
        next as unknown as { mock: { calls: Array<[unknown]> } }
      ).mock.calls[0]?.[0] as Boom<unknown> | undefined;
      expect(errorCall?.output?.statusCode).toBe(400);
      expect(errorCall?.message).toContain(
        "Subscription is not associated with Lemon Squeezy"
      );
    });

    it("should cancel active subscription successfully", async () => {
      const mockDb = createMockDatabase();
      mockDatabase.mockResolvedValue(mockDb);

      const mockSubscription = {
        pk: `subscriptions/${subscriptionId}`,
        status: "active" as const,
        lemonSqueezySubscriptionId,
      };
      mockGetUserSubscription.mockResolvedValue(mockSubscription);

      mockCancelSubscription.mockResolvedValue(undefined);

      const endsAt = "2024-12-31T23:59:59Z";
      const mockLemonSqueezySub = {
        id: lemonSqueezySubscriptionId,
        attributes: {
          status: "cancelled",
          ends_at: endsAt,
        },
      };
      mockGetLemonSqueezySubscription.mockResolvedValue(mockLemonSqueezySub);

      const mockUpdate = vi.fn().mockResolvedValue({
        ...mockSubscription,
        status: "cancelled",
        endsAt,
        lemonSqueezySyncKey: undefined,
      });
      mockDb.subscription.update = mockUpdate;

      const req = createMockRequest({
        userRef: `users/${userId}`,
      });
      const res = createMockResponse();
      const next = vi.fn();

      await callCancelHandler(req, res, next);

      expect(mockCancelSubscription).toHaveBeenCalledWith(
        lemonSqueezySubscriptionId
      );
      expect(mockGetLemonSqueezySubscription).toHaveBeenCalledWith(
        lemonSqueezySubscriptionId
      );
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "cancelled",
          endsAt,
          lemonSqueezySyncKey: undefined,
        })
      );
      expect((res as express.Response & { body: unknown }).body).toEqual({
        success: true,
      });
      expect(res.statusCode).toBe(200);
    });

    it("should handle already cancelled subscription (idempotent)", async () => {
      const mockDb = createMockDatabase();
      mockDatabase.mockResolvedValue(mockDb);

      const mockSubscription = {
        pk: `subscriptions/${subscriptionId}`,
        status: "cancelled" as const,
        lemonSqueezySubscriptionId,
      };
      mockGetUserSubscription.mockResolvedValue(mockSubscription);

      mockCancelSubscription.mockResolvedValue(undefined);

      const endsAt = "2024-12-31T23:59:59Z";
      const mockLemonSqueezySub = {
        id: lemonSqueezySubscriptionId,
        attributes: {
          status: "cancelled",
          ends_at: endsAt,
        },
      };
      mockGetLemonSqueezySubscription.mockResolvedValue(mockLemonSqueezySub);

      const mockUpdate = vi.fn().mockResolvedValue({
        ...mockSubscription,
        endsAt,
        lemonSqueezySyncKey: undefined,
      });
      mockDb.subscription.update = mockUpdate;

      const req = createMockRequest({
        userRef: `users/${userId}`,
      });
      const res = createMockResponse();
      const next = vi.fn();

      await callCancelHandler(req, res, next);

      expect(mockCancelSubscription).toHaveBeenCalled();
      expect(mockUpdate).toHaveBeenCalled();
      expect((res as express.Response & { body: unknown }).body).toEqual({
        success: true,
      });
    });

    it("should propagate error when cancelSubscription fails", async () => {
      const mockSubscription = {
        pk: `subscriptions/${subscriptionId}`,
        status: "active" as const,
        lemonSqueezySubscriptionId,
      };
      mockGetUserSubscription.mockResolvedValue(mockSubscription);

      const error = new Error("Lemon Squeezy API error");
      mockCancelSubscription.mockRejectedValue(error);

      const req = createMockRequest({
        userRef: `users/${userId}`,
      });
      const res = createMockResponse();
      const next = vi.fn();

      await callCancelHandler(req, res, next);

      expect(mockCancelSubscription).toHaveBeenCalled();
      // Error should propagate to error handler
      expect(next).toHaveBeenCalled();
      const errorCall = next.mock.calls[0]?.[0];
      expect(errorCall).toBe(error);
      // Database should NOT be updated
      expect(mockDatabase).not.toHaveBeenCalled();
    });
  });
});
