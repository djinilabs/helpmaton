import { WebClient } from "@slack/web-api";
import type { SQSEvent, SQSRecord } from "aws-lambda";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { handler } from "../index";

// Mock dependencies using vi.hoisted
const {
  mockDatabase,
  mockCallAgentNonStreaming,
  mockUpdateDiscordMessage,
  mockUpdateSlackMessage,
  mockGetCurrentSQSContext,
  mockHandlingSQSErrors,
} = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockCallAgentNonStreaming: vi.fn(),
    mockUpdateDiscordMessage: vi.fn(),
    mockUpdateSlackMessage: vi.fn(),
    mockGetCurrentSQSContext: vi.fn(),
    mockHandlingSQSErrors: vi.fn((fn) => fn),
  };
});

// Mock modules
vi.mock("../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../http/utils/agentCallNonStreaming", () => ({
  callAgentNonStreaming: mockCallAgentNonStreaming,
}));

vi.mock("../../http/any-api-webhooks-discord-000integrationId/services/discordResponse", () => ({
  updateDiscordMessage: mockUpdateDiscordMessage,
}));

vi.mock("../../http/any-api-webhooks-slack-000integrationId/services/slackResponse", () => ({
  updateSlackMessage: mockUpdateSlackMessage,
}));

vi.mock("../../utils/workspaceCreditContext", () => ({
  getCurrentSQSContext: mockGetCurrentSQSContext,
}));

vi.mock("../../utils/handlingSQSErrors", () => ({
  handlingSQSErrors: mockHandlingSQSErrors,
}));

// Mock @architect/functions for database initialization
vi.mock("@architect/functions", () => ({
  tables: vi.fn().mockResolvedValue({
    reflect: vi.fn().mockResolvedValue({}),
    _client: {},
  }),
}));

describe("bot-webhook-queue handler", () => {
  const mockContext = {
    workspaceId: "workspace-123",
    agentId: "agent-456",
  };

  const mockDiscordIntegration = {
    pk: "bot-integrations/workspace-123/integration-789",
    sk: "integration",
    workspaceId: "workspace-123",
    agentId: "agent-456",
    platform: "discord" as const,
    name: "Test Discord Bot",
    status: "active" as const,
    config: {
      botToken: "bot-token",
      publicKey: "a".repeat(64),
      applicationId: "app-123",
    },
    webhookUrl: "https://example.com/webhook",
    createdAt: new Date().toISOString(),
    version: 1,
  };

  const mockSlackIntegration = {
    ...mockDiscordIntegration,
    platform: "slack" as const,
    name: "Test Slack Bot",
    config: {
      botToken: "xoxb-token",
      signingSecret: "signing-secret",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGetCurrentSQSContext.mockReturnValue(mockContext);
    mockCallAgentNonStreaming.mockResolvedValue({
      text: "Agent response",
      tokenUsage: { promptTokens: 10, completionTokens: 20 },
      openrouterGenerationId: "gen-123",
      openrouterGenerationIds: ["gen-123"],
      provisionalCostUsd: 0.001,
    });
    mockUpdateDiscordMessage.mockResolvedValue(undefined);
    mockUpdateSlackMessage.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createSQSEvent(records: Array<{ body: unknown; messageId?: string }>): SQSEvent {
    return {
      Records: records.map(
        (r, i) =>
          ({
            messageId: r.messageId || `msg-${i}`,
            receiptHandle: `receipt-${i}`,
            body: JSON.stringify(r.body),
            attributes: {
              ApproximateReceiveCount: "1",
              SentTimestamp: Date.now().toString(),
            },
            messageAttributes: {},
            md5OfBody: "md5",
            eventSource: "aws:sqs",
            eventSourceARN: "arn:aws:sqs:us-east-1:123456789012:queue",
            awsRegion: "us-east-1",
          }) as SQSRecord
      ),
    };
  }

  describe("Discord task processing", () => {
    it("should successfully process Discord task", async () => {
      const mockDb = {
        "bot-integration": {
          get: vi.fn().mockResolvedValue(mockDiscordIntegration),
          update: vi.fn().mockResolvedValue(mockDiscordIntegration),
        },
      };
      mockDatabase.mockResolvedValue(mockDb);

      const event = createSQSEvent([
        {
          body: {
            platform: "discord",
            integrationId: "integration-789",
            workspaceId: "workspace-123",
            agentId: "agent-456",
            messageText: "Hello bot",
            interactionToken: "token-123",
            applicationId: "app-123",
            botToken: "bot-token",
            channelId: "channel-123",
          },
        },
      ]);

      const result = await handler(event);

      expect(result).toEqual([]);
      expect(mockUpdateDiscordMessage).toHaveBeenCalledWith(
        "bot-token",
        "app-123",
        "token-123",
        "Agent is thinking..."
      );
      expect(mockCallAgentNonStreaming).toHaveBeenCalled();
      expect(mockUpdateDiscordMessage).toHaveBeenCalledWith(
        "bot-token",
        "app-123",
        "token-123",
        "Agent response"
      );
      expect(mockDb["bot-integration"].update).toHaveBeenCalled();
    });

    it("should throw error when required Discord fields are missing", async () => {
      const event = createSQSEvent([
        {
          body: {
            platform: "discord",
            integrationId: "integration-789",
            workspaceId: "workspace-123",
            agentId: "agent-456",
            messageText: "Hello bot",
            // Missing interactionToken, applicationId, botToken
          },
        },
      ]);

      const result = await handler(event);

      expect(result.batchItemFailures?.length).toBe(1);
      expect(result.batchItemFailures?.[0]?.itemIdentifier).toBe("msg-0");
    });

    it("should throw error when integration not found", async () => {
      const mockDb = {
        "bot-integration": {
          get: vi.fn().mockResolvedValue(null),
        },
      };
      mockDatabase.mockResolvedValue(mockDb);

      const event = createSQSEvent([
        {
          body: {
            platform: "discord",
            integrationId: "integration-789",
            workspaceId: "workspace-123",
            agentId: "agent-456",
            messageText: "Hello bot",
            interactionToken: "token-123",
            applicationId: "app-123",
            botToken: "bot-token",
          },
        },
      ]);

      const result = await handler(event);

      expect(result.batchItemFailures?.length).toBe(1);
    });

    it("should throw error when integration platform mismatch", async () => {
      const mockDb = {
        "bot-integration": {
          get: vi.fn().mockResolvedValue({
            ...mockDiscordIntegration,
            platform: "slack",
          }),
        },
      };
      mockDatabase.mockResolvedValue(mockDb);

      const event = createSQSEvent([
        {
          body: {
            platform: "discord",
            integrationId: "integration-789",
            workspaceId: "workspace-123",
            agentId: "agent-456",
            messageText: "Hello bot",
            interactionToken: "token-123",
            applicationId: "app-123",
            botToken: "bot-token",
          },
        },
      ]);

      const result = await handler(event);

      expect(result.batchItemFailures?.length).toBe(1);
    });

    it("should handle initial message post failure gracefully", async () => {
      const mockDb = {
        "bot-integration": {
          get: vi.fn().mockResolvedValue(mockDiscordIntegration),
          update: vi.fn().mockResolvedValue(mockDiscordIntegration),
        },
      };
      mockDatabase.mockResolvedValue(mockDb);
      mockUpdateDiscordMessage.mockRejectedValueOnce(new Error("API error"));

      const event = createSQSEvent([
        {
          body: {
            platform: "discord",
            integrationId: "integration-789",
            workspaceId: "workspace-123",
            agentId: "agent-456",
            messageText: "Hello bot",
            interactionToken: "token-123",
            applicationId: "app-123",
            botToken: "bot-token",
          },
        },
      ]);

      // Should still process the task
      const result = await handler(event);

      expect(result).toEqual([]);
      expect(mockCallAgentNonStreaming).toHaveBeenCalled();
    });

    it("should update message with error when agent call fails", async () => {
      const mockDb = {
        "bot-integration": {
          get: vi.fn().mockResolvedValue(mockDiscordIntegration),
        },
      };
      mockDatabase.mockResolvedValue(mockDb);
      mockCallAgentNonStreaming.mockRejectedValue(new Error("Agent error"));

      const event = createSQSEvent([
        {
          body: {
            platform: "discord",
            integrationId: "integration-789",
            workspaceId: "workspace-123",
            agentId: "agent-456",
            messageText: "Hello bot",
            interactionToken: "token-123",
            applicationId: "app-123",
            botToken: "bot-token",
          },
        },
      ]);

      const result = await handler(event);

      expect(result.batchItemFailures?.length).toBe(1);
      expect(mockUpdateDiscordMessage).toHaveBeenCalledWith(
        "bot-token",
        "app-123",
        "token-123",
        expect.stringContaining("Error: Agent error")
      );
    });

    it("should update message with throttled updates (1.5s interval)", async () => {
      const mockDb = {
        "bot-integration": {
          get: vi.fn().mockResolvedValue(mockDiscordIntegration),
          update: vi.fn().mockResolvedValue(mockDiscordIntegration),
        },
      };
      mockDatabase.mockResolvedValue(mockDb);

      // Make agent call take 3 seconds
      mockCallAgentNonStreaming.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                text: "Agent response",
                tokenUsage: { promptTokens: 10, completionTokens: 20 },
                openrouterGenerationId: "gen-123",
                openrouterGenerationIds: ["gen-123"],
                provisionalCostUsd: 0.001,
              });
            }, 3000);
          })
      );

      const event = createSQSEvent([
        {
          body: {
            platform: "discord",
            integrationId: "integration-789",
            workspaceId: "workspace-123",
            agentId: "agent-456",
            messageText: "Hello bot",
            interactionToken: "token-123",
            applicationId: "app-123",
            botToken: "bot-token",
          },
        },
      ]);

      const handlerPromise = handler(event);

      // Advance time by 1.5 seconds - should trigger first update
      await vi.advanceTimersByTimeAsync(1500);
      expect(mockUpdateDiscordMessage).toHaveBeenCalledWith(
        "bot-token",
        "app-123",
        "token-123",
        expect.stringContaining("Agent is thinking... (1s)")
      );

      // Advance time by another 1.5 seconds - should trigger second update
      await vi.advanceTimersByTimeAsync(1500);
      expect(mockUpdateDiscordMessage).toHaveBeenCalledWith(
        "bot-token",
        "app-123",
        "token-123",
        expect.stringContaining("Agent is thinking... (3s)")
      );

      // Complete the handler
      await vi.runAllTimersAsync();
      await handlerPromise;

      expect(mockUpdateDiscordMessage).toHaveBeenCalledWith(
        "bot-token",
        "app-123",
        "token-123",
        "Agent response"
      );
    });

    it("should handle conversation ID", async () => {
      const mockDb = {
        "bot-integration": {
          get: vi.fn().mockResolvedValue(mockDiscordIntegration),
          update: vi.fn().mockResolvedValue(mockDiscordIntegration),
        },
      };
      mockDatabase.mockResolvedValue(mockDb);

      const event = createSQSEvent([
        {
          body: {
            platform: "discord",
            integrationId: "integration-789",
            workspaceId: "workspace-123",
            agentId: "agent-456",
            messageText: "Hello bot",
            interactionToken: "token-123",
            applicationId: "app-123",
            botToken: "bot-token",
            conversationId: "conv-123",
          },
        },
      ]);

      await handler(event);

      expect(mockCallAgentNonStreaming).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          conversationId: "conv-123",
        })
      );
    });
  });

  describe("Slack task processing", () => {
    it("should successfully process Slack task", async () => {
      const mockDb = {
        "bot-integration": {
          get: vi.fn().mockResolvedValue(mockSlackIntegration),
          update: vi.fn().mockResolvedValue(mockSlackIntegration),
        },
      };
      mockDatabase.mockResolvedValue(mockDb);

      const event = createSQSEvent([
        {
          body: {
            platform: "slack",
            integrationId: "integration-789",
            workspaceId: "workspace-123",
            agentId: "agent-456",
            messageText: "Hello bot",
            botToken: "xoxb-token",
            channel: "C123456",
            messageTs: "1234567890.123456",
          },
        },
      ]);

      const result = await handler(event);

      expect(result).toEqual([]);
      expect(mockCallAgentNonStreaming).toHaveBeenCalled();
      expect(mockUpdateSlackMessage).toHaveBeenCalledWith(
        expect.any(WebClient),
        "C123456",
        "1234567890.123456",
        "Agent response"
      );
      expect(mockDb["bot-integration"].update).toHaveBeenCalled();
    });

    it("should throw error when required Slack fields are missing", async () => {
      const event = createSQSEvent([
        {
          body: {
            platform: "slack",
            integrationId: "integration-789",
            workspaceId: "workspace-123",
            agentId: "agent-456",
            messageText: "Hello bot",
            // Missing botToken, channel, messageTs
          },
        },
      ]);

      const result = await handler(event);

      expect(result.batchItemFailures?.length).toBe(1);
    });

    it("should handle threadTs", async () => {
      const mockDb = {
        "bot-integration": {
          get: vi.fn().mockResolvedValue(mockSlackIntegration),
          update: vi.fn().mockResolvedValue(mockSlackIntegration),
        },
      };
      mockDatabase.mockResolvedValue(mockDb);

      const event = createSQSEvent([
        {
          body: {
            platform: "slack",
            integrationId: "integration-789",
            workspaceId: "workspace-123",
            agentId: "agent-456",
            messageText: "Hello bot",
            botToken: "xoxb-token",
            channel: "C123456",
            messageTs: "1234567890.123456",
            threadTs: "1234567890.123455",
          },
        },
      ]);

      await handler(event);

      expect(mockCallAgentNonStreaming).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          conversationId: "1234567890.123455",
        })
      );
    });

    it("should update message with throttled updates", async () => {
      const mockDb = {
        "bot-integration": {
          get: vi.fn().mockResolvedValue(mockSlackIntegration),
          update: vi.fn().mockResolvedValue(mockSlackIntegration),
        },
      };
      mockDatabase.mockResolvedValue(mockDb);

      mockCallAgentNonStreaming.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                text: "Agent response",
                tokenUsage: { promptTokens: 10, completionTokens: 20 },
                openrouterGenerationId: "gen-123",
                openrouterGenerationIds: ["gen-123"],
                provisionalCostUsd: 0.001,
              });
            }, 3000);
          })
      );

      const event = createSQSEvent([
        {
          body: {
            platform: "slack",
            integrationId: "integration-789",
            workspaceId: "workspace-123",
            agentId: "agent-456",
            messageText: "Hello bot",
            botToken: "xoxb-token",
            channel: "C123456",
            messageTs: "1234567890.123456",
          },
        },
      ]);

      const handlerPromise = handler(event);

      await vi.advanceTimersByTimeAsync(1500);
      expect(mockUpdateSlackMessage).toHaveBeenCalledWith(
        expect.any(WebClient),
        "C123456",
        "1234567890.123456",
        expect.stringContaining("Agent is thinking... (1s)")
      );

      await vi.runAllTimersAsync();
      await handlerPromise;
    });
  });

  describe("Queue handler integration", () => {
    it("should process multiple SQS records", async () => {
      const mockDb = {
        "bot-integration": {
          get: vi
            .fn()
            .mockResolvedValueOnce(mockDiscordIntegration)
            .mockResolvedValueOnce(mockSlackIntegration),
          update: vi.fn().mockResolvedValue(mockDiscordIntegration),
        },
      };
      mockDatabase.mockResolvedValue(mockDb);

      const event = createSQSEvent([
        {
          body: {
            platform: "discord",
            integrationId: "integration-789",
            workspaceId: "workspace-123",
            agentId: "agent-456",
            messageText: "Hello",
            interactionToken: "token-123",
            applicationId: "app-123",
            botToken: "bot-token",
          },
          messageId: "msg-1",
        },
        {
          body: {
            platform: "slack",
            integrationId: "integration-789",
            workspaceId: "workspace-123",
            agentId: "agent-456",
            messageText: "Hello",
            botToken: "xoxb-token",
            channel: "C123456",
            messageTs: "1234567890.123456",
          },
          messageId: "msg-2",
        },
      ]);

      const result = await handler(event);

      expect(result).toEqual([]);
      expect(mockCallAgentNonStreaming).toHaveBeenCalledTimes(2);
    });

    it("should return failed message IDs for errors", async () => {
      const mockDb = {
        "bot-integration": {
          get: vi.fn().mockResolvedValue(null),
        },
      };
      mockDatabase.mockResolvedValue(mockDb);

      const event = createSQSEvent([
        {
          body: {
            platform: "discord",
            integrationId: "integration-789",
            workspaceId: "workspace-123",
            agentId: "agent-456",
            messageText: "Hello",
            interactionToken: "token-123",
            applicationId: "app-123",
            botToken: "bot-token",
          },
          messageId: "msg-1",
        },
        {
          body: {
            platform: "slack",
            integrationId: "integration-789",
            workspaceId: "workspace-123",
            agentId: "agent-456",
            messageText: "Hello",
            botToken: "xoxb-token",
            channel: "C123456",
            messageTs: "1234567890.123456",
          },
          messageId: "msg-2",
        },
      ]);

      const result = await handler(event);

      expect(result.batchItemFailures?.length).toBe(2);
      expect(result.batchItemFailures?.some((f) => f.itemIdentifier === "msg-1")).toBe(true);
      expect(result.batchItemFailures?.some((f) => f.itemIdentifier === "msg-2")).toBe(true);
    });

    it("should handle schema validation errors", async () => {
      const event = createSQSEvent([
        {
          body: {
            platform: "invalid-platform",
            // Missing required fields
          },
          messageId: "msg-1",
        },
      ]);

      const result = await handler(event);

      expect(result.batchItemFailures?.length).toBe(1);
      expect(result.batchItemFailures?.[0]?.itemIdentifier).toBe("msg-1");
    });

    it("should throw error when context is not available", async () => {
      mockGetCurrentSQSContext.mockReturnValue(null);

      const event = createSQSEvent([
        {
          body: {
            platform: "discord",
            integrationId: "integration-789",
            workspaceId: "workspace-123",
            agentId: "agent-456",
            messageText: "Hello",
            interactionToken: "token-123",
            applicationId: "app-123",
            botToken: "bot-token",
          },
        },
      ]);

      const result = await handler(event);

      expect(result.batchItemFailures?.length).toBe(1);
    });

    it("should throw error for unknown platform", async () => {
      const event = createSQSEvent([
        {
          body: {
            platform: "unknown",
            integrationId: "integration-789",
            workspaceId: "workspace-123",
            agentId: "agent-456",
            messageText: "Hello",
          },
        },
      ]);

      const result = await handler(event);

      expect(result.batchItemFailures?.length).toBe(1);
    });
  });
});

