import { WebClient } from "@slack/web-api";
import { Context } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

// eslint-disable-next-line import/order
import {
  createAPIGatewayEventV2,
  createMockDatabase,
} from "../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted
const {
  mockDatabase,
  mockVerifySlackSignature,
  mockPostSlackMessage,
  mockEnqueueBotWebhookTask,
  mockAdaptHttpHandler,
  mockHandlingErrors,
} = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockVerifySlackSignature: vi.fn(),
    mockPostSlackMessage: vi.fn(),
    mockEnqueueBotWebhookTask: vi.fn(),
    mockAdaptHttpHandler: vi.fn((fn) => fn),
    mockHandlingErrors: vi.fn((fn) => fn),
  };
});

// Mock modules
vi.mock("../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../services/slackVerification", () => ({
  verifySlackSignature: mockVerifySlackSignature,
}));

vi.mock("../services/slackResponse", () => ({
  postSlackMessage: mockPostSlackMessage,
}));

vi.mock("../../utils/botWebhookQueue", () => ({
  enqueueBotWebhookTask: mockEnqueueBotWebhookTask,
}));

vi.mock("../../utils/httpEventAdapter", () => ({
  adaptHttpHandler: mockAdaptHttpHandler,
}));

vi.mock("../../utils/handlingErrors", () => ({
  handlingErrors: mockHandlingErrors,
}));

// Mock @architect/functions for database initialization
vi.mock("@architect/functions", () => ({
  tables: vi.fn().mockResolvedValue({
    reflect: vi.fn().mockResolvedValue({}),
    _client: {},
  }),
}));

// Import handler after mocks
import { handler } from "../index";

describe("Slack webhook handler", () => {
  const workspaceId = "workspace-123";
  const integrationId = "integration-456";
  const fullIntegrationId = `${workspaceId}/${integrationId}`;

  // Helper to assert result is an object with statusCode and body
  function assertResult(
    result: unknown
  ): asserts result is { statusCode: number; body: string } {
    expect(typeof result).toBe("object");
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("statusCode");
    expect(result).toHaveProperty("body");
  }

  const mockIntegration = {
    pk: `bot-integrations/${workspaceId}/${integrationId}`,
    sk: "integration",
    workspaceId,
    agentId: "agent-789",
    platform: "slack" as const,
    name: "Test Bot",
    status: "active" as const,
    config: {
      botToken: "xoxb-test-token",
      signingSecret: "test-signing-secret",
    },
    webhookUrl: "https://example.com/webhook",
    createdAt: new Date().toISOString(),
    version: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Set up default mocks
    mockVerifySlackSignature.mockReturnValue(true);
    mockPostSlackMessage.mockResolvedValue({
      ts: "1234567890.123456",
      channel: "C123456",
    });
    mockEnqueueBotWebhookTask.mockResolvedValue(undefined);
    // Note: Each test should set up its own mock database as needed
  });

  function createEvent(overrides?: {
    pathParameters?: Record<string, string>;
    headers?: Record<string, string>;
    body?: string;
  }): Parameters<typeof handler>[0] {
    return createAPIGatewayEventV2({
      pathParameters: {
        integrationId: fullIntegrationId,
        ...overrides?.pathParameters,
      },
      headers: {
        "x-slack-signature": "v0=test",
        "x-slack-request-timestamp": Math.floor(Date.now() / 1000).toString(),
        ...overrides?.headers,
      },
      body: overrides?.body || JSON.stringify({ type: "event_callback" }),
      ...overrides,
    }) as Parameters<typeof handler>[0];
  }

  it("should return 400 when integrationId is missing", async () => {
    const event = createAPIGatewayEventV2({
      pathParameters: {},
    }) as Parameters<typeof handler>[0];

    const result = await handler(event, {} as Parameters<typeof handler>[1], () => {});

    assertResult(result);
    assertResult(result);
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body || "{}");
    expect(body.error).toBe("Missing integrationId");
  });

  it("should return 400 when integrationId format is invalid", async () => {
    const event = createAPIGatewayEventV2({
      pathParameters: {
        integrationId: "invalid-format",
      },
    }) as Parameters<typeof handler>[0];

    const result = await handler(event, {} as Parameters<typeof handler>[1], () => {});

    assertResult(result);
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body || "{}");
    expect(body.error).toBe("Invalid integrationId format");
  });

  it("should return 404 when integration not found", async () => {
    const mockDb = createMockDatabase();
    mockDb["bot-integration"].get = vi.fn().mockResolvedValue(null);
    mockDatabase.mockResolvedValue(mockDb);

    const event = createEvent();
    const result = await handler(event, {} as Parameters<typeof handler>[1], () => {});

    assertResult(result);
    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body || "{}");
    expect(body.error).toBe("Integration not found");
  });

  it("should return 404 when integration platform is not slack", async () => {
    const mockDb = createMockDatabase();
    mockDb["bot-integration"].get = vi.fn().mockResolvedValue({
      ...mockIntegration,
      platform: "discord",
    });
    mockDatabase.mockResolvedValue(mockDb);

    const event = createEvent();
    const result = await handler(event, {} as Parameters<typeof handler>[1], () => {});

    assertResult(result);
    expect(result.statusCode).toBe(404);
  });

  it("should return 400 when integration is not active", async () => {
    const mockDb = createMockDatabase();
    mockDb["bot-integration"].get = vi.fn().mockResolvedValue({
      ...mockIntegration,
      status: "inactive",
    });
    mockDatabase.mockResolvedValue(mockDb);

    const event = createEvent();
    const result = await handler(event, {} as Parameters<typeof handler>[1], () => {});

    assertResult(result);
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body || "{}");
    expect(body.error).toBe("Integration is not active");
  });

  it("should return 401 when signature is invalid", async () => {
    const mockDb = createMockDatabase();
    mockDb["bot-integration"].get = vi.fn().mockResolvedValue(mockIntegration);
    mockDatabase.mockResolvedValue(mockDb);
    mockVerifySlackSignature.mockReturnValue(false);

    const event = createEvent();
    const result = await handler(event, {} as Parameters<typeof handler>[1], () => {});

    assertResult(result);
    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body || "{}");
    expect(body.error).toBe("Invalid signature");
  });

  it("should return 400 when body is invalid JSON", async () => {
    const mockDb = createMockDatabase();
    mockDb["bot-integration"].get = vi.fn().mockResolvedValue(mockIntegration);
    mockDatabase.mockResolvedValue(mockDb);

    const event = createEvent({ body: "invalid json" });
    const result = await handler(event, {} as Parameters<typeof handler>[1], () => {});

    assertResult(result);
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body || "{}");
    expect(body.error).toBe("Invalid JSON");
  });

  it("should handle URL verification challenge", async () => {
    const mockDb = createMockDatabase();
    mockDb["bot-integration"].get = vi.fn().mockResolvedValue(mockIntegration);
    mockDatabase.mockResolvedValue(mockDb);

    const challenge = "test-challenge-string";
    const event = createEvent({
      body: JSON.stringify({
        type: "url_verification",
        challenge,
      }),
    });

    const result = await handler(event, {} as Parameters<typeof handler>[1], () => {});

    assertResult(result);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body || "{}");
    expect(body.challenge).toBe(challenge);
  });

  it("should handle app_mention event", async () => {
    const mockDb = createMockDatabase();
    mockDb["bot-integration"].get = vi.fn().mockResolvedValue(mockIntegration);
    mockDatabase.mockResolvedValue(mockDb);

    const event = createEvent({
      body: JSON.stringify({
        type: "event_callback",
        event: {
          type: "app_mention",
          text: "<@BOT123> Hello bot",
          channel: "C123456",
          user: "U123456",
          ts: "1234567890.123456",
        },
      }),
    });

    const result = await handler(event, {} as Parameters<typeof handler>[1], () => {});

    assertResult(result);
    expect(result.statusCode).toBe(200);
    expect(mockPostSlackMessage).toHaveBeenCalledWith(
      expect.any(WebClient),
      "C123456",
      "Agent is thinking...",
      undefined
    );
    expect(mockEnqueueBotWebhookTask).toHaveBeenCalledWith(
      "slack",
      integrationId,
      workspaceId,
      "agent-789",
      "Hello bot",
      {
        botToken: "xoxb-test-token",
        channel: "C123456",
        messageTs: "1234567890.123456",
        threadTs: undefined,
      },
      "1234567890.123456"
    );
  });

  it("should handle message event", async () => {
    const mockDb = createMockDatabase();
    mockDb["bot-integration"].get = vi.fn().mockResolvedValue(mockIntegration);
    mockDatabase.mockResolvedValue(mockDb);

    const event = createEvent({
      body: JSON.stringify({
        type: "event_callback",
        event: {
          type: "message",
          text: "Hello bot",
          channel: "C123456",
          user: "U123456",
          ts: "1234567890.123456",
        },
      }),
    });

    const result = await handler(event, {} as Parameters<typeof handler>[1], () => {});

    assertResult(result);
    expect(result.statusCode).toBe(200);
    expect(mockEnqueueBotWebhookTask).toHaveBeenCalled();
  });

  it("should handle thread_ts in app_mention event", async () => {
    const mockDb = createMockDatabase();
    mockDb["bot-integration"].get = vi.fn().mockResolvedValue(mockIntegration);
    mockDatabase.mockResolvedValue(mockDb);

    const threadTs = "1234567890.123455";
    const event = createEvent({
      body: JSON.stringify({
        type: "event_callback",
        event: {
          type: "app_mention",
          text: "Hello bot",
          channel: "C123456",
          user: "U123456",
          ts: "1234567890.123456",
          thread_ts: threadTs,
        },
      }),
    });

    const result = await handler(event, {} as Parameters<typeof handler>[1], () => {});

    assertResult(result);
    expect(result.statusCode).toBe(200);
    expect(mockPostSlackMessage).toHaveBeenCalledWith(
      expect.any(WebClient),
      "C123456",
      "Agent is thinking...",
      threadTs
    );
    expect(mockEnqueueBotWebhookTask).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        threadTs,
      }),
      threadTs
    );
  });

  it("should remove bot mentions from message text", async () => {
    const mockDb = createMockDatabase();
    mockDb["bot-integration"].get = vi.fn().mockResolvedValue(mockIntegration);
    mockDatabase.mockResolvedValue(mockDb);

    const event = createEvent({
      body: JSON.stringify({
        type: "event_callback",
        event: {
          type: "app_mention",
          text: "<@BOT123> Hello <@BOT123> world",
          channel: "C123456",
          user: "U123456",
          ts: "1234567890.123456",
        },
      }),
    });

    await handler(event, {} as Context, () => {});

    expect(mockEnqueueBotWebhookTask).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      "Hello world",
      expect.any(Object),
      expect.any(String)
    );
  });

  it("should return 200 when message text is empty after removing mentions", async () => {
    const mockDb = createMockDatabase();
    mockDb["bot-integration"].get = vi.fn().mockResolvedValue(mockIntegration);
    mockDatabase.mockResolvedValue(mockDb);

    const event = createEvent({
      body: JSON.stringify({
        type: "event_callback",
        event: {
          type: "app_mention",
          text: "<@BOT123>",
          channel: "C123456",
          user: "U123456",
          ts: "1234567890.123456",
        },
      }),
    });

    const result = await handler(event, {} as Parameters<typeof handler>[1], () => {});

    assertResult(result);
    expect(result.statusCode).toBe(200);
    expect(mockPostSlackMessage).not.toHaveBeenCalled();
    expect(mockEnqueueBotWebhookTask).not.toHaveBeenCalled();
  });

  it("should return 500 when initial message post fails", async () => {
    const mockDb = createMockDatabase();
    mockDb["bot-integration"].get = vi.fn().mockResolvedValue(mockIntegration);
    mockDatabase.mockResolvedValue(mockDb);
    mockPostSlackMessage.mockRejectedValue(new Error("API error"));

    const event = createEvent({
      body: JSON.stringify({
        type: "event_callback",
        event: {
          type: "app_mention",
          text: "Hello bot",
          channel: "C123456",
          user: "U123456",
          ts: "1234567890.123456",
        },
      }),
    });

    const result = await handler(event, {} as Parameters<typeof handler>[1], () => {});

    assertResult(result);
    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body || "{}");
    expect(body.ok).toBe(false);
    expect(body.error).toContain("API error");
    expect(mockEnqueueBotWebhookTask).not.toHaveBeenCalled();
  });

  it("should handle queue enqueue failure gracefully", async () => {
    const mockDb = createMockDatabase();
    mockDb["bot-integration"].get = vi.fn().mockResolvedValue(mockIntegration);
    mockDatabase.mockResolvedValue(mockDb);
    mockEnqueueBotWebhookTask.mockRejectedValue(new Error("Queue error"));

    const event = createEvent({
      body: JSON.stringify({
        type: "event_callback",
        event: {
          type: "app_mention",
          text: "Hello bot",
          channel: "C123456",
          user: "U123456",
          ts: "1234567890.123456",
        },
      }),
    });

    const result = await handler(event, {} as Parameters<typeof handler>[1], () => {});

    // Should still return 200, but error should be logged
    assertResult(result);
    expect(result.statusCode).toBe(200);
    expect(mockEnqueueBotWebhookTask).toHaveBeenCalled();
  });

  it("should return 200 for unknown event types", async () => {
    const mockDb = createMockDatabase();
    mockDb["bot-integration"].get = vi.fn().mockResolvedValue(mockIntegration);
    mockDatabase.mockResolvedValue(mockDb);

    const event = createEvent({
      body: JSON.stringify({
        type: "event_callback",
        event: {
          type: "unknown_event",
        },
      }),
    });

    const result = await handler(event, {} as Parameters<typeof handler>[1], () => {});

    assertResult(result);
    expect(result.statusCode).toBe(200);
    expect(mockPostSlackMessage).not.toHaveBeenCalled();
  });
});

