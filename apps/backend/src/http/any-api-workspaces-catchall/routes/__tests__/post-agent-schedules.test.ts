/* eslint-disable import/order */
import express from "express";
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

vi.mock("../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../utils/cron", () => ({
  getNextRunAtEpochSeconds: mockGetNextRunAtEpochSeconds,
}));

import { registerPostAgentSchedules } from "../post-agent-schedules";

function getRouteHandler(app: express.Application, path: string) {
  const stack = (
    app as unknown as { _router: { stack: Array<Record<string, unknown>> } }
  )._router.stack;
  const layer = stack.find((layerItem) => {
    const route = (layerItem as {
      route?: { path?: string; methods?: Record<string, boolean> };
    }).route;
    return route?.path === path && route.methods?.post;
  }) as { route?: { stack?: Array<{ handle?: unknown }> } } | undefined;
  if (!layer || !layer.route) {
    throw new Error(`Route ${path} not found`);
  }
  const handlers = layer.route.stack || [];
  return handlers[handlers.length - 1]?.handle as express.RequestHandler;
}

describe("POST /api/workspaces/:workspaceId/agents/:agentId/schedules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a schedule and returns its details", async () => {
    const app = express();
    registerPostAgentSchedules(app);
    const handler = getRouteHandler(
      app,
      "/api/workspaces/:workspaceId/agents/:agentId/schedules"
    );

    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const scheduleId = "schedule-789";
    const nextRunAt = 1712345678;
    const createdAt = "2026-01-18T00:00:00Z";

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
      createdAt,
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

    await handler(req as express.Request, res as express.Response, next);

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
      createdAt,
    });
  });
});
