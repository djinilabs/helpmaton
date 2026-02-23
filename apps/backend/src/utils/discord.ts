/** Discord API limit: message content must be 1–2000 characters. */
export const DISCORD_MESSAGE_MAX_LENGTH = 2000;

/**
 * Normalize content for Discord: trim and enforce length limit.
 * Returns content safe to send (non-empty, at most 2000 chars).
 * @throws if trimmed content is empty
 */
export function normalizeDiscordContent(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new Error(
      "Discord message content cannot be empty (at least one of content, embeds, etc. is required)"
    );
  }
  if (trimmed.length <= DISCORD_MESSAGE_MAX_LENGTH) {
    return trimmed;
  }
  return trimmed.slice(0, DISCORD_MESSAGE_MAX_LENGTH - 1) + "…";
}

/**
 * Send a message to a Discord channel using the Discord Bot API
 * @param botToken - Discord bot token
 * @param discordChannelId - Discord channel ID where the message will be sent
 * @param content - Message content to send (will be trimmed and truncated to 2000 chars)
 */
export async function sendDiscordMessage(
  botToken: string,
  discordChannelId: string,
  content: string
): Promise<void> {
  const normalizedContent = normalizeDiscordContent(content);

  const url = `https://discord.com/api/v10/channels/${discordChannelId}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: normalizedContent,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `Discord API error: ${response.status} ${response.statusText}`;

    try {
      const errorData = JSON.parse(errorText) as {
        message?: string;
        code?: number;
        errors?: Record<string, unknown>;
      };
      if (errorData.message) {
        errorMessage = `Discord API error: ${errorData.message}`;
        if (errorData.errors && typeof errorData.errors === "object") {
          const detail = JSON.stringify(errorData.errors);
          if (detail !== "{}") {
            errorMessage += ` (${detail})`;
          }
        }
      }
    } catch {
      if (errorText) {
        errorMessage = `Discord API error: ${errorText}`;
      }
    }

    if (response.status === 401) {
      throw new Error("Invalid Discord bot token");
    }
    if (response.status === 403) {
      throw new Error("Bot lacks permission to send messages in this channel");
    }
    if (response.status === 404) {
      throw new Error("Discord channel not found");
    }

    throw new Error(errorMessage);
  }

  // Message sent successfully
  const result = await response.json();
  console.log("Discord message sent successfully:", result.id);
}

