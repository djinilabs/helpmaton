import type {
  APIGatewayProxyEventV2,
  Callback,
  Context,
} from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AugmentedContext } from "../../../utils/workspaceCreditContext";
import { createAPIGatewayEventV2 } from "../../utils/__tests__/test-helpers";
import { handler } from "../index";

// Mock dependencies using vi.hoisted
const {
  mockDatabase,
  mockVerifyWebhookSignature,
  mockGetLemonSqueezySubscription,
  mockGetLemonSqueezyOrder,
  mockGetUserSubscription,
  mockGetSubscriptionById,
  mockSendPaymentFailedEmail,
  mockSendSubscriptionCancelledEmail,
  mockGetUserEmailById,
} = vi.hoisted(() => {
  const database = vi.fn();
  const verifyWebhookSignature = vi.fn();
  const getSubscription = vi.fn();
  const getOrder = vi.fn();
  const getUserSubscription = vi.fn();
  const getSubscriptionById = vi.fn();
  const sendPaymentFailedEmail = vi.fn();
  const sendSubscriptionCancelledEmail = vi.fn();
  const getUserEmailById = vi.fn().mockResolvedValue("user@example.com");
  return {
    mockDatabase: database,
    mockVerifyWebhookSignature: verifyWebhookSignature,
    mockGetLemonSqueezySubscription: getSubscription,
    mockGetLemonSqueezyOrder: getOrder,
    mockGetUserSubscription: getUserSubscription,
    mockGetSubscriptionById: getSubscriptionById,
    mockSendPaymentFailedEmail: sendPaymentFailedEmail,
    mockSendSubscriptionCancelledEmail: sendSubscriptionCancelledEmail,
    mockGetUserEmailById: getUserEmailById,
  };
});

vi.mock("../../../tables", () => ({
  database: () => mockDatabase(),
}));

// Mock @architect/functions for database initialization
vi.mock("@architect/functions", () => ({
  tables: vi.fn().mockResolvedValue({
    reflect: vi.fn().mockResolvedValue({}),
    _client: {},
  }),
}));

vi.mock("../../../utils/lemonSqueezy", () => ({
  verifyWebhookSignature: mockVerifyWebhookSignature,
  getSubscription: mockGetLemonSqueezySubscription,
  getOrder: mockGetLemonSqueezyOrder,
}));

vi.mock("../../../utils/subscriptionUtils", () => ({
  getUserSubscription: mockGetUserSubscription,
  getSubscriptionById: mockGetSubscriptionById,
  getUserEmailById: mockGetUserEmailById,
}));

vi.mock("../../../utils/subscriptionEmails", () => ({
  sendPaymentFailedEmail: mockSendPaymentFailedEmail,
  sendSubscriptionCancelledEmail: mockSendSubscriptionCancelledEmail,
}));

// Mock apiGatewayUsagePlans module
const mockAssociateSubscriptionWithPlan = vi.fn().mockResolvedValue(undefined);
vi.mock("../../../utils/apiGatewayUsagePlans", () => ({
  associateSubscriptionWithPlan: mockAssociateSubscriptionWithPlan,
}));

// Mock workspaceCreditContext
const mockContext: AugmentedContext = {
  awsRequestId: "test-request-id",
  addWorkspaceCreditTransaction: vi.fn(),
  getRemainingTimeInMillis: () => 30000,
  functionName: "test-function",
  functionVersion: "$LATEST",
  invokedFunctionArn: "arn:aws:lambda:us-east-1:123456789012:function:test",
  memoryLimitInMB: "128",
  logGroupName: "/aws/lambda/test",
  logStreamName: "2024/01/01/[$LATEST]test",
  callbackWaitsForEmptyEventLoop: true,
  succeed: vi.fn(),
  fail: vi.fn(),
  done: vi.fn(),
} as AugmentedContext;

vi.mock("../../../utils/workspaceCreditContext", () => ({
  getContextFromRequestId: vi.fn(() => mockContext),
  augmentContextWithCreditTransactions: vi.fn((context) => ({
    ...context,
    addWorkspaceCreditTransaction: vi.fn(),
  })),
  commitContextTransactions: vi.fn().mockResolvedValue(undefined),
}));

// Mock crypto for signature verification - must be in hoisted block
const {
  mockCreateHmac,
  mockHmacUpdate,
  mockHmacDigest,
  mockTimingSafeEqual,
} = vi.hoisted(() => ({
  mockCreateHmac: vi.fn(),
  mockHmacUpdate: vi.fn(),
  mockHmacDigest: vi.fn(),
  mockTimingSafeEqual: vi.fn(),
}));

vi.mock("crypto", () => ({
  default: {
    createHmac: mockCreateHmac,
    timingSafeEqual: mockTimingSafeEqual,
  },
}));

describe("Lemon Squeezy Webhook Handler", () => {
  let mockDb: {
    subscription: {
      update: ReturnType<typeof vi.fn>;
      get: ReturnType<typeof vi.fn>;
      query: ReturnType<typeof vi.fn>;
    };
    workspace: {
      get: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      atomicUpdate: ReturnType<typeof vi.fn>;
    };
    "next-auth": {
      query: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LEMON_SQUEEZY_WEBHOOK_SECRET = "test-secret";
    process.env.LEMON_SQUEEZY_STARTER_VARIANT_ID = "var-starter";
    process.env.LEMON_SQUEEZY_PRO_VARIANT_ID = "var-pro";

    mockDb = {
      subscription: {
        update: vi.fn().mockImplementation((subscription) => {
          // Return the updated subscription object
          return Promise.resolve(subscription);
        }),
        get: vi.fn(),
        query: vi.fn(),
      },
      workspace: {
        get: vi.fn(),
        update: vi.fn().mockResolvedValue(undefined),
        atomicUpdate: vi.fn().mockResolvedValue(undefined),
      },
      "next-auth": {
        query: vi.fn(),
      },
    };

    mockDatabase.mockResolvedValue(mockDb);
    mockVerifyWebhookSignature.mockReturnValue(true);

    // Setup crypto mocks
    const mockHmac = {
      update: mockHmacUpdate,
      digest: mockHmacDigest,
    };
    mockHmacUpdate.mockReturnValue(mockHmac);
    mockCreateHmac.mockReturnValue(mockHmac);
    mockHmacDigest.mockReturnValue("valid-signature");
    mockTimingSafeEqual.mockReturnValue(true);
  });

  describe("signature verification", () => {
    it("should return 401 if signature is missing", async () => {
      const event = createAPIGatewayEventV2({
        headers: {},
        body: JSON.stringify({
          meta: { event_name: "subscription_created" },
          data: { id: "sub-123", type: "subscriptions", attributes: {} },
        }),
      });

      // Handler is wrapped by adaptHttpHandler which returns a Promise
      const mockContext: Context = {
        getRemainingTimeInMillis: () => 30000,
      } as Context;
      const mockCallback: Callback = () => {};
      const result = (await handler(event, mockContext, mockCallback)) as {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      };

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body || "{}")).toEqual({
        error: "Missing signature",
      });
    });

    it("should return 401 if signature is invalid", async () => {
      mockVerifyWebhookSignature.mockReturnValue(false);

      const event = createAPIGatewayEventV2({
        headers: {
          "x-signature": "invalid-signature",
        },
        body: JSON.stringify({
          meta: { event_name: "subscription_created" },
          data: { id: "sub-123", type: "subscriptions", attributes: {} },
        }),
      });

      const mockContext: Context = {
        getRemainingTimeInMillis: () => 30000,
      } as Context;
      const mockCallback: Callback = () => {};
      const result = (await handler(event, mockContext, mockCallback)) as {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      };

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body || "{}")).toEqual({
        error: "Invalid signature",
      });
    });
  });

  describe("subscription_created", () => {
    it("should handle subscription_created with subscription ID from custom data", async () => {
      const subscription = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "free",
        createdAt: new Date().toISOString(),
        version: 1,
      };

      mockGetSubscriptionById.mockResolvedValue(subscription);

      const event = createAPIGatewayEventV2({
        headers: {
          "x-signature": "valid-signature",
        },
        body: JSON.stringify({
          meta: {
            event_name: "subscription_created",
            custom_data: {
              subscriptionId: "sub-123",
              userId: "user-123",
            },
          },
          data: {
            id: "ls-sub-123",
            type: "subscriptions",
            attributes: {
              store_id: 1,
              customer_id: 1,
              order_id: 1,
              variant_id: "var-starter",
              user_email: "user@example.com",
              status: "active",
              renews_at: "2025-02-01T00:00:00Z",
              ends_at: null,
              trial_ends_at: null,
              created_at: new Date().toISOString(),
            },
          },
        }),
      });

      const mockContext: Context = {
        getRemainingTimeInMillis: () => 30000,
      } as Context;
      const mockCallback: Callback = () => {};
      const result = (await handler(event, mockContext, mockCallback)) as {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      };

      expect(result.statusCode).toBe(200);
      expect(mockGetSubscriptionById).toHaveBeenCalledWith("sub-123");
      expect(mockDb.subscription?.update).toHaveBeenCalled();
    });

    it("should fallback to email lookup if subscription ID not found", async () => {
      mockGetSubscriptionById.mockResolvedValue(undefined);

      const subscription = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "free",
        createdAt: new Date().toISOString(),
        version: 1,
      };

      mockGetUserSubscription.mockResolvedValue(subscription);

      const event = createAPIGatewayEventV2({
        headers: {
          "x-signature": "valid-signature",
        },
        body: JSON.stringify({
          meta: {
            event_name: "subscription_created",
            custom_data: {},
          },
          data: {
            id: "ls-sub-123",
            type: "subscriptions",
            attributes: {
              store_id: 1,
              customer_id: 1,
              order_id: 1,
              variant_id: "var-starter",
              user_email: "user@example.com",
              status: "active",
              renews_at: "2025-02-01T00:00:00Z",
              ends_at: null,
              trial_ends_at: null,
              created_at: new Date().toISOString(),
            },
          },
        }),
      });

      // Mock findUserIdByEmail by querying next-auth table
      mockDb["next-auth"].query.mockResolvedValue({
        items: [{ id: "user-123" }],
      });

      const mockContext: Context = {
        getRemainingTimeInMillis: () => 30000,
      } as Context;
      const mockCallback: Callback = () => {};
      const result = (await handler(event, mockContext, mockCallback)) as {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      };

      expect(result.statusCode).toBe(200);
      expect(mockGetUserSubscription).toHaveBeenCalled();
    });
  });

  describe("subscription_updated", () => {
    it("should handle subscription_updated event", async () => {
      const subscription = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "starter",
        status: "active",
        lemonSqueezySubscriptionId: "ls-sub-123",
        createdAt: new Date().toISOString(),
        version: 1,
      };

      mockGetSubscriptionById.mockResolvedValue(subscription);
      mockGetLemonSqueezySubscription.mockResolvedValue({
        attributes: {
          user_email: "user@example.com",
        },
      });

      const event = createAPIGatewayEventV2({
        headers: {
          "x-signature": "valid-signature",
        },
        body: JSON.stringify({
          meta: {
            event_name: "subscription_updated",
            custom_data: {
              subscriptionId: "sub-123",
            },
          },
          data: {
            id: "ls-sub-123",
            type: "subscriptions",
            attributes: {
              status: "active",
              renews_at: "2025-02-01T00:00:00Z",
              ends_at: null,
              trial_ends_at: null,
              variant_id: "var-starter",
            },
          },
        }),
      });

      const mockContext: Context = {
        getRemainingTimeInMillis: () => 30000,
      } as Context;
      const mockCallback: Callback = () => {};
      const result = (await handler(event, mockContext, mockCallback)) as {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      };

      expect(result.statusCode).toBe(200);
      expect(mockDb.subscription?.update).toHaveBeenCalled();
    });
  });

  describe("subscription_past_due", () => {
    it("should handle subscription_past_due event", async () => {
      const subscription = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "starter",
        status: "active",
        lemonSqueezySubscriptionId: "ls-sub-123",
        createdAt: new Date().toISOString(),
        version: 1,
      };

      mockGetSubscriptionById.mockResolvedValue(subscription);

      const event = createAPIGatewayEventV2({
        headers: {
          "x-signature": "valid-signature",
        },
        body: JSON.stringify({
          meta: {
            event_name: "subscription_past_due",
            custom_data: {
              subscriptionId: "sub-123",
            },
          },
          data: {
            id: "ls-sub-123",
            type: "subscriptions",
            attributes: {},
          },
        }),
      });

      const mockContext: Context = {
        getRemainingTimeInMillis: () => 30000,
      } as Context;
      const mockCallback: Callback = () => {};
      const result = (await handler(event, mockContext, mockCallback)) as {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      };

      expect(result.statusCode).toBe(200);
      expect(mockDb.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "past_due",
          gracePeriodEndsAt: expect.any(String),
        })
      );
      expect(mockSendPaymentFailedEmail).toHaveBeenCalled();
    });
  });

  describe("subscription_cancelled", () => {
    it("should handle subscription_cancelled event", async () => {
      const subscription = {
        pk: "subscriptions/sub-123",
        sk: "subscription",
        userId: "user-123",
        plan: "starter",
        status: "active",
        lemonSqueezySubscriptionId: "ls-sub-123",
        createdAt: new Date().toISOString(),
        version: 1,
      };

      mockGetSubscriptionById.mockResolvedValue(subscription);
      mockGetLemonSqueezySubscription.mockResolvedValue({
        attributes: {
          user_email: "user@example.com",
          ends_at: "2025-03-01T00:00:00Z",
        },
      });

      const event = createAPIGatewayEventV2({
        headers: {
          "x-signature": "valid-signature",
        },
        body: JSON.stringify({
          meta: {
            event_name: "subscription_cancelled",
            custom_data: {
              subscriptionId: "sub-123",
            },
          },
          data: {
            id: "ls-sub-123",
            type: "subscriptions",
            attributes: {},
          },
        }),
      });

      const mockContext: Context = {
        getRemainingTimeInMillis: () => 30000,
      } as Context;
      const mockCallback: Callback = () => {};
      const result = (await handler(event, mockContext, mockCallback)) as {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      };

      expect(result.statusCode).toBe(200);
      expect(mockDb.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "cancelled",
        })
      );
      expect(mockSendSubscriptionCancelledEmail).toHaveBeenCalled();
    });
  });

  describe("order_created", () => {
    it("should handle order_created event for credit purchase", async () => {
      const workspace = {
        pk: "workspaces/ws-123",
        sk: "workspace",
        creditBalance: 100,
      };

      mockDb.workspace?.get.mockResolvedValue(workspace);
      mockGetLemonSqueezyOrder.mockResolvedValue({
        attributes: {
          total: 5000, // 50.00 EUR in cents
        },
      });

      const event = createAPIGatewayEventV2({
        headers: {
          "x-signature": "valid-signature",
        },
        body: JSON.stringify({
          meta: {
            event_name: "order_created",
            custom_data: {
              workspaceId: "ws-123",
            },
          },
          data: {
            id: "order-123",
            type: "orders",
            attributes: {},
          },
        }),
        requestContext: {
          requestId: "test-request-id",
        } as APIGatewayProxyEventV2["requestContext"],
      });

      const lambdaContext: Context = {
        getRemainingTimeInMillis: () => 30000,
      } as Context;
      const mockCallback: Callback = () => {};
      const result = (await handler(event, lambdaContext, mockCallback)) as {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      };

      expect(result.statusCode).toBe(200);
      // With transaction system, verify transaction was added to buffer instead of atomicUpdate
      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "ws-123",
          amountMillionthUsd: expect.any(Number),
        })
      );
    });

    it("should throw error if workspace ID is missing", async () => {
      const event = createAPIGatewayEventV2({
        headers: {
          "x-signature": "valid-signature",
        },
        body: JSON.stringify({
          meta: {
            event_name: "order_created",
            custom_data: {},
          },
          data: {
            id: "order-123",
            type: "orders",
            attributes: {},
          },
        }),
      });

      const mockContext: Context = {
        getRemainingTimeInMillis: () => 30000,
      } as Context;
      const mockCallback: Callback = () => {};
      const result = (await handler(event, mockContext, mockCallback)) as {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      };

      // Unrecoverable failure - should return 500 and report to Sentry
      expect(result.statusCode).toBe(500);
      expect(mockDb.workspace?.atomicUpdate).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should return 500 for critical errors (database, network)", async () => {
      mockGetSubscriptionById.mockRejectedValue(new Error("Database error"));

      const event = createAPIGatewayEventV2({
        headers: {
          "x-signature": "valid-signature",
        },
        body: JSON.stringify({
          meta: {
            event_name: "subscription_created",
            custom_data: {
              subscriptionId: "sub-123",
            },
          },
          data: {
            id: "ls-sub-123",
            type: "subscriptions",
            attributes: {
              store_id: 1,
              customer_id: 1,
              order_id: 1,
              variant_id: "var-starter",
              user_email: "user@example.com",
              status: "active",
              renews_at: "2025-02-01T00:00:00Z",
              ends_at: null,
              trial_ends_at: null,
              created_at: new Date().toISOString(),
            },
          },
        }),
      });

      // All errors now return 500 and are reported to Sentry
      const mockContext: Context = {
        getRemainingTimeInMillis: () => 30000,
      } as Context;
      const mockCallback: Callback = () => {};
      const result = (await handler(event, mockContext, mockCallback)) as {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      };
      expect(result.statusCode).toBe(500);
    });

    it("should return 500 for all errors (all errors are now reported to Sentry)", async () => {
      mockGetSubscriptionById.mockRejectedValue(
        new Error("Invalid subscription data")
      );

      const event = createAPIGatewayEventV2({
        headers: {
          "x-signature": "valid-signature",
        },
        body: JSON.stringify({
          meta: {
            event_name: "subscription_created",
            custom_data: {
              subscriptionId: "sub-123",
            },
          },
          data: {
            id: "ls-sub-123",
            type: "subscriptions",
            attributes: {
              store_id: 1,
              customer_id: 1,
              order_id: 1,
              variant_id: "var-starter",
              user_email: "user@example.com",
              status: "active",
              renews_at: "2025-02-01T00:00:00Z",
              ends_at: null,
              trial_ends_at: null,
              created_at: new Date().toISOString(),
            },
          },
        }),
      });

      // All errors now return 500 and are reported to Sentry with full context
      const mockContext: Context = {
        getRemainingTimeInMillis: () => 30000,
      } as Context;
      const mockCallback: Callback = () => {};
      const result = (await handler(event, mockContext, mockCallback)) as {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      };
      expect(result.statusCode).toBe(500);
    });
  });
});
