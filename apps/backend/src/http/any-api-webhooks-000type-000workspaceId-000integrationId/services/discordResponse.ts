/**
 * Converts markdown to Discord formatting
 */
export function markdownToDiscord(markdown: string): string {
  let discord = markdown;

  // Convert bold: **text** or __text__ to **text**
  discord = discord.replace(/\*\*(.+?)\*\*/g, "**$1**");
  discord = discord.replace(/__(.+?)__/g, "**$1**");

  // Convert italic: *text* or _text_ to *text* (but not if it's part of bold)
  // Discord uses *text* for italic
  discord = discord.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "*$1*");
  discord = discord.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "*$1*");

  // Convert code blocks: ```code``` to ```code```
  // Discord uses triple backticks for code blocks, so this is already compatible

  // Convert inline code: `code` to `code`
  // Discord uses single backticks for inline code, so this is already compatible

  // Convert links: [text](url) to [text](url) (Discord supports markdown links)
  // No conversion needed

  return discord;
}

/**
 * Truncates text to Discord's message limit (2000 characters)
 */
export function truncateDiscordMessage(text: string, maxLength: number = 2000): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 3) + "...";
}

/**
 * Creates a Discord interaction response
 */
export function createDiscordInteractionResponse(
  content: string,
  ephemeral: boolean = false
): { type: number; data: { content: string; flags?: number } } {
  return {
    type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
    data: {
      content: truncateDiscordMessage(markdownToDiscord(content)),
      flags: ephemeral ? 64 : undefined, // EPHEMERAL flag
    },
  };
}

/**
 * Creates a deferred Discord interaction response
 * This acknowledges the interaction immediately, allowing up to 15 minutes for follow-up
 */
export function createDiscordDeferredResponse(): { type: number } {
  return {
    type: 5, // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
  };
}

/**
 * Updates a Discord message via REST API
 */
export async function updateDiscordMessage(
  botToken: string,
  applicationId: string,
  interactionToken: string,
  content: string
): Promise<void> {
  const url = `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`;

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${botToken}`,
    },
    body: JSON.stringify({
      content: truncateDiscordMessage(markdownToDiscord(content)),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(
      `Failed to update Discord message: ${response.status} ${errorText}`
    );
  }
}

