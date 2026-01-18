/* eslint-disable import/order */
import type { Application, RequestHandler } from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

const { mockRandomUUID, mockDatabase, mockGetNextRunAtEpochSeconds } =
  vi.hoisted(() => ({
    mockRandomUUID: vi.fn(),
    mockDatabase: vi.fn(),
    mockGetNextRunAtEpochSeconds: vi.fn(),
  }));

vi.mock("crypto", () => ({
  randomUUID: mockRandomUUID,
}));

vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/cron", () => ({
  getNextRunAtEpochSeconds: mockGetNextRunAtEpochSeconds,
  isValidCronExpression: vi.fn().mockReturnValue(true),
}));

import { registerPostAgentSchedules } from "../post-agent-schedules";

function capturePostHandler(register: (app: Application) => void) {
  let captured: RequestHandler | undefined;
  const app = {
    post: (...args: unknown[]) => {
      const handlers = args.slice(1) as RequestHandler[];
      captured = handlers[handlers.length - 1];
    },
  } as unknown as Application;
  register(app);
  if (!captured) {
    throw new Error("Post handler not registered");
  }
  return captured;
}

describe("POST /api/workspaces/:workspaceId/agents/:agentId/schedules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a schedule and returns its details", async () => {
    const handler = capturePostHandler(registerPostAgentSchedules);

    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const scheduleId = "schedule-789";
    const nextRunAt = 1712345678;
    mockRandomUUID.mockReturnValue(scheduleId);
    mockGetNextRunAtEpochSeconds.mockReturnValue(nextRunAt);

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      workspaceId,
      agentId,
      name: "Agent",
    };
    mockDb.agent.get = vi.fn().mockResolvedValue(mockAgent);

    const mockCreate = vi.fn().mockResolvedValue({
      pk: `agent-schedules/${workspaceId}/${agentId}/${scheduleId}`,
      sk: "schedule",
      workspaceId,
      agentId,
      scheduleId,
      name: "Daily run",
      cronExpression: "0 0 * * *",
      prompt: "Run daily report",
      enabled: true,
      duePartition: "due",
      nextRunAt,
      createdAt: new Date().toISOString(),
    });
    (mockDb as Record<string, unknown>)["agent-schedule"] = {
      create: mockCreate,
    };

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: "users/user-123",
      params: {
        workspaceId,
        agentId,
      },
      body: {
        name: "Daily run",
        cronExpression: "0 0 * * *",
        prompt: "Run daily report",
        enabled: true,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await handler(req as never, res as never, next);

    expect(mockGetNextRunAtEpochSeconds).toHaveBeenCalledWith(
      "0 0 * * *",
      expect.any(Date)
    );
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        pk: `agent-schedules/${workspaceId}/${agentId}/${scheduleId}`,
        sk: "schedule",
        workspaceId,
        agentId,
        scheduleId,
        name: "Daily run",
        cronExpression: "0 0 * * *",
        prompt: "Run daily report",
        enabled: true,
        duePartition: "due",
        nextRunAt,
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect((res as { body: unknown }).body).toEqual({
      id: scheduleId,
      name: "Daily run",
      cronExpression: "0 0 * * *",
      prompt: "Run daily report",
      enabled: true,
      nextRunAt,
      lastRunAt: null,
      createdAt: expect.any(String),
    });
  });
});
