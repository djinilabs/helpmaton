import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";
import { registerGetWorkspaceIntegrations } from "../get-workspace-integrations";

import { createTestAppWithHandlerCapture } from "./route-test-helpers";

// Mock dependencies
const { mockDatabase } = vi.hoisted(() => ({
  mockDatabase: vi.fn(),
}));

vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("@architect/functions", () => ({
  tables: vi.fn().mockResolvedValue({
    reflect: vi.fn().mockResolvedValue({}),
    _client: {},
  }),
}));

type MockResponseWithBody = Partial<express.Response> & {
  body: { integrations: unknown[]; nextCursor?: string };
  statusCode: number;
};

describe("GET /api/workspaces/:workspaceId/integrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: MockResponseWithBody
  ) {
    const { app, getHandler } = createTestAppWithHandlerCapture();
    registerGetWorkspaceIntegrations(app);
    const handler = getHandler("/api/workspaces/:workspaceId/integrations");
    if (!handler) {
      throw new Error("Handler not found");
    }
    await handler(req as express.Request, res as express.Response, () => {});
  }

  it("should list all integrations for workspace", async () => {
    const mockDb = createMockDatabase();
    const mockIntegrations = [
      {
        pk: "bot-integrations/workspace-123/integration-1",
        sk: "integration",
        workspaceId: "workspace-123",
        agentId: "agent-456",
        platform: "slack",
        name: "Slack Bot",
        webhookUrl: "https://example.com/webhook",
        status: "active",
        createdAt: new Date().toISOString(),
      },
      {
        pk: "bot-integrations/workspace-123/integration-2",
        sk: "integration",
        workspaceId: "workspace-123",
        agentId: "agent-789",
        platform: "discord",
        name: "Discord Bot",
        webhookUrl: "https://example.com/webhook2",
        status: "active",
        lastUsedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
    ];

    mockDb["bot-integration"] = {
      ...mockDb["bot-integration"],
      queryPaginated: vi.fn().mockResolvedValue({
        items: mockIntegrations,
        nextCursor: null,
      }),
    } as (typeof mockDb)["bot-integration"];
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      params: { workspaceId: "workspace-123" },
    });
    const res = createMockResponse() as MockResponseWithBody;

    await callRouteHandler(req, res);

    expect(res.statusCode).toBe(200);
    const body = res.body;
    expect(body).toHaveProperty("integrations");
    expect(Array.isArray(body.integrations)).toBe(true);
    expect(body.integrations).toHaveLength(2);
    expect(body.integrations[0]).toMatchObject({
      id: "integration-1",
      platform: "slack",
      name: "Slack Bot",
      agentId: "agent-456",
      status: "active",
    });
    expect(body.integrations[1]).toMatchObject({
      id: "integration-2",
      platform: "discord",
      name: "Discord Bot",
      agentId: "agent-789",
      status: "active",
    });
  });

  it("should return empty array when no integrations exist", async () => {
    const mockDb = createMockDatabase();
    mockDb["bot-integration"] = {
      ...mockDb["bot-integration"],
      queryPaginated: vi.fn().mockResolvedValue({
        items: [],
        nextCursor: null,
      }),
    } as (typeof mockDb)["bot-integration"];
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      params: { workspaceId: "workspace-123" },
    });
    const res = createMockResponse() as MockResponseWithBody;

    await callRouteHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("integrations");
    expect(res.body.integrations).toEqual([]);
  });
});

