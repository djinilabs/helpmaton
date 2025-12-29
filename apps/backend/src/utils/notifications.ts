import type { OutputChannelRecord } from "../tables/schema";

import { sendDiscordMessage } from "./discord";
import { sendSlackMessage } from "./slack";

/**
 * Send a notification to a channel based on its type
 * @param channel - The output channel record
 * @param content - Message content to send
 */
export async function sendNotification(
  channel: OutputChannelRecord,
  content: string
): Promise<void> {
  if (channel.type === "discord") {
    const config = channel.config as { botToken?: string; discordChannelId?: string };
    
    if (!config.botToken) {
      throw new Error("Discord bot token is missing in channel configuration");
    }
    
    if (!config.discordChannelId) {
      throw new Error("Discord channel ID is missing in channel configuration");
    }

    await sendDiscordMessage(config.botToken, config.discordChannelId, content);
  } else if (channel.type === "slack") {
    const config = channel.config as { webhookUrl?: string };
    
    if (!config.webhookUrl) {
      throw new Error("Slack webhook URL is missing in channel configuration");
    }

    await sendSlackMessage(config.webhookUrl, content);
  } else {
    throw new Error(`Unsupported channel type: ${channel.type}`);
  }
}

