import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetNextRunAtEpochSeconds } = vi.hoisted(() => ({
  mockGetNextRunAtEpochSeconds: vi.fn(),
}));

vi.mock("../cron", () => ({
  getNextRunAtEpochSeconds: mockGetNextRunAtEpochSeconds,
}));

import {
  DUE_PARTITION,
  DISABLED_PARTITION,
  buildAgentSchedulePk,
  buildScheduleRecordForCreate,
  buildScheduleUpdatePayload,
  type ExistingScheduleForUpdate,
} from "../agentSchedule";

describe("agentSchedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetNextRunAtEpochSeconds.mockReturnValue(1712345678);
  });

  describe("buildAgentSchedulePk", () => {
    it("returns pk in agent-schedules/{workspaceId}/{agentId}/{scheduleId} format", () => {
      expect(
        buildAgentSchedulePk("ws-1", "agent-2", "schedule-3")
      ).toBe("agent-schedules/ws-1/agent-2/schedule-3");
    });
  });

  describe("buildScheduleRecordForCreate", () => {
    it("builds full record with defaults (enabled true)", () => {
      const record = buildScheduleRecordForCreate(
        "ws-1",
        "agent-2",
        "schedule-3",
        {
          name: "Daily run",
          cronExpression: "0 12 * * *",
          prompt: "Summarize",
        }
      );

      expect(record.pk).toBe("agent-schedules/ws-1/agent-2/schedule-3");
      expect(record.sk).toBe("schedule");
      expect(record.workspaceId).toBe("ws-1");
      expect(record.agentId).toBe("agent-2");
      expect(record.scheduleId).toBe("schedule-3");
      expect(record.name).toBe("Daily run");
      expect(record.cronExpression).toBe("0 12 * * *");
      expect(record.prompt).toBe("Summarize");
      expect(record.enabled).toBe(true);
      expect(record.duePartition).toBe(DUE_PARTITION);
      expect(record.nextRunAt).toBe(1712345678);
      expect(record.version).toBe(1);
      expect(record.createdAt).toBeDefined();
      expect(mockGetNextRunAtEpochSeconds).toHaveBeenCalledWith(
        "0 12 * * *",
        expect.any(Date)
      );
    });

    it("uses enabled false and DISABLED_PARTITION when enabled: false", () => {
      const record = buildScheduleRecordForCreate(
        "ws-1",
        "agent-2",
        "schedule-3",
        {
          name: "Paused",
          cronExpression: "0 12 * * *",
          prompt: "Hi",
          enabled: false,
        }
      );

      expect(record.enabled).toBe(false);
      expect(record.duePartition).toBe(DISABLED_PARTITION);
    });
  });

  describe("buildScheduleUpdatePayload", () => {
    const existing: ExistingScheduleForUpdate = {
      pk: "agent-schedules/ws-1/agent-2/sched-1",
      sk: "schedule",
      workspaceId: "ws-1",
      agentId: "agent-2",
      scheduleId: "sched-1",
      name: "Old name",
      cronExpression: "0 12 * * *",
      prompt: "Old prompt",
      enabled: true,
      duePartition: DUE_PARTITION,
      nextRunAt: 1712300000,
    };

    it("merges partial name update and sets updatedAt", () => {
      const payload = buildScheduleUpdatePayload(existing, { name: "New name" });

      expect(payload.name).toBe("New name");
      expect(payload.prompt).toBe("Old prompt");
      expect(payload.updatedAt).toBeDefined();
      expect(mockGetNextRunAtEpochSeconds).not.toHaveBeenCalled();
    });

    it("updates enabled and duePartition and recomputes nextRunAt when enabling", () => {
      const disabled = { ...existing, enabled: false, duePartition: DISABLED_PARTITION };
      const payload = buildScheduleUpdatePayload(disabled, { enabled: true });

      expect(payload.enabled).toBe(true);
      expect(payload.duePartition).toBe(DUE_PARTITION);
      expect(payload.nextRunAt).toBe(1712345678);
      expect(mockGetNextRunAtEpochSeconds).toHaveBeenCalledWith(
        "0 12 * * *",
        expect.any(Date)
      );
    });

    it("recomputes nextRunAt when cronExpression changes", () => {
      const payload = buildScheduleUpdatePayload(existing, {
        cronExpression: "0 8 * * *",
      });

      expect(payload.cronExpression).toBe("0 8 * * *");
      expect(payload.nextRunAt).toBe(1712345678);
      expect(mockGetNextRunAtEpochSeconds).toHaveBeenCalledWith(
        "0 8 * * *",
        expect.any(Date)
      );
    });

    it("disables and sets DISABLED_PARTITION when enabled: false", () => {
      const payload = buildScheduleUpdatePayload(existing, { enabled: false });

      expect(payload.enabled).toBe(false);
      expect(payload.duePartition).toBe(DISABLED_PARTITION);
      expect(mockGetNextRunAtEpochSeconds).not.toHaveBeenCalled();
    });
  });
});
