import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
} from "../../../utils/__tests__/test-helpers";
import { registerPostWorkspaceIntegrationsSlackManifest } from "../post-workspace-integrations-slack-manifest";

import { createTestAppWithHandlerCapture } from "./route-test-helpers";

// Mock dependencies
vi.mock("@architect/functions", () => ({
  tables: vi.fn().mockResolvedValue({
    reflect: vi.fn().mockResolvedValue({}),
    _client: {},
  }),
}));

type MockResponseWithBody = Partial<express.Response> & {
  body: Record<string, unknown>;
  statusCode: number;
};

describe("POST /api/workspaces/:workspaceId/integrations/slack/manifest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: MockResponseWithBody,
    next?: express.NextFunction
  ) {
    const { app, postHandler } = createTestAppWithHandlerCapture();
    registerPostWorkspaceIntegrationsSlackManifest(app);
    const handler = postHandler(
      "/api/workspaces/:workspaceId/integrations/slack/manifest"
    );
    if (!handler) {
      throw new Error("Handler not found");
    }
    await handler(
      req as express.Request,
      res as express.Response,
      next || (() => {})
    );
  }

  it("should successfully generate Slack manifest", async () => {
    process.env.WEBHOOK_BASE_URL = "https://api.helpmaton.com";

    const req = createMockRequest({
      params: { workspaceId: "workspace-123" },
      body: {
        agentId: "agent-456",
        agentName: "Test Agent",
      },
      userRef: "user-123",
    });
    const res = createMockResponse() as MockResponseWithBody;

    await callRouteHandler(req, res);

    expect(res.statusCode).toBe(200);
    const body = res.body;
    expect(body).toHaveProperty("manifest");
    expect(body).toHaveProperty("webhookUrl");
    expect(body).toHaveProperty("instructions");
    expect((body.webhookUrl as string)).toContain("https://api.helpmaton.com");
    expect((body.webhookUrl as string)).toContain("workspace-123");
    expect((body.manifest as { display_information: { name: string } }).display_information.name).toBe("Test Agent");
    expect((body.manifest as { settings: { event_subscriptions: { bot_events: string[] } } }).settings.event_subscriptions.bot_events).toContain("app_mention");
  });

  it("should use default agent name when agentName is not provided", async () => {
    process.env.WEBHOOK_BASE_URL = "https://api.helpmaton.com";

    const req = createMockRequest({
      params: { workspaceId: "workspace-123" },
      body: {
        agentId: "agent-456",
      },
      userRef: "user-123",
    });
    const res = createMockResponse() as MockResponseWithBody;

    await callRouteHandler(req, res);

    const body = res.body;
    expect((body.manifest as { display_information: { name: string } }).display_information.name).toBe("Helpmaton Agent");
  });

  it("should throw badRequest when agentId is missing", async () => {
    const req = createMockRequest({
      params: { workspaceId: "workspace-123" },
      body: {},
      userRef: "user-123",
    });
    const res = createMockResponse() as MockResponseWithBody;
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
        }),
      })
    );
  });

  it("should throw unauthorized when userRef is missing", async () => {
    const req = createMockRequest({
      params: { workspaceId: "workspace-123" },
      body: {
        agentId: "agent-456",
      },
      // userRef is missing
    });
    const res = createMockResponse() as MockResponseWithBody;
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 401,
        }),
      })
    );
  });

  it("should generate webhook URL with BASE_URL when WEBHOOK_BASE_URL is not set", async () => {
    delete process.env.WEBHOOK_BASE_URL;
    process.env.BASE_URL = "https://custom.example.com";

    const req = createMockRequest({
      params: { workspaceId: "workspace-123" },
      body: {
        agentId: "agent-456",
      },
      userRef: "user-123",
    });
    const res = createMockResponse() as MockResponseWithBody;

    await callRouteHandler(req, res);

    const body = res.body;
    expect((body.webhookUrl as string)).toContain("https://custom.example.com");
  });

  it("should include app_mention in bot_events (not app_mentions)", async () => {
    process.env.WEBHOOK_BASE_URL = "https://api.helpmaton.com";

    const req = createMockRequest({
      params: { workspaceId: "workspace-123" },
      body: {
        agentId: "agent-456",
      },
      userRef: "user-123",
    });
    const res = createMockResponse() as MockResponseWithBody;

    await callRouteHandler(req, res);

    const body = res.body;
    const botEvents = (body.manifest as { settings: { event_subscriptions: { bot_events: string[] } } }).settings.event_subscriptions.bot_events;
    expect(botEvents).toContain("app_mention");
    expect(botEvents).not.toContain("app_mentions");
  });
});

