import { WebClient } from "@slack/web-api";

/**
 * Converts markdown to Slack formatting
 */
export function markdownToSlack(markdown: string): string {
  let slack = markdown;

  // Convert bold: **text** or __text__ to placeholders so we don't
  // accidentally treat them as italic later.
  // Use placeholders without underscores or asterisks to avoid regex conflicts
  const BOLD_OPEN = "\u0001BOLD_OPEN\u0001";
  const BOLD_CLOSE = "\u0001BOLD_CLOSE\u0001";
  slack = slack.replace(/\*\*(.+?)\*\*/g, `${BOLD_OPEN}$1${BOLD_CLOSE}`);
  slack = slack.replace(/__(.+?)__/g, `${BOLD_OPEN}$1${BOLD_CLOSE}`);

  // Convert italic: *text* or _text_ to _text_
  // We avoid lookbehind/lookahead for better compatibility and rely on
  // the fact that bold markers have been replaced with placeholders.
  slack = slack.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1_$2_");
  slack = slack.replace(/(^|[^_])_([^_\n]+)_/g, "$1_$2_");

  // Restore bold placeholders to Slack bold markers (*text*)
  slack = slack.replace(new RegExp(BOLD_OPEN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "*");
  slack = slack.replace(new RegExp(BOLD_CLOSE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "*");

  // Convert code blocks: ```code``` to ```code```
  // Slack uses triple backticks for code blocks, so this is already compatible
  // But we need to ensure proper formatting
  slack = slack.replace(/```(\w+)?\n([\s\S]*?)```/g, "```$1\n$2```");

  // Convert inline code: `code` to `code`
  // Slack uses single backticks for inline code, so this is already compatible

  // Convert links: [text](url) to <url|text>
  slack = slack.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>");

  // Convert line breaks
  slack = slack.replace(/\n\n/g, "\n");
  slack = slack.replace(/\n/g, "\n");

  return slack;
}

/**
 * Truncates text to Slack's message limit (4000 characters)
 */
export function truncateSlackMessage(
  text: string,
  maxLength: number = 4000
): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 3) + "...";
}

/**
 * Posts a message to Slack channel
 */
export async function postSlackMessage(
  client: WebClient,
  channel: string,
  text: string,
  threadTs?: string
): Promise<{ ts: string; channel: string }> {
  const response = await client.chat.postMessage({
    channel,
    text: truncateSlackMessage(markdownToSlack(text)),
    thread_ts: threadTs,
  });

  if (!response.ok || !response.ts || !response.channel) {
    throw new Error(
      `Failed to post Slack message: ${response.error || "Unknown error"}`
    );
  }

  return {
    ts: response.ts,
    channel: response.channel,
  };
}

/**
 * Updates a Slack message
 */
export async function updateSlackMessage(
  client: WebClient,
  channel: string,
  ts: string,
  text: string
): Promise<void> {
  const response = await client.chat.update({
    channel,
    ts,
    text: truncateSlackMessage(markdownToSlack(text)),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to update Slack message: ${response.error || "Unknown error"}`
    );
  }
}
