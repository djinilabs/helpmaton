import { beforeEach, describe, expect, it, vi } from "vitest";

import { executeWithRequestLimits } from "../nonStreamingRequestLimits";
// eslint-disable-next-line import/order
import {
  trackSuccessfulRequest,
  validateSubscriptionAndLimits,
} from "../generationRequestTracking";

vi.mock("../generationRequestTracking", () => ({
  validateSubscriptionAndLimits: vi.fn(),
  trackSuccessfulRequest: vi.fn(),
}));

describe("executeWithRequestLimits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validates limits and tracks successful execution by default", async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true });
    vi.mocked(validateSubscriptionAndLimits).mockResolvedValue("sub-123");

    const result = await executeWithRequestLimits({
      workspaceId: "workspace-1",
      agentId: "agent-1",
      endpoint: "webhook",
      execute,
    });

    expect(result).toEqual({ ok: true });
    expect(validateSubscriptionAndLimits).toHaveBeenCalledWith(
      "workspace-1",
      "webhook"
    );
    expect(trackSuccessfulRequest).toHaveBeenCalledWith(
      "sub-123",
      "workspace-1",
      "agent-1",
      "webhook"
    );
  });

  it("skips tracking when shouldTrack returns false", async () => {
    const execute = vi.fn().mockResolvedValue({ shouldTrack: false });
    vi.mocked(validateSubscriptionAndLimits).mockResolvedValue("sub-456");

    await executeWithRequestLimits({
      workspaceId: "workspace-2",
      agentId: "agent-2",
      endpoint: "test",
      execute,
      shouldTrack: (value) =>
        (value as { shouldTrack: boolean }).shouldTrack,
    });

    expect(validateSubscriptionAndLimits).toHaveBeenCalledWith(
      "workspace-2",
      "test"
    );
    expect(trackSuccessfulRequest).not.toHaveBeenCalled();
  });
});
