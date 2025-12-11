/**
 * Lemon Squeezy API Client
 * Handles all interactions with Lemon Squeezy API
 */

import crypto from "crypto";

const LEMON_SQUEEZY_API_BASE = "https://api.lemonsqueezy.com/v1";

interface LemonSqueezyResponse<T> {
  data: T;
  meta?: unknown;
}

interface LemonSqueezySubscription {
  id: string;
  type: string;
  attributes: {
    store_id: number;
    customer_id: number;
    order_id: number;
    order_item_id: number;
    product_id: number;
    variant_id: number;
    product_name: string;
    variant_name: string;
    user_name: string;
    user_email: string;
    status: string;
    status_formatted: string;
    card_brand: string | null;
    card_last_four: string | null;
    pause: boolean | null;
    cancelled: boolean;
    trial_ends_at: string | null;
    billing_anchor: number;
    urls: {
      update_payment_method: string;
      customer_portal: string;
    };
    renews_at: string;
    ends_at: string | null;
    created_at: string;
    updated_at: string;
    test_mode: boolean;
  };
}

interface LemonSqueezyCustomer {
  id: string;
  type: string;
  attributes: {
    store_id: number;
    name: string;
    email: string;
    status: string;
    city: string | null;
    region: string | null;
    country: string;
    total_revenue_currency: string;
    mrr: number;
    status_formatted: string;
    created_at: string;
    updated_at: string;
    test_mode: boolean;
  };
}

interface LemonSqueezyOrder {
  id: string;
  type: string;
  attributes: {
    store_id: number;
    identifier: string;
    order_number: number;
    user_name: string;
    user_email: string;
    currency: string;
    currency_rate: string;
    subtotal: number;
    discount_total: number;
    tax: number;
    total: number;
    subtotal_usd: number;
    discount_total_usd: number;
    tax_usd: number;
    total_usd: number;
    status: string;
    status_formatted: string;
    refunded: boolean;
    refunded_at: string | null;
    subtotal_formatted: string;
    discount_total_formatted: string;
    tax_formatted: string;
    total_formatted: string;
    first_order_item: {
      id: number;
      order_id: number;
      product_id: number;
      variant_id: number;
      product_name: string;
      variant_name: string;
      price: number;
      quantity: number;
      created_at: string;
      updated_at: string;
    };
    created_at: string;
    updated_at: string;
  };
}

interface LemonSqueezyVariant {
  id: string;
  type: string;
  attributes: {
    product_id: number;
    name: string;
    description: string;
    price: number;
    is_subscription: boolean;
    interval: string | null;
    interval_count: number | null;
    has_free_trial: boolean;
    trial_interval: string | null;
    trial_interval_count: number | null;
    pay_what_you_want: boolean;
    min_price: number | null;
    max_price: number | null;
    created_at: string;
    updated_at: string;
  };
}

interface CheckoutData {
  storeId: string;
  variantId: string; // Required - even for custom price checkouts
  customPrice?: number;
  productOptions?: {
    name?: string;
    description?: string;
    media?: unknown[];
    redirect_url?: string;
    receipt_button_text?: string;
    receipt_link_url?: string;
    receipt_thank_you_note?: string;
  };
  checkoutOptions?: {
    embed?: boolean;
    media?: boolean;
    logo?: boolean;
    desc?: boolean;
    discount?: boolean;
    dark?: boolean;
    subscription_preview?: boolean;
    button_color?: string;
  };
  checkoutData?: {
    email?: string;
    name?: string;
    custom?: Record<string, unknown>;
  };
  expiresAt?: string;
  preview?: boolean;
  testMode?: boolean;
}

interface CheckoutResponse {
  data: {
    id: string;
    type: string;
    attributes: {
      store_id: number;
      variant_id: number;
      custom_price: number | null;
      product_options: unknown;
      checkout_options: unknown;
      checkout_data: unknown;
      expires_at: string | null;
      created_at: string;
      updated_at: string;
      test_mode: boolean;
      url: string;
    };
  };
}

/**
 * Get Lemon Squeezy API key from environment
 */
function getApiKey(): string {
  const apiKey = process.env.LEMON_SQUEEZY_API_KEY;
  if (!apiKey) {
    throw new Error("LEMON_SQUEEZY_API_KEY environment variable is required");
  }
  return apiKey;
}

/**
 * Make authenticated request to Lemon Squeezy API
 */
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const apiKey = getApiKey();
  const url = `${LEMON_SQUEEZY_API_BASE}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Lemon Squeezy API error: ${response.status} ${response.statusText} - ${errorText}`
    );
  }

  return response.json();
}

/**
 * Verify webhook signature
 * Lemon Squeezy uses HMAC SHA256 with the webhook secret
 * The signature is sent in the X-Signature header as a hex string
 */
export function verifyWebhookSignature(
  body: string,
  signature: string
): boolean {
  const webhookSecret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error(
      "LEMON_SQUEEZY_WEBHOOK_SECRET environment variable is required"
    );
  }

  // Lemon Squeezy uses HMAC SHA256 for webhook signatures
  const hmac = crypto.createHmac("sha256", webhookSecret);
  hmac.update(body);
  const expectedSignature = hmac.digest("hex");

  // Compare signatures using constant-time comparison
  if (expectedSignature.length !== signature.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, "hex"),
      Buffer.from(signature, "hex")
    );
  } catch {
    // If signature is not valid hex, return false
    return false;
  }
}

/**
 * Get subscription details
 */
export async function getSubscription(
  subscriptionId: string
): Promise<LemonSqueezySubscription> {
  const response = await apiRequest<
    LemonSqueezyResponse<LemonSqueezySubscription>
  >(`/subscriptions/${subscriptionId}`);
  return response.data;
}

/**
 * Get customer details
 */
export async function getCustomer(
  customerId: string
): Promise<LemonSqueezyCustomer> {
  const response = await apiRequest<LemonSqueezyResponse<LemonSqueezyCustomer>>(
    `/customers/${customerId}`
  );
  return response.data;
}

/**
 * Get order details
 */
export async function getOrder(orderId: string): Promise<LemonSqueezyOrder> {
  const response = await apiRequest<LemonSqueezyResponse<LemonSqueezyOrder>>(
    `/orders/${orderId}`
  );
  return response.data;
}

/**
 * Get variant details
 */
export async function getVariant(
  variantId: string
): Promise<LemonSqueezyVariant> {
  const response = await apiRequest<LemonSqueezyResponse<LemonSqueezyVariant>>(
    `/variants/${variantId}`
  );
  return response.data;
}

/**
 * Create checkout session
 * Uses JSON:API format with relationships for store and variant
 */
export async function createCheckout(
  data: CheckoutData
): Promise<{ url: string }> {
  // Build attributes object (excluding store/variant IDs which go in relationships)
  const attributes: Record<string, unknown> = {};

  if (data.customPrice !== undefined) {
    attributes.custom_price = data.customPrice;
  }
  if (data.productOptions) {
    attributes.product_options = data.productOptions;
  }
  if (data.checkoutOptions) {
    attributes.checkout_options = data.checkoutOptions;
  }
  if (data.checkoutData) {
    attributes.checkout_data = data.checkoutData;
  }
  if (data.expiresAt) {
    attributes.expires_at = data.expiresAt;
  }
  if (data.preview !== undefined) {
    attributes.preview = data.preview;
  }

  // Build relationships object
  const relationships: Record<string, { data: { type: string; id: string } }> =
    {};

  // Store is required
  relationships.store = {
    data: {
      type: "stores",
      id: data.storeId,
    },
  };

  // Variant is required for all checkouts (even with custom prices)
  if (data.variantId) {
    relationships.variant = {
      data: {
        type: "variants",
        id: data.variantId,
      },
    };
  } else {
    throw new Error("variantId is required for checkout creation");
  }

  const requestBody: {
    data: {
      type: string;
      attributes: Record<string, unknown>;
      relationships: Record<string, { data: { type: string; id: string } }>;
    };
  } = {
    data: {
      type: "checkouts",
      attributes,
      relationships,
    },
  };

  const response = await apiRequest<CheckoutResponse>("/checkouts", {
    method: "POST",
    body: JSON.stringify(requestBody),
  });

  return { url: response.data.attributes.url };
}

/**
 * Cancel subscription
 */
export async function cancelSubscription(
  subscriptionId: string
): Promise<void> {
  await apiRequest(`/subscriptions/${subscriptionId}`, {
    method: "DELETE",
  });
}

/**
 * Get customer portal URL
 * Note: Lemon Squeezy customer portal URL is typically available in subscription attributes
 * For now, we construct it based on customer ID
 */
export async function getCustomerPortalUrl(
  customerId: string
): Promise<string> {
  // Lemon Squeezy customer portal URL format
  // This might need adjustment based on actual Lemon Squeezy implementation
  return `https://app.lemonsqueezy.com/my-account/customer/${customerId}`;
}

// Export types for use in other files
export type {
  LemonSqueezySubscription,
  LemonSqueezyCustomer,
  LemonSqueezyOrder,
  LemonSqueezyVariant,
  CheckoutData,
};
