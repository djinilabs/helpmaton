import { getDefined } from "../../../utils";

import {
  buildMcpOAuthCallbackUrl,
  generateMcpOAuthStateToken,
} from "./common";
import type { McpOAuthTokenInfo } from "./types";

const NOTION_AUTH_URL = "https://api.notion.com/v1/oauth/authorize";
const NOTION_TOKEN_URL = "https://api.notion.com/v1/oauth/token";

export interface NotionTokenResponse {
  access_token: string;
  token_type: string;
  bot_id?: string;
  workspace_name?: string;
  workspace_icon?: string;
  workspace_id?: string;
  owner?: {
    type: string;
    user?: {
      object: string;
      id: string;
      name?: string;
      avatar_url?: string;
      type: string;
      person?: {
        email?: string;
      };
    };
  };
  duplicated_template_id?: string;
}

/**
 * Generate Notion OAuth authorization URL
 */
export function generateNotionAuthUrl(
  workspaceId: string,
  serverId: string,
  state?: string
): string {
  const clientId = getDefined(
    process.env.NOTION_OAUTH_CLIENT_ID,
    "NOTION_OAUTH_CLIENT_ID is not set"
  );
  const redirectUri = buildMcpOAuthCallbackUrl("notion");
  const stateToken = state || generateMcpOAuthStateToken(workspaceId, serverId);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    owner: "user",
    state: stateToken,
  });

  return `${NOTION_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeNotionCode(
  code: string
): Promise<McpOAuthTokenInfo> {
  const clientId = getDefined(
    process.env.NOTION_OAUTH_CLIENT_ID,
    "NOTION_OAUTH_CLIENT_ID is not set"
  );
  const clientSecret = getDefined(
    process.env.NOTION_OAUTH_CLIENT_SECRET,
    "NOTION_OAUTH_CLIENT_SECRET is not set"
  );
  const redirectUri = buildMcpOAuthCallbackUrl("notion");

  // Notion requires Basic Authentication with client_id:client_secret base64 encoded
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch(NOTION_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${credentials}`,
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to exchange Notion code: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as NotionTokenResponse;

  // Notion access tokens don't expire, but we'll set a far future date
  // Notion may not provide refresh tokens in all cases
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(); // 1 year from now

  // Extract email from owner if available
  let email: string | undefined;
  if (data.owner?.user?.person?.email) {
    email = data.owner.user.person.email;
  }

  // Notion doesn't provide refresh tokens in the standard OAuth response
  // Access tokens are long-lived and don't expire
  // We'll use the access token as the refresh token for compatibility
  return {
    accessToken: data.access_token,
    refreshToken: data.access_token, // Notion tokens don't expire, so we use access token
    expiresAt,
    email,
  };
}

/**
 * Refresh Notion access token
 * Note: Notion access tokens don't expire, so this is mainly for compatibility
 */
export async function refreshNotionToken(
  refreshToken: string
): Promise<McpOAuthTokenInfo> {
  // Notion access tokens don't expire, so we just return the same token
  // This function exists for compatibility with the token refresh pattern
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(); // 1 year from now

  return {
    accessToken: refreshToken,
    refreshToken: refreshToken,
    expiresAt,
  };
}
