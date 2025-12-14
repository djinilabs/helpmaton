/**
 * Send a message to a Discord channel using the Discord Bot API
 * @param botToken - Discord bot token
 * @param discordChannelId - Discord channel ID where the message will be sent
 * @param content - Message content to send
 */
export async function sendDiscordMessage(
  botToken: string,
  discordChannelId: string,
  content: string
): Promise<void> {
  const url = `https://discord.com/api/v10/channels/${discordChannelId}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `Discord API error: ${response.status} ${response.statusText}`;
    
    try {
      const errorData = JSON.parse(errorText);
      if (errorData.message) {
        errorMessage = `Discord API error: ${errorData.message}`;
      }
    } catch {
      // If parsing fails, use the raw error text
      if (errorText) {
        errorMessage = `Discord API error: ${errorText}`;
      }
    }

    // Handle specific error cases
    if (response.status === 401) {
      throw new Error("Invalid Discord bot token");
    } else if (response.status === 403) {
      throw new Error("Bot lacks permission to send messages in this channel");
    } else if (response.status === 404) {
      throw new Error("Discord channel not found");
    }

    throw new Error(errorMessage);
  }

  // Message sent successfully
  const result = await response.json();
  console.log("Discord message sent successfully:", result.id);
}

