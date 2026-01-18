/* eslint-disable import/order */
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

const { mockDatabase, mockGetNextRunAtEpochSeconds } = vi.hoisted(() => ({
  mockDatabase: vi.fn(),
  mockGetNextRunAtEpochSeconds: vi.fn(),
}));

vi.mock("../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../utils/cron", () => ({
  getNextRunAtEpochSeconds: mockGetNextRunAtEpochSeconds,
}));

import { registerPutAgentSchedule } from "../put-agent-schedule";

function getRouteHandler(app: express.Application, path: string) {
  const stack = (
    app as unknown as { _router: { stack: Array<Record<string, unknown>> } }
  )._router.stack;
  const layer = stack.find((layerItem) => {
    const route = (layerItem as {
      route?: { path?: string; methods?: Record<string, boolean> };
    }).route;
    return route?.path === path && route.methods?.put;
  }) as { route?: { stack?: Array<{ handle?: unknown }> } } | undefined;
  if (!layer || !layer.route) {
    throw new Error(`Route ${path} not found`);
  }
  const handlers = layer.route.stack || [];
  return handlers[handlers.length - 1]?.handle as express.RequestHandler;
}

describe("PUT /api/workspaces/:workspaceId/agents/:agentId/schedules/:scheduleId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates cron and re-enables the schedule", async () => {
    const app = express();
    registerPutAgentSchedule(app);
    const handler = getRouteHandler(
      app,
      "/api/workspaces/:workspaceId/agents/:agentId/schedules/:scheduleId"
    );

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

    const mockGet = vi.fn().mockResolvedValue(existingSchedule);
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

    await handler(req as express.Request, res as express.Response, next);

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
