import type { NextFunction, Request, Response } from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
} from "../../utils/__tests__/test-helpers";

const {
  mockDatabase,
  mockGetUserSubscription,
  mockGetLemonSqueezySubscription,
} = vi.hoisted(() => ({
  mockDatabase: vi.fn(),
  mockGetUserSubscription: vi.fn(),
  mockGetLemonSqueezySubscription: vi.fn(),
}));

type ExpressRouter = {
  stack: Array<{
    route?: {
      path?: string;
      stack?: Array<{
        handle: (
          req: Request,
          res: Response,
          next: NextFunction,
        ) => Promise<void>;
      }>;
    };
  }>;
};

const getAppRouter = (app: unknown): ExpressRouter | undefined => {
  const appWithRouter = app as {
    _router?: ExpressRouter;
    router?: ExpressRouter;
  };
  return appWithRouter._router ?? appWithRouter.router;
};

describe("Subscription Sync Endpoint", () => {
  const userId = "user-123";
  const subscriptionId = "sub-123";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("LEMON_SQUEEZY_STARTER_VARIANT_ID", "123");
    vi.stubEnv("LEMON_SQUEEZY_PRO_VARIANT_ID", "456");

    mockDatabase.mockResolvedValue({
      subscription: {
        update: vi.fn(),
        get: vi.fn(),
      },
    });
  });

  it("returns 400 when Lemon Squeezy subscription is missing", async () => {
    await vi.resetModules();
    vi.doMock("../../../tables", () => ({
      database: mockDatabase,
    }));
    vi.doMock("../../../utils/subscriptionUtils", () => ({
      getUserSubscription: mockGetUserSubscription,
    }));
    vi.doMock("../../../utils/lemonSqueezy", () => ({
      createCheckout: vi.fn(),
      cancelSubscription: vi.fn(),
      getSubscription: mockGetLemonSqueezySubscription,
      listSubscriptionsByCustomer: vi.fn(),
      updateSubscriptionVariant: vi.fn(),
      isLemonSqueezyNotFoundError: vi.fn((error: unknown) => {
        return (
          error instanceof Error &&
          error.message.includes("Lemon Squeezy API error: 404")
        );
      }),
    }));
    const { createApp } = await import("../subscription-app");
    mockGetUserSubscription.mockResolvedValue({
      pk: `subscriptions/${subscriptionId}`,
      sk: `subscriptions/${subscriptionId}`,
      plan: "starter",
      status: "active",
      lemonSqueezySubscriptionId: "ls-sub-123",
      lemonSqueezyVariantId: "123",
      lemonSqueezyCustomerId: "cust-123",
      lastSyncedAt: "2025-01-01T00:00:00Z",
    });

    mockGetLemonSqueezySubscription.mockRejectedValue(
      new Error("Lemon Squeezy API error: 404 Not Found - /data: Not found"),
    );

    const app = createApp();
    const router = getAppRouter(app);
    const handlerLayer = router?.stack.find(
      (layer) => layer.route?.path === "/sync",
    );
    const handler =
      handlerLayer?.route?.stack?.[handlerLayer.route.stack.length - 1]?.handle;
    if (!handler) {
      throw new Error("Subscription sync handler not found");
    }

    const req = createMockRequest({
      method: "POST",
      path: "/sync",
      userRef: `users/${userId}`,
    }) as Request;
    const res = createMockResponse() as ReturnType<
      typeof createMockResponse
    > & {
      body: unknown;
      json: ReturnType<typeof vi.fn>;
    };
    let resolveResponse: () => void;
    const responsePromise = new Promise<void>((resolve) => {
      resolveResponse = resolve;
    });
    res.json.mockImplementation((data: unknown) => {
      res.body = data;
      resolveResponse();
      return res;
    });
    const next = vi.fn();

    await handler(req, res as Response, next);
    await responsePromise;

    expect(mockGetLemonSqueezySubscription).toHaveBeenCalledWith("ls-sub-123");
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message:
        "Subscription is not associated with Lemon Squeezy or could not be found.",
      synced: false,
    });
    expect(next).not.toHaveBeenCalled();
  });
});
