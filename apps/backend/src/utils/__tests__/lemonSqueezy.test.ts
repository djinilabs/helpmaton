import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  verifyWebhookSignature,
  getSubscription,
  getCustomer,
  getOrder,
  getVariant,
  createCheckout,
  cancelSubscription,
  getCustomerPortalUrl,
} from "../lemonSqueezy";

// Mock environment variables
const originalEnv = process.env;

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock crypto using vi.hoisted
const { mockCreateHmac, mockHmacUpdate, mockHmacDigest, mockTimingSafeEqual } =
  vi.hoisted(() => {
    const createHmac = vi.fn();
    const hmacUpdate = vi.fn();
    const hmacDigest = vi.fn();
    const timingSafeEqual = vi.fn();
    return {
      mockCreateHmac: createHmac,
      mockHmacUpdate: hmacUpdate,
      mockHmacDigest: hmacDigest,
      mockTimingSafeEqual: timingSafeEqual,
    };
  });

vi.mock("crypto", () => ({
  default: {
    createHmac: mockCreateHmac,
    timingSafeEqual: mockTimingSafeEqual,
  },
}));

describe("lemonSqueezy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      LEMON_SQUEEZY_API_KEY: "sk_test_1234567890",
      LEMON_SQUEEZY_WEBHOOK_SECRET: "test-webhook-secret",
      NODE_ENV: "test",
    };

    // Setup crypto mocks
    const mockHmac = {
      update: mockHmacUpdate,
      digest: mockHmacDigest,
    };
    mockHmacUpdate.mockReturnValue(mockHmac);
    mockCreateHmac.mockReturnValue(mockHmac);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("verifyWebhookSignature", () => {
    it("should verify a valid webhook signature", () => {
      const body = '{"data":{"id":"123"}}';
      const signature = "valid-signature-hex";

      mockHmacDigest.mockReturnValue("valid-signature-hex");
      mockTimingSafeEqual.mockReturnValue(true);

      const result = verifyWebhookSignature(body, signature);

      expect(result).toBe(true);
      expect(mockCreateHmac).toHaveBeenCalledWith(
        "sha256",
        "test-webhook-secret"
      );
      expect(mockHmacUpdate).toHaveBeenCalledWith(body);
    });

    it("should reject an invalid webhook signature", () => {
      const body = '{"data":{"id":"123"}}';
      const signature = "invalid-signature";

      mockHmacDigest.mockReturnValue("valid-signature-hex");
      mockTimingSafeEqual.mockReturnValue(false);

      const result = verifyWebhookSignature(body, signature);

      expect(result).toBe(false);
    });

    it("should reject signature with different length", () => {
      const body = '{"data":{"id":"123"}}';
      const signature = "short";

      mockHmacDigest.mockReturnValue("valid-signature-hex-very-long");

      const result = verifyWebhookSignature(body, signature);

      expect(result).toBe(false);
    });

    it("should throw error if webhook secret is missing", () => {
      delete process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;

      expect(() => {
        verifyWebhookSignature("body", "signature");
      }).toThrow(
        "LEMON_SQUEEZY_WEBHOOK_SECRET environment variable is required"
      );
    });
  });

  describe("getSubscription", () => {
    it("should fetch subscription details", async () => {
      const mockSubscription = {
        data: {
          id: "sub-123",
          type: "subscriptions",
          attributes: {
            store_id: 1,
            customer_id: 1,
            order_id: 1,
            variant_id: 1,
            status: "active",
            renews_at: "2025-02-01T00:00:00Z",
            ends_at: null,
            trial_ends_at: null,
            user_email: "test@example.com",
          },
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockSubscription,
      });

      const result = await getSubscription("sub-123");

      expect(result).toEqual(mockSubscription.data);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.lemonsqueezy.com/v1/subscriptions/sub-123",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer sk_test_1234567890",
            Accept: "application/vnd.api+json",
          }),
        })
      );
    });

    it("should throw error on API failure", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => '{"errors":[{"detail":"Subscription not found"}]}',
      });

      await expect(getSubscription("invalid-id")).rejects.toThrow(
        "Lemon Squeezy API error"
      );
    });
  });

  describe("getCustomer", () => {
    it("should fetch customer details", async () => {
      const mockCustomer = {
        data: {
          id: "cust-123",
          type: "customers",
          attributes: {
            store_id: 1,
            name: "Test User",
            email: "test@example.com",
            status: "subscribed",
          },
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockCustomer,
      });

      const result = await getCustomer("cust-123");

      expect(result).toEqual(mockCustomer.data);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.lemonsqueezy.com/v1/customers/cust-123",
        expect.any(Object)
      );
    });
  });

  describe("getOrder", () => {
    it("should fetch order details", async () => {
      const mockOrder = {
        data: {
          id: "order-123",
          type: "orders",
          attributes: {
            store_id: 1,
            total: 2900,
            status: "paid",
            user_email: "test@example.com",
          },
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockOrder,
      });

      const result = await getOrder("order-123");

      expect(result).toEqual(mockOrder.data);
    });
  });

  describe("getVariant", () => {
    it("should fetch variant details", async () => {
      const mockVariant = {
        data: {
          id: "variant-123",
          type: "variants",
          attributes: {
            name: "Starter Plan",
            price: 2900,
          },
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockVariant,
      });

      const result = await getVariant("variant-123");

      expect(result).toEqual(mockVariant.data);
    });
  });

  describe("createCheckout", () => {
    beforeEach(() => {
      process.env.LEMON_SQUEEZY_STORE_ID = "store-123";
    });

    it("should create a checkout with required fields", async () => {
      const mockCheckout = {
        data: {
          id: "checkout-123",
          type: "checkouts",
          attributes: {
            url: "https://checkout.lemonsqueezy.com/checkout/abc123",
          },
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockCheckout,
      });

      const result = await createCheckout({
        storeId: "store-123",
        variantId: "variant-123",
        checkoutData: {
          custom: {
            userId: "user-123",
            subscriptionId: "sub-123",
          },
        },
      });

      expect(result.url).toBe(
        "https://checkout.lemonsqueezy.com/checkout/abc123"
      );
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.lemonsqueezy.com/v1/checkouts",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"type":"checkouts"'),
        })
      );
    });

    it("should include test_mode when NODE_ENV is not production", async () => {
      process.env.NODE_ENV = "development";

      const mockCheckout = {
        data: {
          attributes: { url: "https://checkout.lemonsqueezy.com/test" },
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockCheckout,
      });

      await createCheckout({
        storeId: "store-123",
        variantId: "variant-123",
      });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.data.attributes.test_mode).toBe(true);
    });

    it("should not include test_mode when NODE_ENV is production", async () => {
      process.env.NODE_ENV = "production";

      const mockCheckout = {
        data: {
          attributes: { url: "https://checkout.lemonsqueezy.com/test" },
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockCheckout,
      });

      await createCheckout({
        storeId: "store-123",
        variantId: "variant-123",
      });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.data.attributes.test_mode).toBe(false);
    });

    it("should include custom_price when provided", async () => {
      const mockCheckout = {
        data: {
          attributes: { url: "https://checkout.lemonsqueezy.com/test" },
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockCheckout,
      });

      await createCheckout({
        storeId: "store-123",
        variantId: "variant-123",
        customPrice: 5000,
      });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.data.attributes.custom_price).toBe(5000);
    });

    it("should include relationships for store and variant", async () => {
      const mockCheckout = {
        data: {
          attributes: { url: "https://checkout.lemonsqueezy.com/test" },
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockCheckout,
      });

      await createCheckout({
        storeId: "store-123",
        variantId: "variant-123",
      });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.data.relationships.store.data).toEqual({
        type: "stores",
        id: "store-123",
      });
      expect(requestBody.data.relationships.variant.data).toEqual({
        type: "variants",
        id: "variant-123",
      });
    });

    it("should throw error if variantId is missing", async () => {
      await expect(
        createCheckout({
          storeId: "store-123",
          variantId: "",
        })
      ).rejects.toThrow("variantId is required");
    });

    it("should provide helpful error message for 404 variant", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () =>
          '{"errors":[{"detail":"The related resource does not exist.","source":{"pointer":"/data/relationships/variant"}}]}',
      });

      await expect(
        createCheckout({
          storeId: "store-123",
          variantId: "invalid-variant",
        })
      ).rejects.toThrow("Variant ID invalid-variant not found");
    });
  });

  describe("cancelSubscription", () => {
    it("should cancel a subscription", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: {} }),
      });

      await cancelSubscription("sub-123");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.lemonsqueezy.com/v1/subscriptions/sub-123",
        expect.objectContaining({
          method: "DELETE",
        })
      );
    });
  });

  describe("getCustomerPortalUrl", () => {
    it("should return customer portal URL", async () => {
      const url = await getCustomerPortalUrl("cust-123");

      expect(url).toBe(
        "https://helpmaton.lemonsqueezy.com/my-account/customer/cust-123"
      );
    });
  });
});


