/* eslint-disable import/order */
import type { Application, RequestHandler } from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

const { mockDatabase, mockTrackBusinessEvent } = vi.hoisted(() => ({
  mockDatabase: vi.fn(),
  mockTrackBusinessEvent: vi.fn(),
}));

vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/tracking", () => ({
  trackBusinessEvent: mockTrackBusinessEvent,
}));

import { registerDeleteAgentSchedule } from "../delete-agent-schedule";

function captureDeleteHandler(register: (app: Application) => void) {
  let captured: RequestHandler | undefined;
  const app = {
    delete: (...args: unknown[]) => {
      const handlers = args.slice(1) as RequestHandler[];
      captured = handlers[handlers.length - 1];
    },
  } as unknown as Application;
  register(app);
  if (!captured) {
    throw new Error("Delete handler not registered");
  }
  return captured;
}

describe("DELETE /api/workspaces/:workspaceId/agents/:agentId/schedules/:scheduleId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes a schedule and tracks the event", async () => {
    const handler = captureDeleteHandler(registerDeleteAgentSchedule);

    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const scheduleId = "schedule-789";
    const schedulePk = `agent-schedules/${workspaceId}/${agentId}/${scheduleId}`;

    const existingSchedule = {
      pk: schedulePk,
      sk: "schedule",
      workspaceId,
      agentId,
      scheduleId,
    };

    const mockGet = vi.fn().mockResolvedValue(existingSchedule);
    const mockDelete = vi.fn().mockResolvedValue(undefined);
    (mockDb as Record<string, unknown>)["agent-schedule"] = {
      get: mockGet,
      delete: mockDelete,
    };

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: "users/user-123",
      params: {
        workspaceId,
        agentId,
        scheduleId,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await handler(req as never, res as never, next);

    expect(mockDelete).toHaveBeenCalledWith(schedulePk, "schedule");
    expect(mockTrackBusinessEvent).toHaveBeenCalledWith(
      "agent_schedule",
      "deleted",
      {
        workspace_id: workspaceId,
        agent_id: agentId,
        schedule_id: scheduleId,
      },
      req
    );
    expect(res.status).toHaveBeenCalledWith(204);
  });
});
