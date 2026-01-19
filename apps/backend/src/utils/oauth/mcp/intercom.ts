import { getDefined } from "../../../utils";

import {
  buildMcpOAuthCallbackUrl,
  generateMcpOAuthStateToken,
} from "./common";
import type { McpOAuthTokenInfo } from "./types";

const INTERCOM_AUTH_URL = "https://app.intercom.io/oauth";
const INTERCOM_TOKEN_URL = "https://api.intercom.io/auth/eagle/token";
const INTERCOM_API_BASE = "https://api.intercom.io";
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

const INTERCOM_SCOPES = [
  "read_conversations",
  "write_conversations",
  "read_users",
  "write_users",
  "read_admins",
].join(" ");

interface IntercomTokenResponse {
  access_token?: string;
  token?: string;
  token_type?: string;
}

interface IntercomMeResponse {
  id?: string;
  type?: string;
  email?: string;
  name?: string;
}

async function fetchIntercomAdminId(accessToken: string): Promise<string> {
  const response = await fetch(`${INTERCOM_API_BASE}/me`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to fetch Intercom admin info: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as IntercomMeResponse;
  if (!data.id) {
    throw new Error("Intercom admin ID not found in /me response");
  }

  return data.id;
}

/**
 * Generate Intercom OAuth authorization URL
 */
export function generateIntercomAuthUrl(
  workspaceId: string,
  serverId: string,
  state?: string
): string {
  const clientId = getDefined(
    process.env.INTERCOM_OAUTH_CLIENT_ID,
    "INTERCOM_OAUTH_CLIENT_ID is not set"
  );
  const redirectUri = buildMcpOAuthCallbackUrl("intercom");
  const stateToken = state || generateMcpOAuthStateToken(workspaceId, serverId);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: INTERCOM_SCOPES,
    state: stateToken,
  });

  return `${INTERCOM_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeIntercomCode(
  code: string
): Promise<McpOAuthTokenInfo> {
  const clientId = getDefined(
    process.env.INTERCOM_OAUTH_CLIENT_ID,
    "INTERCOM_OAUTH_CLIENT_ID is not set"
  );
  const clientSecret = getDefined(
    process.env.INTERCOM_OAUTH_CLIENT_SECRET,
    "INTERCOM_OAUTH_CLIENT_SECRET is not set"
  );
  const redirectUri = buildMcpOAuthCallbackUrl("intercom");

  const response = await fetch(INTERCOM_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to exchange Intercom code: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as IntercomTokenResponse;
  const accessToken = data.access_token || data.token;

  if (!accessToken) {
    throw new Error("No access token received from Intercom");
  }

  const adminId = await fetchIntercomAdminId(accessToken);

  return {
    accessToken,
    refreshToken: accessToken,
    expiresAt: new Date(Date.now() + ONE_YEAR_MS).toISOString(),
    adminId,
  };
}

/**
 * Refresh Intercom access token (not supported)
 */
export async function refreshIntercomToken(): Promise<McpOAuthTokenInfo> {
  throw new Error(
    "Intercom OAuth does not support refresh tokens. Please reconnect."
  );
}
