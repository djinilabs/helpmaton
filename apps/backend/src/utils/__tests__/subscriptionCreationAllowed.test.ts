import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDatabase, mockGetPlanLimits } = vi.hoisted(() => ({
  mockDatabase: vi.fn(),
  mockGetPlanLimits: vi.fn(),
}));

vi.mock("../../tables/database", () => ({
  database: mockDatabase,
}));

vi.mock("../subscriptionPlans", () => ({
  getPlanLimits: mockGetPlanLimits,
}));

import {
  ensureAgentScheduleCreationAllowed,
  ensureAgentEvalJudgeCreationAllowed,
} from "../subscriptionUtils";

describe("ensureAgentScheduleCreationAllowed", () => {
  const workspaceId = "ws-1";
  const userId = "user-1";
  const agentId = "agent-1";

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlanLimits.mockReturnValue({ maxAgentSchedulesPerAgent: 5 });

    const mockWorkspaceGet = vi.fn().mockResolvedValue({
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      subscriptionId: "sub-123",
    });
    const mockSubscriptionGet = vi.fn().mockResolvedValue({
      pk: "subscriptions/sub-123",
      plan: "free",
    });
    async function* scheduleItems() {
      yield { workspaceId };
    }
    const mockScheduleQueryAsync = vi.fn().mockReturnValue(scheduleItems());

    mockDatabase.mockResolvedValue({
      workspace: { get: mockWorkspaceGet },
      subscription: { get: mockSubscriptionGet },
      "agent-schedule": { queryAsync: mockScheduleQueryAsync },
    });
  });

  it("resolves when workspace has subscription and schedule count is under limit", async () => {
    await expect(
      ensureAgentScheduleCreationAllowed(workspaceId, userId, agentId)
    ).resolves.toBeUndefined();
  });

  it("throws when getPlanLimits returns null (invalid plan)", async () => {
    mockGetPlanLimits.mockReturnValue(null);

    await expect(
      ensureAgentScheduleCreationAllowed(workspaceId, userId, agentId)
    ).rejects.toMatchObject({
      message: "Invalid subscription plan: free",
      output: { statusCode: 400 },
    });
  });

  it("throws when schedule count is at limit", async () => {
    mockGetPlanLimits.mockReturnValue({ maxAgentSchedulesPerAgent: 1 });
    async function* fiveItems() {
      yield { workspaceId };
      yield { workspaceId };
    }
    mockDatabase.mockResolvedValue({
      workspace: { get: vi.fn().mockResolvedValue({ pk: "w", subscriptionId: "sub-123" }) },
      subscription: { get: vi.fn().mockResolvedValue({ pk: "s", plan: "free" }) },
      "agent-schedule": { queryAsync: vi.fn().mockReturnValue(fiveItems()) },
    });

    await expect(
      ensureAgentScheduleCreationAllowed(workspaceId, userId, agentId)
    ).rejects.toMatchObject({
      message: expect.stringContaining("Agent schedule limit exceeded"),
      output: { statusCode: 400 },
    });
  });
});

describe("ensureAgentEvalJudgeCreationAllowed", () => {
  const workspaceId = "ws-1";
  const userId = "user-1";
  const agentId = "agent-1";

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlanLimits.mockReturnValue({ maxEvalJudgesPerAgent: 5 });

    const mockWorkspaceGet = vi.fn().mockResolvedValue({
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      subscriptionId: "sub-123",
    });
    const mockSubscriptionGet = vi.fn().mockResolvedValue({
      pk: "subscriptions/sub-123",
      plan: "free",
    });
    async function* judgeItems() {
      yield { workspaceId };
    }
    const mockJudgeQueryAsync = vi.fn().mockReturnValue(judgeItems());

    mockDatabase.mockResolvedValue({
      workspace: { get: mockWorkspaceGet },
      subscription: { get: mockSubscriptionGet },
      "agent-eval-judge": { queryAsync: mockJudgeQueryAsync },
    });
  });

  it("resolves when workspace has subscription and eval judge count is under limit", async () => {
    await expect(
      ensureAgentEvalJudgeCreationAllowed(workspaceId, userId, agentId)
    ).resolves.toBeUndefined();
  });

  it("throws when getPlanLimits returns null (invalid plan)", async () => {
    mockGetPlanLimits.mockReturnValue(null);

    await expect(
      ensureAgentEvalJudgeCreationAllowed(workspaceId, userId, agentId)
    ).rejects.toMatchObject({
      message: "Invalid subscription plan: free",
      output: { statusCode: 400 },
    });
  });

  it("throws when eval judge count is at limit", async () => {
    mockGetPlanLimits.mockReturnValue({ maxEvalJudgesPerAgent: 1 });
    async function* twoItems() {
      yield { workspaceId };
      yield { workspaceId };
    }
    mockDatabase.mockResolvedValue({
      workspace: { get: vi.fn().mockResolvedValue({ pk: "w", subscriptionId: "sub-123" }) },
      subscription: { get: vi.fn().mockResolvedValue({ pk: "s", plan: "free" }) },
      "agent-eval-judge": { queryAsync: vi.fn().mockReturnValue(twoItems()) },
    });

    await expect(
      ensureAgentEvalJudgeCreationAllowed(workspaceId, userId, agentId)
    ).rejects.toMatchObject({
      message: expect.stringContaining("Eval judge limit exceeded"),
      output: { statusCode: 400 },
    });
  });
});
