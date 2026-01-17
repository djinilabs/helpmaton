import { getDefined } from "../../../utils";

import {
  buildMcpOAuthCallbackUrl,
  generateMcpOAuthStateToken,
} from "./common";
import type { McpOAuthTokenInfo } from "./types";

const LINEAR_AUTH_URL = "https://linear.app/oauth/authorize";
const LINEAR_TOKEN_URL = "https://api.linear.app/oauth/token";
const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
const LINEAR_SCOPES = "read";
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export interface LinearTokenResponse {
  access_token: string;
  token_type: string;
  scope?: string;
  expires_in?: number;
  refresh_token?: string;
}

/**
 * Generate Linear OAuth authorization URL
 */
export function generateLinearAuthUrl(
  workspaceId: string,
  serverId: string,
  state?: string
): string {
  const clientId = getDefined(
    process.env.LINEAR_OAUTH_CLIENT_ID,
    "LINEAR_OAUTH_CLIENT_ID is not set"
  );
  const redirectUri = buildMcpOAuthCallbackUrl("linear");
  const stateToken = state || generateMcpOAuthStateToken(workspaceId, serverId);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: LINEAR_SCOPES,
    actor: "app",
    state: stateToken,
  });

  return `${LINEAR_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeLinearCode(
  code: string
): Promise<McpOAuthTokenInfo> {
  const clientId = getDefined(
    process.env.LINEAR_OAUTH_CLIENT_ID,
    "LINEAR_OAUTH_CLIENT_ID is not set"
  );
  const clientSecret = getDefined(
    process.env.LINEAR_OAUTH_CLIENT_SECRET,
    "LINEAR_OAUTH_CLIENT_SECRET is not set"
  );
  const redirectUri = buildMcpOAuthCallbackUrl("linear");

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64"
  );

  const response = await fetch(LINEAR_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to exchange Linear code: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as LinearTokenResponse;

  if (!data.access_token) {
    throw new Error("No access token received from Linear");
  }

  const expiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000).toISOString()
    : new Date(Date.now() + ONE_YEAR_MS).toISOString();

  const refreshToken = data.refresh_token || data.access_token;

  let email: string | undefined;
  try {
    const userResponse = await fetch(LINEAR_GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${data.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "query { viewer { id name email } }",
      }),
    });
    if (userResponse.ok) {
      const userData = (await userResponse.json()) as {
        data?: { viewer?: { email?: string } };
      };
      email = userData.data?.viewer?.email;
    }
  } catch {
    // Email fetch is optional
  }

  return {
    accessToken: data.access_token,
    refreshToken,
    expiresAt,
    email,
  };
}

/**
 * Refresh Linear access token
 */
export async function refreshLinearToken(
  refreshToken: string
): Promise<McpOAuthTokenInfo> {
  const clientId = getDefined(
    process.env.LINEAR_OAUTH_CLIENT_ID,
    "LINEAR_OAUTH_CLIENT_ID is not set"
  );
  const clientSecret = getDefined(
    process.env.LINEAR_OAUTH_CLIENT_SECRET,
    "LINEAR_OAUTH_CLIENT_SECRET is not set"
  );

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64"
  );

  const response = await fetch(LINEAR_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to refresh Linear token: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as LinearTokenResponse;

  if (!data.access_token) {
    throw new Error("No access token received from Linear refresh");
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
