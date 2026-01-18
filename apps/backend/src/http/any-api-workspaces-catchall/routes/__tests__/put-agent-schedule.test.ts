/* eslint-disable import/order */
import type { Application, RequestHandler } from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

const {
  mockDatabase,
  mockGetNextRunAtEpochSeconds,
  mockTrackBusinessEvent,
} = vi.hoisted(() => ({
  mockDatabase: vi.fn(),
  mockGetNextRunAtEpochSeconds: vi.fn(),
  mockTrackBusinessEvent: vi.fn(),
}));

vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/cron", () => ({
  getNextRunAtEpochSeconds: mockGetNextRunAtEpochSeconds,
  isValidCronExpression: vi.fn().mockReturnValue(true),
}));

vi.mock("../../../../utils/tracking", () => ({
  trackBusinessEvent: mockTrackBusinessEvent,
}));

import { registerPutAgentSchedule } from "../put-agent-schedule";

function capturePutHandler(register: (app: Application) => void) {
  let captured: RequestHandler | undefined;
  const app = {
    put: (...args: unknown[]) => {
      const handlers = args.slice(1) as RequestHandler[];
      captured = handlers[handlers.length - 1];
    },
  } as unknown as Application;
  register(app);
  if (!captured) {
    throw new Error("Put handler not registered");
  }
  return captured;
}

describe("PUT /api/workspaces/:workspaceId/agents/:agentId/schedules/:scheduleId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates cron and re-enables the schedule", async () => {
    const handler = capturePutHandler(registerPutAgentSchedule);

    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const scheduleId = "schedule-789";
    const nextRunAt = 1712349999;
    const schedulePk = `agent-schedules/${workspaceId}/${agentId}/${scheduleId}`;

    mockGetNextRunAtEpochSeconds.mockReturnValue(nextRunAt);

    const existingSchedule = {
      pk: schedulePk,
      sk: "schedule",
      workspaceId,
      agentId,
      scheduleId,
      name: "Old name",
      cronExpression: "0 0 * * *",
      prompt: "Old prompt",
      enabled: false,
      duePartition: "disabled",
      nextRunAt: 1710000000,
      createdAt: "2026-01-01T00:00:00Z",
    };

    const updatedSchedule = {
      ...existingSchedule,
      name: "New name",
      cronExpression: "0 12 * * *",
      enabled: true,
      duePartition: "due",
      nextRunAt,
      updatedAt: "2026-01-02T00:00:00Z",
    };
    const mockGet = vi
      .fn()
      .mockResolvedValueOnce(existingSchedule)
      .mockResolvedValueOnce(updatedSchedule);
    const mockUpdate = vi.fn().mockResolvedValue(existingSchedule);
    (mockDb as Record<string, unknown>)["agent-schedule"] = {
      get: mockGet,
      update: mockUpdate,
    };

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: "users/user-123",
      params: {
        workspaceId,
        agentId,
        scheduleId,
      },
      body: {
        name: "New name",
        cronExpression: "0 12 * * *",
        enabled: true,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await handler(req as never, res as never, next);

    expect(mockTrackBusinessEvent).toHaveBeenCalledWith(
      "agent_schedule",
      "updated",
      expect.objectContaining({
        workspace_id: workspaceId,
        agent_id: agentId,
        schedule_id: scheduleId,
        enabled: true,
        name_updated: true,
        prompt_updated: false,
        cron_expression_updated: true,
        enabled_updated: true,
      }),
      req
    );
    expect(mockGet).toHaveBeenCalledWith(schedulePk, "schedule");
    expect(mockGetNextRunAtEpochSeconds).toHaveBeenCalledWith(
      "0 12 * * *",
      expect.any(Date)
    );
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        cronExpression: "0 12 * * *",
        name: "New name",
        enabled: true,
        duePartition: "due",
        nextRunAt,
      })
    );
  });
});
