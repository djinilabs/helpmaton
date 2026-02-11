import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockTrackEvent = vi.fn();

vi.mock("../utils/authUtils", () => ({
  getDynamoDBAdapter: vi.fn().mockResolvedValue({}),
}));

vi.mock("../utils/subscriptionUtils", () => ({
  getUserSubscription: vi.fn(),
  getUserByEmail: vi.fn(),
  getUserById: vi.fn(),
}));

vi.mock("../utils/apiGatewayUsagePlans", () => ({
  ensureSubscriptionApiKeyActive: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../utils/posthog", () => ({
  identifyUser: vi.fn(),
}));

vi.mock("../utils/sentry", () => ({
  Sentry: { captureException: vi.fn() },
  ensureError: (e: unknown) => e,
  initSentry: vi.fn(),
}));

vi.mock("../utils/tracking", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

import { authConfig } from "../auth-config";
import { getUserSubscription } from "../utils/subscriptionUtils";

describe("auth-config signIn callback", () => {
  const originalAuthSecret = process.env.AUTH_SECRET;

  beforeEach(() => {
    process.env.AUTH_SECRET = "test-secret-for-auth-config-test";
    vi.clearAllMocks();
    vi.mocked(getUserSubscription).mockResolvedValue({
      pk: "subscriptions/sub-1",
      sk: "subscription",
      userId: "user-1",
      plan: "free",
      status: "active",
      createdBy: "users/user-1",
      apiKeyId: "key-1",
    } as never);
  });

  afterEach(() => {
    if (originalAuthSecret !== undefined) {
      process.env.AUTH_SECRET = originalAuthSecret;
    } else {
      delete process.env.AUTH_SECRET;
    }
  });

  it("does not send user_signed_up when email user signs in", async () => {
    const config = await authConfig();
    const signIn = config.callbacks?.signIn;
    expect(signIn).toBeDefined();

    await (signIn as (args: unknown) => Promise<boolean>)({
      user: { id: "user-1", email: "user@example.com" },
      account: { type: "email", provider: "email" },
    });

    expect(mockTrackEvent).not.toHaveBeenCalledWith(
      "user_signed_up",
      expect.anything()
    );
  });
});
