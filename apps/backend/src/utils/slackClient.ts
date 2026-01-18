import { getOAuthTokens, ensureValidToken } from "./googleApi/oauth";
import type { RefreshTokenFunction } from "./googleApi/oauth";
import { refreshSlackToken } from "./oauth/mcp/slack";

const SLACK_API_BASE = "https://slack.com/api";

interface SlackApiResponse {
  ok: boolean;
  error?: string;
}

interface SlackResponseMetadata {
  next_cursor?: string;
}

interface SlackChannel {
  id: string;
  name: string;
  is_private?: boolean;
  is_archived?: boolean;
  topic?: { value?: string };
  purpose?: { value?: string };
}

interface SlackBlockText {
  type?: string;
  text?: string;
}

interface SlackBlockElement {
  type?: string;
  text?: string;
  url?: string;
  name?: string;
  user_id?: string;
  elements?: SlackBlockElement[];
}

interface SlackBlock {
  type?: string;
  text?: SlackBlockText;
  elements?: SlackBlockElement[];
}

interface SlackMessage {
  ts?: string;
  text?: string;
  user?: string;
  bot_id?: string;
  blocks?: SlackBlock[];
}

interface SlackListChannelsResponse extends SlackApiResponse {
  channels?: SlackChannel[];
  response_metadata?: SlackResponseMetadata;
}

interface SlackHistoryResponse extends SlackApiResponse {
  messages?: SlackMessage[];
  has_more?: boolean;
  response_metadata?: SlackResponseMetadata;
}

interface SlackPostMessageResponse extends SlackApiResponse {
  channel?: string;
  ts?: string;
  message?: {
    text?: string;
  };
}

function extractTextFromElement(element: SlackBlockElement): string {
  if (typeof element.text === "string") {
    return element.text;
  }
  if (element.type === "user" && element.user_id) {
    return `<@${element.user_id}>`;
  }
  if (element.type === "link" && element.url) {
    return element.url;
  }
  if (element.type === "emoji" && element.name) {
    return `:${element.name}:`;
  }
  if (element.elements) {
    return element.elements.map(extractTextFromElement).filter(Boolean).join(" ");
  }
  return "";
}

function extractTextFromBlock(block: SlackBlock): string {
  if (block.text?.text) {
    return block.text.text;
  }
  if (block.elements) {
    return block.elements.map(extractTextFromElement).filter(Boolean).join(" ");
  }
  return "";
}

function formatSlackMessage(message: SlackMessage): string {
  const blockText = message.blocks
    ? message.blocks.map(extractTextFromBlock).filter(Boolean).join("\n")
    : "";
  const resolvedText = blockText || message.text || "(no text)";
  const sender = message.user || message.bot_id || "unknown";
  const timestamp = message.ts
    ? new Date(parseFloat(message.ts) * 1000).toISOString()
    : "";
  const prefix = timestamp ? `[${timestamp}] ` : "";
  return `${prefix}${sender}: ${resolvedText}`.trim();
}

async function makeSlackApiRequest<T extends SlackApiResponse>(
  workspaceId: string,
  serverId: string,
  path: string,
  options: RequestInit = {},
  responseType: "json" | "text" = "json"
): Promise<T> {
  const tokens = await getOAuthTokens(workspaceId, serverId);
  const refreshTokenFn: RefreshTokenFunction = refreshSlackToken;

  const accessToken = await ensureValidToken(
    workspaceId,
    serverId,
    tokens,
    refreshTokenFn
  );

  const response = await fetch(`${SLACK_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Slack API request failed: ${response.status} ${response.statusText} ${errorText}`
    );
  }

  if (responseType === "text") {
    return (await response.text()) as unknown as T;
  }

  const data = (await response.json()) as T;
  if (!data.ok) {
    throw new Error(data.error || "Slack API error");
  }

  return data;
}

export async function listChannels(
  workspaceId: string,
  serverId: string,
  options?: {
    limit?: number;
    cursor?: string;
  }
): Promise<{
  channels: Array<{
    id: string;
    name: string;
    isPrivate: boolean;
    topic?: string;
    purpose?: string;
  }>;
  nextCursor?: string;
}> {
  const params = new URLSearchParams({
    types: "public_channel,private_channel",
  });
  if (options?.limit) params.append("limit", options.limit.toString());
  if (options?.cursor) params.append("cursor", options.cursor);

  const data = await makeSlackApiRequest<SlackListChannelsResponse>(
    workspaceId,
    serverId,
    `/conversations.list?${params.toString()}`
  );

  const channels = (data.channels || []).map((channel) => ({
    id: channel.id,
    name: channel.name,
    isPrivate: !!channel.is_private,
    topic: channel.topic?.value || undefined,
    purpose: channel.purpose?.value || undefined,
  }));

  return {
    channels,
    nextCursor: data.response_metadata?.next_cursor || undefined,
  };
}

export async function getChannelHistory(
  workspaceId: string,
  serverId: string,
  channelId: string,
  options?: {
    limit?: number;
    cursor?: string;
  }
): Promise<{
  channelId: string;
  messages: Array<{
    ts?: string;
    user?: string;
    text: string;
  }>;
  hasMore: boolean;
  nextCursor?: string;
}> {
  const params = new URLSearchParams({
    channel: channelId,
  });
  if (options?.limit) params.append("limit", options.limit.toString());
  if (options?.cursor) params.append("cursor", options.cursor);

  const data = await makeSlackApiRequest<SlackHistoryResponse>(
    workspaceId,
    serverId,
    `/conversations.history?${params.toString()}`
  );

  const messages = (data.messages || []).map((message) => ({
    ts: message.ts,
    user: message.user || message.bot_id || undefined,
    text: formatSlackMessage(message),
  }));

  return {
    channelId,
    messages,
    hasMore: !!data.has_more,
    nextCursor: data.response_metadata?.next_cursor || undefined,
  };
}

export async function postMessage(
  workspaceId: string,
  serverId: string,
  channelId: string,
  text: string
): Promise<{
  channel?: string;
  ts?: string;
  text?: string;
}> {
  const data = await makeSlackApiRequest<SlackPostMessageResponse>(
    workspaceId,
    serverId,
    "/chat.postMessage",
    {
      method: "POST",
      body: JSON.stringify({
        channel: channelId,
        text,
      }),
    }
  );

  return {
    channel: data.channel,
    ts: data.ts,
    text: data.message?.text,
  };
}
