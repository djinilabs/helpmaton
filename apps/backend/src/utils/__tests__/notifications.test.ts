import { describe, it, expect, vi, beforeEach } from "vitest";

import type { OutputChannelRecord } from "../../tables/schema";
import { sendNotification } from "../notifications";

// Mock dependencies
const { mockSendDiscordMessage, mockSendSlackMessage } = vi.hoisted(() => {
  return {
    mockSendDiscordMessage: vi.fn(),
    mockSendSlackMessage: vi.fn(),
  };
});

vi.mock("../discord", () => ({
  sendDiscordMessage: mockSendDiscordMessage,
}));

vi.mock("../slack", () => ({
  sendSlackMessage: mockSendSlackMessage,
}));

describe("sendNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should send Discord notification", async () => {
    const channel: OutputChannelRecord = {
      pk: "output-channels/workspace-123/channel-456",
      sk: "channel",
      workspaceId: "workspace-123",
      channelId: "channel-456",
      type: "discord",
      name: "Discord Channel",
      config: {
        botToken:
          "MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Ng",
        discordChannelId: "123456789012345678",
      },
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    };

    const content = "Test message";

    await sendNotification(channel, content);

    expect(mockSendDiscordMessage).toHaveBeenCalledWith(
      channel.config.botToken,
      channel.config.discordChannelId,
      content
    );
    expect(mockSendSlackMessage).not.toHaveBeenCalled();
  });

  it("should send Slack notification", async () => {
    const channel: OutputChannelRecord = {
      pk: "output-channels/workspace-123/channel-456",
      sk: "channel",
      workspaceId: "workspace-123",
      channelId: "channel-456",
      type: "slack",
      name: "Slack Channel",
      config: {
        webhookUrl:
          "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX",
      },
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    };

    const content = "Test message";

    await sendNotification(channel, content);

    expect(mockSendSlackMessage).toHaveBeenCalledWith(
      channel.config.webhookUrl,
      content
    );
    expect(mockSendDiscordMessage).not.toHaveBeenCalled();
  });

  it("should throw error when Discord bot token is missing", async () => {
    const channel: OutputChannelRecord = {
      pk: "output-channels/workspace-123/channel-456",
      sk: "channel",
      workspaceId: "workspace-123",
      channelId: "channel-456",
      type: "discord",
      name: "Discord Channel",
      config: {
        discordChannelId: "123456789012345678",
      },
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    };

    const content = "Test message";

    await expect(sendNotification(channel, content)).rejects.toThrow(
      "Discord bot token is missing in channel configuration"
    );
  });

  it("should throw error when Discord channel ID is missing", async () => {
    const channel: OutputChannelRecord = {
      pk: "output-channels/workspace-123/channel-456",
      sk: "channel",
      workspaceId: "workspace-123",
      channelId: "channel-456",
      type: "discord",
      name: "Discord Channel",
      config: {
        botToken:
          "MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Ng",
      },
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    };

    const content = "Test message";

    await expect(sendNotification(channel, content)).rejects.toThrow(
      "Discord channel ID is missing in channel configuration"
    );
  });

  it("should throw error when Slack webhook URL is missing", async () => {
    const channel: OutputChannelRecord = {
      pk: "output-channels/workspace-123/channel-456",
      sk: "channel",
      workspaceId: "workspace-123",
      channelId: "channel-456",
      type: "slack",
      name: "Slack Channel",
      config: {},
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    };

    const content = "Test message";

    await expect(sendNotification(channel, content)).rejects.toThrow(
      "Slack webhook URL is missing in channel configuration"
    );
  });

  it("should throw error for unsupported channel type", async () => {
    const channel = {
      pk: "output-channels/workspace-123/channel-456",
      sk: "channel",
      workspaceId: "workspace-123",
      channelId: "channel-456",
      type: "email",
      name: "Email Channel",
      config: {},
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    } as OutputChannelRecord;

    const content = "Test message";

    await expect(sendNotification(channel, content)).rejects.toThrow(
      "Unsupported channel type: email"
    );
  });
});
