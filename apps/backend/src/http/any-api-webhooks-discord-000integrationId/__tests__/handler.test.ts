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
  mockVerifyDiscordSignature,
  mockCreateDiscordDeferredResponse,
  mockCreateDiscordInteractionResponse,
  mockEnqueueBotWebhookTask,
  mockAdaptHttpHandler,
  mockHandlingErrors,
  mockQueuesPublish,
} = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockVerifyDiscordSignature: vi.fn(),
    mockCreateDiscordDeferredResponse: vi.fn(() => ({ type: 5 })),
    mockCreateDiscordInteractionResponse: vi.fn((content: string, ephemeral: boolean) => ({
      type: 4,
      data: { content, flags: ephemeral ? 64 : undefined },
    })),
    mockEnqueueBotWebhookTask: vi.fn(),
    mockAdaptHttpHandler: vi.fn((fn) => fn),
    mockHandlingErrors: vi.fn((fn) => fn),
    mockQueuesPublish: vi.fn(),
  };
});

// Mock modules
vi.mock("../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../services/discordVerification", () => ({
  verifyDiscordSignature: mockVerifyDiscordSignature,
}));

vi.mock("../services/discordResponse", () => ({
  createDiscordDeferredResponse: mockCreateDiscordDeferredResponse,
  createDiscordInteractionResponse: mockCreateDiscordInteractionResponse,
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

// Mock @architect/functions for database initialization and queues
vi.mock("@architect/functions", () => ({
  tables: vi.fn().mockResolvedValue({
    reflect: vi.fn().mockResolvedValue({}),
    _client: {},
  }),
  queues: {
    publish: mockQueuesPublish,
  },
}));

// Import handler after mocks
import { handler } from "../index";

describe("Discord webhook handler", () => {
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
    platform: "discord" as const,
    name: "Test Bot",
    status: "active" as const,
    config: {
      botToken: "bot-token",
      publicKey: "a".repeat(64), // 64 hex chars = 32 bytes
      applicationId: "app-123",
    },
    webhookUrl: "https://example.com/webhook",
    createdAt: new Date().toISOString(),
    version: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Set up default mocks
    mockVerifyDiscordSignature.mockReturnValue(true);
    mockEnqueueBotWebhookTask.mockResolvedValue(undefined);
    mockQueuesPublish.mockResolvedValue(undefined);
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
        "x-signature-ed25519": "test-signature",
        "x-signature-timestamp": Math.floor(Date.now() / 1000).toString(),
        ...overrides?.headers,
      },
      body: overrides?.body || JSON.stringify({ type: 1 }),
      ...overrides,
    }) as Parameters<typeof handler>[0];
  }

  it("should return 400 when integrationId is missing", async () => {
    const event = createAPIGatewayEventV2({
      pathParameters: {},
    }) as Parameters<typeof handler>[0];

    const result = await handler(event, {} as Parameters<typeof handler>[1], () => {});

    expect(typeof result).toBe("object");
    if (typeof result === "object" && "statusCode" in result) {
      assertResult(result);
    expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body || "{}");
      expect(body.error).toBe("Missing integrationId");
    }
  });

  it("should return 400 when integrationId format is invalid", async () => {
    // This test doesn't need a database mock since the handler returns early
    // But we set it up to avoid errors if the code path changes
    // mockDb is already set up in beforeEach

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

  it("should return 404 when integration platform is not discord", async () => {
    const mockDb = createMockDatabase();
    mockDb["bot-integration"].get = vi.fn().mockResolvedValue({
      ...mockIntegration,
      platform: "slack",
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
    mockVerifyDiscordSignature.mockReturnValue(false);

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

  it("should handle PING interaction (type 1)", async () => {
    const mockDb = createMockDatabase();
    mockDb["bot-integration"].get = vi.fn().mockResolvedValue(mockIntegration);
    mockDatabase.mockResolvedValue(mockDb);

    const event = createEvent({
      body: JSON.stringify({ type: 1 }),
    });

    const result = await handler(event, {} as Parameters<typeof handler>[1], () => {});

    assertResult(result);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body || "{}");
    expect(body.type).toBe(1);
  });

  it("should handle APPLICATION_COMMAND interaction (type 2)", async () => {
    const mockDb = createMockDatabase();
    mockDb["bot-integration"].get = vi.fn().mockResolvedValue(mockIntegration);
    mockDatabase.mockResolvedValue(mockDb);
    
    // Ensure mockEnqueueBotWebhookTask is set up (vi.clearAllMocks might have cleared it)
    mockEnqueueBotWebhookTask.mockResolvedValue(undefined);
    mockQueuesPublish.mockResolvedValue(undefined);

    const event = createEvent({
      body: JSON.stringify({
        type: 2,
        token: "interaction-token",
        data: {
          name: "ask",
          options: [
            {
              name: "message",
              value: "Hello bot",
            },
          ],
        },
        channel_id: "channel-123",
      }),
    });

    const result = await handler(event, {} as Parameters<typeof handler>[1], () => {});

    assertResult(result);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body || "{}");
    expect(body.type).toBe(5); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
    expect(mockEnqueueBotWebhookTask).toHaveBeenCalledWith(
      "discord",
      integrationId,
      workspaceId,
      "agent-789",
      "Hello bot",
      {
        interactionToken: "interaction-token",
        applicationId: "app-123",
        channelId: "channel-123",
        botToken: "bot-token",
      },
      "channel-123"
    );
  });

  it("should handle chat command", async () => {
    const mockDb = createMockDatabase();
    mockDb["bot-integration"].get = vi.fn().mockResolvedValue(mockIntegration);
    mockDatabase.mockResolvedValue(mockDb);

    const event = createEvent({
      body: JSON.stringify({
        type: 2,
        token: "interaction-token",
        data: {
          name: "chat",
          options: [
            {
              name: "message",
              value: "Chat message",
            },
          ],
        },
        channel_id: "channel-123",
      }),
    });

    await handler(event, {} as Context, () => {});

    expect(mockEnqueueBotWebhookTask).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      "Chat message",
      expect.any(Object),
      expect.any(String)
    );
  });

  it("should return 400 when interaction token is missing", async () => {
    const mockDb = createMockDatabase();
    mockDb["bot-integration"].get = vi.fn().mockResolvedValue(mockIntegration);
    mockDatabase.mockResolvedValue(mockDb);

    const event = createEvent({
      body: JSON.stringify({
        type: 2,
        data: {
          name: "ask",
          options: [
            {
              name: "message",
              value: "Hello bot",
            },
          ],
        },
      }),
    });

    const result = await handler(event, {} as Parameters<typeof handler>[1], () => {});

    assertResult(result);
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body || "{}");
    expect(body.error).toBe("Missing interaction token");
  });

  it("should return 400 when applicationId is missing in config", async () => {
    const mockDb = createMockDatabase();
    mockDb["bot-integration"].get = vi.fn().mockResolvedValue({
      ...mockIntegration,
      config: {
        botToken: "bot-token",
        publicKey: "a".repeat(64),
        // applicationId is missing
      },
    });
    mockDatabase.mockResolvedValue(mockDb);

    const event = createEvent({
      body: JSON.stringify({
        type: 2,
        token: "interaction-token",
        data: {
          name: "ask",
          options: [
            {
              name: "message",
              value: "Hello bot",
            },
          ],
        },
      }),
    });

    const result = await handler(event, {} as Parameters<typeof handler>[1], () => {});

    assertResult(result);
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body || "{}");
    expect(body.error).toBe("Integration missing applicationId");
  });

  it("should return ephemeral message when message text is empty", async () => {
    const mockDb = createMockDatabase();
    mockDb["bot-integration"].get = vi.fn().mockResolvedValue(mockIntegration);
    mockDatabase.mockResolvedValue(mockDb);

    const event = createEvent({
      body: JSON.stringify({
        type: 2,
        token: "interaction-token",
        data: {
          name: "ask",
          options: [],
        },
      }),
    });

    const result = await handler(event, {} as Parameters<typeof handler>[1], () => {});

    assertResult(result);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body || "{}");
    expect(body.type).toBe(4);
    expect(body.data.content).toContain("Please provide a message");
    expect(body.data.flags).toBe(64); // EPHEMERAL
    expect(mockEnqueueBotWebhookTask).not.toHaveBeenCalled();
  });

  it("should handle queue enqueue failure gracefully (still return deferred response)", async () => {
    const mockDb = createMockDatabase();
    mockDb["bot-integration"].get = vi.fn().mockResolvedValue(mockIntegration);
    mockDatabase.mockResolvedValue(mockDb);
    mockEnqueueBotWebhookTask.mockRejectedValue(new Error("Queue error"));

    const event = createEvent({
      body: JSON.stringify({
        type: 2,
        token: "interaction-token",
        data: {
          name: "ask",
          options: [
            {
              name: "message",
              value: "Hello bot",
            },
          ],
        },
        channel_id: "channel-123",
      }),
    });

    const result = await handler(event, {} as Parameters<typeof handler>[1], () => {});

    // Should still return deferred response
    assertResult(result);
    if (result.statusCode !== 200) {
      console.error("Unexpected status code:", result.statusCode);
      console.error("Response body:", result.body);
    }
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body || "{}");
    expect(body.type).toBe(5);
    expect(mockEnqueueBotWebhookTask).toHaveBeenCalled();
  });

  it("should handle unknown interaction type", async () => {
    const mockDb = createMockDatabase();
    mockDb["bot-integration"].get = vi.fn().mockResolvedValue(mockIntegration);
    mockDatabase.mockResolvedValue(mockDb);

    const event = createEvent({
      body: JSON.stringify({
        type: 999, // Unknown type
      }),
    });

    const result = await handler(event, {} as Parameters<typeof handler>[1], () => {});

    assertResult(result);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body || "{}");
    expect(body.type).toBe(4);
    expect(body.data.content).toContain("Unknown interaction type");
    expect(body.data.flags).toBe(64); // EPHEMERAL
  });

  it("should use command name as message for non-ask/chat commands", async () => {
    const mockDb = createMockDatabase();
    mockDb["bot-integration"].get = vi.fn().mockResolvedValue(mockIntegration);
    mockDatabase.mockResolvedValue(mockDb);

    const event = createEvent({
      body: JSON.stringify({
        type: 2,
        token: "interaction-token",
        data: {
          name: "help",
        },
        channel_id: "channel-123",
      }),
    });

    await handler(event, {} as Context, () => {});

    expect(mockEnqueueBotWebhookTask).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      "help",
      expect.any(Object),
      expect.any(String)
    );
  });
});

