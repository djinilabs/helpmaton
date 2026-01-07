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
  mockVerifyDiscordSignature,
  mockPostSlackMessage,
  mockCreateDiscordDeferredResponse,
  mockCreateDiscordInteractionResponse,
  mockEnqueueBotWebhookTask,
  mockAdaptHttpHandler,
  mockHandlingErrors,
  mockQueuesPublish,
} = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockVerifySlackSignature: vi.fn(),
    mockVerifyDiscordSignature: vi.fn(),
    mockPostSlackMessage: vi.fn(),
    mockCreateDiscordDeferredResponse: vi.fn(() => ({ type: 5 })),
    mockCreateDiscordInteractionResponse: vi.fn(
      (content: string, ephemeral: boolean) => ({
        type: 4,
        data: { content, flags: ephemeral ? 64 : undefined },
      })
    ),
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

vi.mock("../services/slackVerification", () => ({
  verifySlackSignature: mockVerifySlackSignature,
}));

vi.mock("../services/discordVerification", () => ({
  verifyDiscordSignature: mockVerifyDiscordSignature,
}));

vi.mock("../services/slackResponse", () => ({
  postSlackMessage: mockPostSlackMessage,
}));

vi.mock("../services/discordResponse", () => ({
  createDiscordDeferredResponse: mockCreateDiscordDeferredResponse,
  createDiscordInteractionResponse: mockCreateDiscordInteractionResponse,
}));

vi.mock("../../../utils/botWebhookQueue", () => ({
  enqueueBotWebhookTask: mockEnqueueBotWebhookTask,
}));

vi.mock("../../utils/httpEventAdapter", () => ({
  adaptHttpHandler: mockAdaptHttpHandler,
}));

vi.mock("../../utils/handlingErrors", () => ({
  handlingErrors: mockHandlingErrors,
}));

// Mock @slack/web-api
const mockAuthTest = vi.fn();
vi.mock("@slack/web-api", () => ({
  WebClient: class {
    auth = {
      test: mockAuthTest,
    };
  },
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

describe("Unified webhook handler", () => {
  const workspaceId = "workspace-123";
  const integrationId = "integration-456";

  // Helper to assert result is an object with statusCode and body
  function assertResult(
    result: unknown
  ): asserts result is { statusCode: number; body: string } {
    expect(typeof result).toBe("object");
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("statusCode");
    expect(result).toHaveProperty("body");
  }

  const mockSlackIntegration = {
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

  const mockDiscordIntegration = {
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

  let mockDb: ReturnType<typeof createMockDatabase>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Set up default mocks
    mockVerifySlackSignature.mockReturnValue(true);
    mockVerifyDiscordSignature.mockReturnValue(true);
    mockPostSlackMessage.mockResolvedValue({
      ts: "1234567890.123456",
      channel: "C123456",
    });
    mockEnqueueBotWebhookTask.mockResolvedValue(undefined);
    mockQueuesPublish.mockResolvedValue(undefined);
    // Default WebClient auth.test response (returns bot user ID)
    mockAuthTest.mockResolvedValue({
      ok: true,
      user_id: "BOT123",
    });
    mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);
  });

  function createEvent(overrides?: {
    pathParameters?: Record<string, string>;
    headers?: Record<string, string>;
    body?: string;
  }): Parameters<typeof handler>[0] {
    return createAPIGatewayEventV2({
      pathParameters: {
        type: "slack",
        workspaceId,
        integrationId,
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

  describe("Type validation", () => {
    it("should return 400 when type is missing", async () => {
      const event = createAPIGatewayEventV2({
        pathParameters: {
          workspaceId,
          integrationId,
        },
      }) as Parameters<typeof handler>[0];

      const result = await handler(
        event,
        {} as Parameters<typeof handler>[1],
        () => {}
      );

      assertResult(result);
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body || "{}");
      expect(body.error).toBe("Missing type, workspaceId or integrationId");
    });

    it("should return 400 when type is invalid", async () => {
      const event = createEvent({
        pathParameters: {
          type: "invalid",
          workspaceId,
          integrationId,
        },
      });

      const result = await handler(
        event,
        {} as Parameters<typeof handler>[1],
        () => {}
      );

      assertResult(result);
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body || "{}");
      expect(body.error).toBe("Invalid type. Must be 'slack' or 'discord'");
    });
  });

  describe("Slack webhook handling", () => {
    it("should return 400 when workspaceId or integrationId is missing", async () => {
      const event = createAPIGatewayEventV2({
        pathParameters: {
          type: "slack",
        },
      }) as Parameters<typeof handler>[0];

      const result = await handler(
        event,
        {} as Parameters<typeof handler>[1],
        () => {}
      );

      assertResult(result);
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body || "{}");
      expect(body.error).toBe("Missing type, workspaceId or integrationId");
    });

    it("should return 404 when integration not found", async () => {
      mockDb["bot-integration"].get = vi.fn().mockResolvedValue(null);

      const event = createEvent();
      const result = await handler(
        event,
        {} as Parameters<typeof handler>[1],
        () => {}
      );

      assertResult(result);
      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body || "{}");
      expect(body.error).toBe("Integration not found");
    });

    it("should return 404 when integration platform does not match type", async () => {
      mockDb["bot-integration"].get = vi.fn().mockResolvedValue({
        ...mockSlackIntegration,
        platform: "discord",
      });

      const event = createEvent();
      const result = await handler(
        event,
        {} as Parameters<typeof handler>[1],
        () => {}
      );

      assertResult(result);
      expect(result.statusCode).toBe(404);
    });

    it("should handle Slack URL verification challenge", async () => {
      mockDb["bot-integration"].get = vi
        .fn()
        .mockResolvedValue(mockSlackIntegration);

      const challenge = "test-challenge-string";
      const event = createEvent({
        body: JSON.stringify({
          type: "url_verification",
          challenge,
        }),
      });

      const result = await handler(
        event,
        {} as Parameters<typeof handler>[1],
        () => {}
      );

      assertResult(result);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body || "{}");
      expect(body.challenge).toBe(challenge);
    });

    it("should handle Slack app_mention event", async () => {
      mockDb["bot-integration"].get = vi
        .fn()
        .mockResolvedValue(mockSlackIntegration);

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

      const result = await handler(
        event,
        {} as Parameters<typeof handler>[1],
        () => {}
      );

      assertResult(result);
      expect(result.statusCode).toBe(200);
      expect(mockPostSlackMessage).toHaveBeenCalled();
      expect(mockEnqueueBotWebhookTask).toHaveBeenCalledWith(
        "slack",
        integrationId,
        workspaceId,
        "agent-789",
        "Hello bot",
        expect.any(Object),
        "1234567890.123456"
      );
    });

    it("should skip Slack message event with bot mention (app_mention will handle it)", async () => {
      mockDb["bot-integration"].get = vi
        .fn()
        .mockResolvedValue(mockSlackIntegration);
      mockVerifySlackSignature.mockReturnValue(true);

      const event = createEvent({
        body: JSON.stringify({
          type: "event_callback",
          event: {
            type: "message",
            text: "<@BOT123> Hello bot",
            channel: "C123456", // Channel (not DM)
            user: "U123456",
            ts: "1234567890.123456",
          },
        }),
      });

      const result = await handler(
        event,
        {} as Parameters<typeof handler>[1],
        () => {}
      );

      assertResult(result);
      expect(result.statusCode).toBe(200);
      // Should NOT process the message event (app_mention will handle it)
      expect(mockPostSlackMessage).not.toHaveBeenCalled();
      expect(mockEnqueueBotWebhookTask).not.toHaveBeenCalled();
    });

    it("should process Slack message event in DM even with bot mention", async () => {
      mockDb["bot-integration"].get = vi
        .fn()
        .mockResolvedValue(mockSlackIntegration);
      mockVerifySlackSignature.mockReturnValue(true);
      mockPostSlackMessage.mockResolvedValue({
        ts: "1234567890.123457",
        channel: "D123456",
      });

      const event = createEvent({
        body: JSON.stringify({
          type: "event_callback",
          event: {
            type: "message",
            text: "<@BOT123> Hello bot",
            channel: "D123456", // DM (starts with 'D')
            user: "U123456",
            ts: "1234567890.123456",
          },
        }),
      });

      const result = await handler(
        event,
        {} as Parameters<typeof handler>[1],
        () => {}
      );

      assertResult(result);
      expect(result.statusCode).toBe(200);
      // Should process DM messages even with bot mentions (no app_mention events in DMs)
      expect(mockPostSlackMessage).toHaveBeenCalled();
      expect(mockEnqueueBotWebhookTask).toHaveBeenCalled();
    });

    it("should skip Slack message event in channel when bot is not mentioned", async () => {
      const integrationWithBotUserId = {
        ...mockSlackIntegration,
        config: {
          ...mockSlackIntegration.config,
          botUserId: "BOT123",
        },
      };
      mockDb["bot-integration"].get = vi
        .fn()
        .mockResolvedValue(integrationWithBotUserId);
      mockVerifySlackSignature.mockReturnValue(true);

      const event = createEvent({
        body: JSON.stringify({
          type: "event_callback",
          event: {
            type: "message",
            text: "Hello everyone", // No bot mention
            channel: "C123456", // Channel (not DM)
            user: "U123456",
            ts: "1234567890.123456",
          },
        }),
      });

      const result = await handler(
        event,
        {} as Parameters<typeof handler>[1],
        () => {}
      );

      assertResult(result);
      expect(result.statusCode).toBe(200);
      // Should NOT process the message event (bot not mentioned)
      expect(mockPostSlackMessage).not.toHaveBeenCalled();
      expect(mockEnqueueBotWebhookTask).not.toHaveBeenCalled();
    });
  });

  describe("Discord webhook handling", () => {
    function createDiscordEvent(overrides?: {
      pathParameters?: Record<string, string>;
      headers?: Record<string, string>;
      body?: string;
    }): Parameters<typeof handler>[0] {
      return createAPIGatewayEventV2({
        pathParameters: {
          type: "discord",
          workspaceId,
          integrationId,
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

    it("should handle Discord PING interaction (type 1)", async () => {
      mockDb["bot-integration"].get = vi
        .fn()
        .mockResolvedValue(mockDiscordIntegration);

      const event = createDiscordEvent({
        body: JSON.stringify({ type: 1 }),
      });

      const result = await handler(
        event,
        {} as Parameters<typeof handler>[1],
        () => {}
      );

      assertResult(result);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body || "{}");
      expect(body.type).toBe(1);
    });

    it("should handle Discord APPLICATION_COMMAND interaction (type 2)", async () => {
      mockDb["bot-integration"].get = vi
        .fn()
        .mockResolvedValue(mockDiscordIntegration);

      const event = createDiscordEvent({
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

      const result = await handler(
        event,
        {} as Parameters<typeof handler>[1],
        () => {}
      );

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

    it("should return 404 when Discord integration platform does not match type", async () => {
      mockDb["bot-integration"].get = vi.fn().mockResolvedValue({
        ...mockDiscordIntegration,
        platform: "slack",
      });

      const event = createDiscordEvent();
      const result = await handler(
        event,
        {} as Parameters<typeof handler>[1],
        () => {}
      );

      assertResult(result);
      expect(result.statusCode).toBe(404);
    });
  });
});
