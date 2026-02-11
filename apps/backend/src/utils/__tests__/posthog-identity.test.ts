import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockIdentify = vi.hoisted(() => vi.fn());
vi.mock("posthog-node", () => ({
  PostHog: class MockPostHog {
    identify = mockIdentify;
  },
}));

import * as posthog from "../posthog";

describe("updatePostHogUserSubscriptionPlan", () => {
  let previousPostHogApiKey: string | undefined;

  beforeEach(() => {
    mockIdentify.mockClear();
    previousPostHogApiKey = process.env.POSTHOG_API_KEY;
    process.env.POSTHOG_API_KEY = "test-key";
    posthog.initPostHog();
  });

  afterEach(() => {
    if (previousPostHogApiKey !== undefined) {
      process.env.POSTHOG_API_KEY = previousPostHogApiKey;
    } else {
      delete process.env.POSTHOG_API_KEY;
    }
  });

  it("calls identify with subscription_plan for starter", () => {
    posthog.updatePostHogUserSubscriptionPlan("user-1", "starter");
    expect(mockIdentify).toHaveBeenCalledTimes(1);
    expect(mockIdentify).toHaveBeenCalledWith({
      distinctId: "user/user-1",
      properties: { subscription_plan: "starter" },
    });
  });

  it("calls identify with subscription_plan for pro", () => {
    posthog.updatePostHogUserSubscriptionPlan("user-2", "pro");
    expect(mockIdentify).toHaveBeenCalledTimes(1);
    expect(mockIdentify).toHaveBeenCalledWith({
      distinctId: "user/user-2",
      properties: { subscription_plan: "pro" },
    });
  });

  it("calls identify with subscription_plan for free", () => {
    posthog.updatePostHogUserSubscriptionPlan("user-3", "free");
    expect(mockIdentify).toHaveBeenCalledTimes(1);
    expect(mockIdentify).toHaveBeenCalledWith({
      distinctId: "user/user-3",
      properties: { subscription_plan: "free" },
    });
  });
});
