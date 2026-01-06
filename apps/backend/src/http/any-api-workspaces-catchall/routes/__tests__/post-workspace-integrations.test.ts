import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// eslint-disable-next-line import/order
import {
  createMockDatabase,
  createMockRequest,
  createMockResponse,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted
const { mockDatabase } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
  };
});

// Mock the database module
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

// Mock @architect/functions for database initialization
vi.mock("@architect/functions", () => ({
  tables: vi.fn().mockResolvedValue({
    reflect: vi.fn().mockResolvedValue({}),
    _client: {},
  }),
}));

// Import after mocks
 
import { registerPostWorkspaceIntegrations } from "../post-workspace-integrations";
 
import { createTestAppWithHandlerCapture } from "./route-test-helpers";

type MockResponse = Partial<express.Response> & {
  body: Record<string, unknown>;
  statusCode: number;
};

describe("POST /api/workspaces/:workspaceId/integrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: MockResponse,
    next?: express.NextFunction
  ) {
    const { app, postHandler } = createTestAppWithHandlerCapture();
    registerPostWorkspaceIntegrations(app);
    const handler = postHandler("/api/workspaces/:workspaceId/integrations");
    if (!handler) {
      throw new Error("Handler not found");
    }
    await handler(
      req as express.Request,
      res as express.Response,
      next || (() => {})
    );
  }

  it("should successfully create Slack integration", async () => {
    const mockDb = createMockDatabase();
    const mockAgent = {
      pk: "agents/workspace-123/agent-456",
      sk: "agent",
      name: "Test Agent",
    };
    const mockIntegration = {
      pk: "bot-integrations/workspace-123/integration-789",
      sk: "integration",
      workspaceId: "workspace-123",
      agentId: "agent-456",
      platform: "slack",
      name: "Test Bot",
      config: {
        botToken: "xoxb-token",
        signingSecret: "secret",
      },
      webhookUrl: "https://api.helpmaton.com/api/webhooks/slack/workspace-123/integration-789",
      status: "active",
      createdAt: new Date().toISOString(),
    };

    mockDb.agent.get = vi.fn().mockResolvedValue(mockAgent);
    mockDb["bot-integration"] = {
      get: vi.fn(),
      put: vi.fn(),
      create: vi.fn().mockResolvedValue(mockIntegration),
      update: vi.fn(),
      delete: vi.fn(),
      query: vi.fn(),
    };
    mockDatabase.mockResolvedValue(mockDb);

    process.env.WEBHOOK_BASE_URL = "https://api.helpmaton.com";

    const req = createMockRequest({
      params: { workspaceId: "workspace-123" },
      body: {
        platform: "slack",
        name: "Test Bot",
        agentId: "agent-456",
        config: {
          botToken: "xoxb-token",
          signingSecret: "secret",
        },
      },
      userRef: "user-123",
    });
    const res = createMockResponse() as MockResponse;

    await callRouteHandler(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({
      id: expect.any(String),
      platform: "slack",
      name: "Test Bot",
      agentId: "agent-456",
      status: "active",
    });
    expect(mockDb["bot-integration"].create).toHaveBeenCalled();
  });

  it("should successfully create Discord integration", async () => {
    const mockDb = createMockDatabase();
    const mockAgent = {
      pk: "agents/workspace-123/agent-456",
      sk: "agent",
      name: "Test Agent",
    };
    const mockIntegration = {
      pk: "bot-integrations/workspace-123/integration-789",
      sk: "integration",
      workspaceId: "workspace-123",
      agentId: "agent-456",
      platform: "discord",
      name: "Test Bot",
      config: {
        botToken: "bot-token",
        publicKey: "a".repeat(64),
      },
      webhookUrl: "https://api.helpmaton.com/api/webhooks/discord/workspace-123/integration-789",
      status: "active",
      createdAt: new Date().toISOString(),
    };

    mockDb.agent.get = vi.fn().mockResolvedValue(mockAgent);
    mockDb["bot-integration"] = {
      get: vi.fn(),
      put: vi.fn(),
      create: vi.fn().mockResolvedValue(mockIntegration),
      update: vi.fn(),
      delete: vi.fn(),
      query: vi.fn(),
    };
    mockDatabase.mockResolvedValue(mockDb);

    process.env.WEBHOOK_BASE_URL = "https://api.helpmaton.com";

    const req = createMockRequest({
      params: { workspaceId: "workspace-123" },
      body: {
        platform: "discord",
        name: "Test Bot",
        agentId: "agent-456",
        config: {
          botToken: "bot-token",
          publicKey: "a".repeat(64),
        },
      },
      userRef: "user-123",
    });
    const res = createMockResponse() as MockResponse;

    await callRouteHandler(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.body.platform).toBe("discord");
  });

  it("should throw badRequest for invalid platform", async () => {
    const req = createMockRequest({
      params: { workspaceId: "workspace-123" },
      body: {
        platform: "invalid",
        name: "Test Bot",
        agentId: "agent-456",
        config: {},
      },
    });
    const res = createMockResponse() as MockResponse;
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

  it("should throw badRequest for missing name", async () => {
    const req = createMockRequest({
      params: { workspaceId: "workspace-123" },
      body: {
        platform: "slack",
        agentId: "agent-456",
        config: {},
      },
    });
    const res = createMockResponse() as MockResponse;
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

  it("should throw badRequest for missing agentId", async () => {
    const req = createMockRequest({
      params: { workspaceId: "workspace-123" },
      body: {
        platform: "slack",
        name: "Test Bot",
        config: {},
      },
    });
    const res = createMockResponse() as MockResponse;
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

  it("should throw badRequest when agent not found", async () => {
    const mockDb = createMockDatabase();
    mockDb.agent.get = vi.fn().mockResolvedValue(null);
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      params: { workspaceId: "workspace-123" },
      body: {
        platform: "slack",
        name: "Test Bot",
        agentId: "agent-456",
        config: {
          botToken: "xoxb-token",
          signingSecret: "secret",
        },
      },
      userRef: "user-123",
    });
    const res = createMockResponse() as MockResponse;
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

  it("should throw badRequest when Slack config missing botToken", async () => {
    const mockDb = createMockDatabase();
    const mockAgent = {
      pk: "agents/workspace-123/agent-456",
      sk: "agent",
    };
    mockDb.agent.get = vi.fn().mockResolvedValue(mockAgent);
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      params: { workspaceId: "workspace-123" },
      body: {
        platform: "slack",
        name: "Test Bot",
        agentId: "agent-456",
        config: {
          signingSecret: "secret",
        },
      },
      userRef: "user-123",
    });
    const res = createMockResponse() as MockResponse;
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

  it("should throw badRequest when Slack config missing signingSecret", async () => {
    const mockDb = createMockDatabase();
    const mockAgent = {
      pk: "agents/workspace-123/agent-456",
      sk: "agent",
    };
    mockDb.agent.get = vi.fn().mockResolvedValue(mockAgent);
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      params: { workspaceId: "workspace-123" },
      body: {
        platform: "slack",
        name: "Test Bot",
        agentId: "agent-456",
        config: {
          botToken: "xoxb-token",
        },
      },
      userRef: "user-123",
    });
    const res = createMockResponse() as MockResponse;
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

  it("should throw badRequest when Discord config missing botToken", async () => {
    const mockDb = createMockDatabase();
    const mockAgent = {
      pk: "agents/workspace-123/agent-456",
      sk: "agent",
    };
    mockDb.agent.get = vi.fn().mockResolvedValue(mockAgent);
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      params: { workspaceId: "workspace-123" },
      body: {
        platform: "discord",
        name: "Test Bot",
        agentId: "agent-456",
        config: {
          publicKey: "a".repeat(64),
        },
      },
      userRef: "user-123",
    });
    const res = createMockResponse() as MockResponse;
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

  it("should throw badRequest when Discord config missing publicKey", async () => {
    const mockDb = createMockDatabase();
    const mockAgent = {
      pk: "agents/workspace-123/agent-456",
      sk: "agent",
    };
    mockDb.agent.get = vi.fn().mockResolvedValue(mockAgent);
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      params: { workspaceId: "workspace-123" },
      body: {
        platform: "discord",
        name: "Test Bot",
        agentId: "agent-456",
        config: {
          botToken: "bot-token",
        },
      },
      userRef: "user-123",
    });
    const res = createMockResponse() as MockResponse;
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

  it("should throw badRequest when Discord publicKey format is invalid", async () => {
    const mockDb = createMockDatabase();
    const mockAgent = {
      pk: "agents/workspace-123/agent-456",
      sk: "agent",
    };
    mockDb.agent.get = vi.fn().mockResolvedValue(mockAgent);
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      params: { workspaceId: "workspace-123" },
      body: {
        platform: "discord",
        name: "Test Bot",
        agentId: "agent-456",
        config: {
          botToken: "bot-token",
          publicKey: "invalid-key", // Not 64 hex chars
        },
      },
      userRef: "user-123",
    });
    const res = createMockResponse() as MockResponse;
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
        platform: "slack",
        name: "Test Bot",
        agentId: "agent-456",
        config: {
          botToken: "xoxb-token",
          signingSecret: "secret",
        },
      },
      // userRef is missing
    });
    const res = createMockResponse() as MockResponse;
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

  it("should generate webhook URL with WEBHOOK_BASE_URL", async () => {
    const mockDb = createMockDatabase();
    const mockAgent = {
      pk: "agents/workspace-123/agent-456",
      sk: "agent",
    };
    mockDb.agent.get = vi.fn().mockResolvedValue(mockAgent);
    mockDb["bot-integration"] = {
      get: vi.fn(),
      put: vi.fn(),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn(),
      delete: vi.fn(),
      query: vi.fn(),
    };
    mockDatabase.mockResolvedValue(mockDb);

    process.env.WEBHOOK_BASE_URL = "https://custom-webhook.example.com";

    const req = createMockRequest({
      params: { workspaceId: "workspace-123" },
      body: {
        platform: "slack",
        name: "Test Bot",
        agentId: "agent-456",
        config: {
          botToken: "xoxb-token",
          signingSecret: "secret",
        },
      },
      userRef: "user-123",
    });
    const res = createMockResponse() as MockResponse;

    await callRouteHandler(req, res);

    expect(mockDb["bot-integration"].create).toHaveBeenCalledWith(
      expect.objectContaining({
        webhookUrl: expect.stringContaining("https://custom-webhook.example.com"),
      })
    );
  });
});

