import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockDatabase,
  mockQueuesPublish,
  mockGetNextRunAtEpochSeconds,
} = vi.hoisted(() => ({
  mockDatabase: vi.fn(),
  mockQueuesPublish: vi.fn(),
  mockGetNextRunAtEpochSeconds: vi.fn(),
}));

vi.mock("@architect/functions", () => ({
  queues: {
    publish: mockQueuesPublish,
  },
}));

vi.mock("../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../utils/cron", () => ({
  getNextRunAtEpochSeconds: mockGetNextRunAtEpochSeconds,
}));

vi.mock("../../utils/handlingErrors", () => ({
  handlingScheduledErrors: (handler: (event: unknown) => Promise<void>) =>
    handler,
}));

vi.mock("../../utils/sentry", () => ({
  Sentry: {
    captureException: vi.fn(),
  },
  ensureError: (error: unknown) => error as Error,
}));

import { handler } from "../index";

describe("run-agent-schedules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enqueues due schedules and updates nextRunAt", async () => {
    const schedule = {
      pk: "agent-schedules/workspace-1/agent-1/schedule-1",
      sk: "schedule",
      scheduleId: "schedule-1",
      workspaceId: "workspace-1",
      agentId: "agent-1",
      cronExpression: "0 0 * * *",
      prompt: "Run daily summary",
      enabled: true,
      duePartition: "due",
      nextRunAt: 1710000000,
    };

    const mockQuery = vi.fn().mockResolvedValue({ items: [schedule] });
    const mockUpdate = vi.fn().mockResolvedValue(schedule);
    mockDatabase.mockResolvedValue({
      "agent-schedule": {
        query: mockQuery,
        update: mockUpdate,
      },
    });

    mockGetNextRunAtEpochSeconds.mockReturnValue(1712345678);

    await handler({} as never);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        IndexName: "byNextRunAt",
      })
    );
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        pk: schedule.pk,
        scheduleId: "schedule-1",
        nextRunAt: 1712345678,
      })
    );
    expect(mockQueuesPublish).toHaveBeenCalledWith({
      name: "agent-schedule-queue",
      payload: {
        scheduleId: "schedule-1",
        workspaceId: "workspace-1",
        agentId: "agent-1",
        enqueuedAt: expect.any(String),
      },
    });
  });
});
