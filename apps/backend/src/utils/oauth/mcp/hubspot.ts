import { getDefined } from "../../../utils";

import {
  buildMcpOAuthCallbackUrl,
  generateMcpOAuthStateToken,
} from "./common";
import type { McpOAuthTokenInfo } from "./types";

const HUBSPOT_AUTH_URL = "https://app.hubspot.com/oauth/authorize";
const HUBSPOT_TOKEN_URL = "https://api.hubapi.com/oauth/v1/token";
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

const HUBSPOT_SCOPES = [
  "crm.objects.contacts.read",
  "crm.objects.companies.read",
  "crm.objects.deals.read",
  "crm.objects.owners.read",
  "oauth",
].join(" ");

export interface HubspotTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

/**
 * Generate HubSpot OAuth authorization URL
 */
export function generateHubspotAuthUrl(
  workspaceId: string,
  serverId: string,
  state?: string
): string {
  const clientId = getDefined(
    process.env.HUBSPOT_OAUTH_CLIENT_ID,
    "HUBSPOT_OAUTH_CLIENT_ID is not set"
  );
  const redirectUri = buildMcpOAuthCallbackUrl("hubspot");
  const stateToken = state || generateMcpOAuthStateToken(workspaceId, serverId);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: HUBSPOT_SCOPES,
    state: stateToken,
  });

  return `${HUBSPOT_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeHubspotCode(
  code: string
): Promise<McpOAuthTokenInfo> {
  const clientId = getDefined(
    process.env.HUBSPOT_OAUTH_CLIENT_ID,
    "HUBSPOT_OAUTH_CLIENT_ID is not set"
  );
  const clientSecret = getDefined(
    process.env.HUBSPOT_OAUTH_CLIENT_SECRET,
    "HUBSPOT_OAUTH_CLIENT_SECRET is not set"
  );
  const redirectUri = buildMcpOAuthCallbackUrl("hubspot");

  const response = await fetch(HUBSPOT_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to exchange HubSpot code: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as HubspotTokenResponse;

  if (!data.access_token) {
    throw new Error("No access token received from HubSpot");
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
 * Refresh HubSpot access token
 */
export async function refreshHubspotToken(
  refreshToken: string
): Promise<McpOAuthTokenInfo> {
  const clientId = getDefined(
    process.env.HUBSPOT_OAUTH_CLIENT_ID,
    "HUBSPOT_OAUTH_CLIENT_ID is not set"
  );
  const clientSecret = getDefined(
    process.env.HUBSPOT_OAUTH_CLIENT_SECRET,
    "HUBSPOT_OAUTH_CLIENT_SECRET is not set"
  );

  const response = await fetch(HUBSPOT_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to refresh HubSpot token: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as HubspotTokenResponse;

  if (!data.access_token) {
    throw new Error("No access token received from HubSpot refresh");
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
