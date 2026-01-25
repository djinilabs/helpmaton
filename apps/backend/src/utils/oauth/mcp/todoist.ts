import { getDefined } from "../../../utils";

import {
  buildMcpOAuthCallbackUrl,
  generateMcpOAuthStateToken,
} from "./common";
import type { McpOAuthTokenInfo } from "./types";

const TODOIST_AUTH_URL = "https://api.todoist.com/oauth/authorize";
const TODOIST_TOKEN_URL = "https://api.todoist.com/oauth/access_token";
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

const TODOIST_SCOPES = "data:read_write";

interface TodoistTokenResponse {
  access_token?: string;
  token_type?: string;
}

/**
 * Generate Todoist OAuth authorization URL
 */
export function generateTodoistAuthUrl(
  workspaceId: string,
  serverId: string,
  state?: string
): string {
  const clientId = getDefined(
    process.env.TODOIST_OAUTH_CLIENT_ID,
    "TODOIST_OAUTH_CLIENT_ID is not set"
  );
  const redirectUri = buildMcpOAuthCallbackUrl("todoist");
  const stateToken = state || generateMcpOAuthStateToken(workspaceId, serverId);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: TODOIST_SCOPES,
    state: stateToken,
  });

  return `${TODOIST_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeTodoistCode(
  code: string
): Promise<McpOAuthTokenInfo> {
  const clientId = getDefined(
    process.env.TODOIST_OAUTH_CLIENT_ID,
    "TODOIST_OAUTH_CLIENT_ID is not set"
  );
  const clientSecret = getDefined(
    process.env.TODOIST_OAUTH_CLIENT_SECRET,
    "TODOIST_OAUTH_CLIENT_SECRET is not set"
  );
  const redirectUri = buildMcpOAuthCallbackUrl("todoist");

  const response = await fetch(TODOIST_TOKEN_URL, {
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
      `Failed to exchange Todoist code: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as TodoistTokenResponse;

  if (!data.access_token) {
    throw new Error("No access token received from Todoist");
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.access_token,
    expiresAt: new Date(Date.now() + ONE_YEAR_MS).toISOString(),
  };
}

/**
 * Refresh Todoist access token (not supported)
 */
export async function refreshTodoistToken(): Promise<McpOAuthTokenInfo> {
  throw new Error(
    "Todoist OAuth does not support refresh tokens. Please reconnect."
  );
}
