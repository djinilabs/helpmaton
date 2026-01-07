import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  BotWebhookTaskMessageSchema,
  enqueueBotWebhookTask,
} from "../botWebhookQueue";

// Mock @architect/functions
const { mockQueuesPublish } = vi.hoisted(() => ({
  mockQueuesPublish: vi.fn(),
}));

vi.mock("@architect/functions", () => ({
  queues: {
    publish: mockQueuesPublish,
  },
}));

describe("botWebhookQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("BotWebhookTaskMessageSchema", () => {
    it("should validate valid Discord message", () => {
      const message = {
        platform: "discord",
        integrationId: "integration-123",
        workspaceId: "workspace-123",
        agentId: "agent-456",
        messageText: "Hello",
        interactionToken: "token-123",
        applicationId: "app-123",
        botToken: "bot-token",
      };

      const result = BotWebhookTaskMessageSchema.parse(message);
      expect(result).toMatchObject(message);
    });

    it("should validate valid Slack message", () => {
      const message = {
        platform: "slack",
        integrationId: "integration-123",
        workspaceId: "workspace-123",
        agentId: "agent-456",
        messageText: "Hello",
        botToken: "xoxb-token",
        channel: "C123456",
        messageTs: "1234567890.123456",
      };

      const result = BotWebhookTaskMessageSchema.parse(message);
      expect(result).toMatchObject(message);
    });

    it("should reject invalid platform", () => {
      const message = {
        platform: "invalid",
        integrationId: "integration-123",
        workspaceId: "workspace-123",
        agentId: "agent-456",
        messageText: "Hello",
      };

      expect(() => BotWebhookTaskMessageSchema.parse(message)).toThrow();
    });

    it("should accept optional conversationId", () => {
      const message = {
        platform: "slack",
        integrationId: "integration-123",
        workspaceId: "workspace-123",
        agentId: "agent-456",
        messageText: "Hello",
        botToken: "xoxb-token",
        channel: "C123456",
        messageTs: "1234567890.123456",
        conversationId: "conv-123",
      };

      const result = BotWebhookTaskMessageSchema.parse(message);
      expect(result.conversationId).toBe("conv-123");
    });
  });

  describe("enqueueBotWebhookTask", () => {
    it("should successfully enqueue Discord task", async () => {
      mockQueuesPublish.mockResolvedValue(undefined);

      await enqueueBotWebhookTask(
        "discord",
        "integration-123",
        "workspace-123",
        "agent-456",
        "Hello bot",
        {
          interactionToken: "token-123",
          applicationId: "app-123",
          botToken: "bot-token",
        }
      );

      expect(mockQueuesPublish).toHaveBeenCalledWith({
        name: "bot-webhook-queue",
        payload: expect.objectContaining({
          platform: "discord",
          integrationId: "integration-123",
          workspaceId: "workspace-123",
          agentId: "agent-456",
          messageText: "Hello bot",
          interactionToken: "token-123",
          applicationId: "app-123",
          botToken: "bot-token",
        }),
      });
    });

    it("should successfully enqueue Slack task", async () => {
      mockQueuesPublish.mockResolvedValue(undefined);

      await enqueueBotWebhookTask(
        "slack",
        "integration-123",
        "workspace-123",
        "agent-456",
        "Hello bot",
        {
          botToken: "xoxb-token",
          channel: "C123456",
          messageTs: "1234567890.123456",
        }
      );

      expect(mockQueuesPublish).toHaveBeenCalledWith({
        name: "bot-webhook-queue",
        payload: expect.objectContaining({
          platform: "slack",
          botToken: "xoxb-token",
          channel: "C123456",
          messageTs: "1234567890.123456",
        }),
      });
    });

    it("should include conversationId when provided", async () => {
      mockQueuesPublish.mockResolvedValue(undefined);

      await enqueueBotWebhookTask(
        "slack",
        "integration-123",
        "workspace-123",
        "agent-456",
        "Hello bot",
        {
          botToken: "xoxb-token",
          channel: "C123456",
          messageTs: "1234567890.123456",
        },
        "conv-123"
      );

      expect(mockQueuesPublish).toHaveBeenCalledWith({
        name: "bot-webhook-queue",
        payload: expect.objectContaining({
          conversationId: "conv-123",
        }),
      });
    });

    it("should validate message before enqueueing", async () => {
      await expect(
        enqueueBotWebhookTask(
          "invalid" as "discord" | "slack",
          "integration-123",
          "workspace-123",
          "agent-456",
          "Hello bot",
          {
            botToken: "xoxb-token",
            channel: "C123456",
            messageTs: "1234567890.123456",
          }
        )
      ).rejects.toThrow();
    });
  });
});

