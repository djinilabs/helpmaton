import { getDefined } from "../../../utils";

import {
  buildMcpOAuthCallbackUrl,
  generateMcpOAuthStateToken,
} from "./common";
import type { McpOAuthTokenInfo } from "./types";

const SLACK_AUTH_URL = "https://slack.com/oauth/v2/authorize";
const SLACK_TOKEN_URL = "https://slack.com/api/oauth.v2.access";
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const SLACK_LOCAL_CALLBACK_URL =
  "https://redirectmeto.com/http://localhost:5173/api/mcp/oauth/slack/callback";

const SLACK_BOT_SCOPES = [
  "channels:read",
  "channels:history",
  "groups:read",
  "groups:history",
  "chat:write",
].join(",");

interface SlackOauthResponse {
  ok: boolean;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  team?: {
    id?: string;
    name?: string;
  };
  bot_user_id?: string;
}

function resolveSlackRedirectUri(): string {
  if (process.env.ARC_ENV === "testing") {
    return SLACK_LOCAL_CALLBACK_URL;
  }

  return buildMcpOAuthCallbackUrl("slack");
}

/**
 * Generate Slack OAuth authorization URL
 */
export function generateSlackAuthUrl(
  workspaceId: string,
  serverId: string,
  state?: string
): string {
  const clientId = getDefined(
    process.env.SLACK_OAUTH_CLIENT_ID,
    "SLACK_OAUTH_CLIENT_ID is not set"
  );
  const redirectUri = resolveSlackRedirectUri();
  const stateToken = state || generateMcpOAuthStateToken(workspaceId, serverId);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SLACK_BOT_SCOPES,
    state: stateToken,
  });

  return `${SLACK_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeSlackCode(
  code: string
): Promise<McpOAuthTokenInfo> {
  const clientId = getDefined(
    process.env.SLACK_OAUTH_CLIENT_ID,
    "SLACK_OAUTH_CLIENT_ID is not set"
  );
  const clientSecret = getDefined(
    process.env.SLACK_OAUTH_CLIENT_SECRET,
    "SLACK_OAUTH_CLIENT_SECRET is not set"
  );
  const redirectUri = resolveSlackRedirectUri();

  const response = await fetch(SLACK_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to exchange Slack code: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as SlackOauthResponse;

  if (!data.ok) {
    throw new Error(data.error || "Slack OAuth token exchange failed");
  }

  if (!data.access_token) {
    throw new Error("No access token received from Slack");
  }

  const expiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000).toISOString()
    : new Date(Date.now() + ONE_YEAR_MS).toISOString();

  const refreshToken = data.refresh_token || data.access_token;

  return {
    accessToken: data.access_token,
    refreshToken,
    expiresAt,
  };
}

/**
 * Refresh Slack access token
 */
export async function refreshSlackToken(
  refreshToken: string
): Promise<McpOAuthTokenInfo> {
  const clientId = getDefined(
    process.env.SLACK_OAUTH_CLIENT_ID,
    "SLACK_OAUTH_CLIENT_ID is not set"
  );
  const clientSecret = getDefined(
    process.env.SLACK_OAUTH_CLIENT_SECRET,
    "SLACK_OAUTH_CLIENT_SECRET is not set"
  );

  const response = await fetch(SLACK_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to refresh Slack token: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as SlackOauthResponse;

  if (!data.ok) {
    throw new Error(data.error || "Slack OAuth token refresh failed");
  }

  if (!data.access_token) {
    throw new Error("No access token received from Slack refresh");
  }

  const expiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000).toISOString()
    : new Date(Date.now() + ONE_YEAR_MS).toISOString();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt,
  };
}
