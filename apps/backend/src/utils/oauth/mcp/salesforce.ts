import { getDefined } from "../../../utils";

import {
  buildMcpOAuthCallbackUrl,
  generateMcpOAuthStateToken,
} from "./common";
import type { McpOAuthTokenInfo } from "./types";

const SALESFORCE_AUTH_URL =
  "https://login.salesforce.com/services/oauth2/authorize";
const SALESFORCE_TOKEN_URL =
  "https://login.salesforce.com/services/oauth2/token";
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const SALESFORCE_LOCAL_CALLBACK_URL =
  "https://redirectmeto.com/http://localhost:5173/api/mcp/oauth/salesforce/callback";

const SALESFORCE_SCOPES = ["api", "refresh_token", "offline_access"].join(" ");

interface SalesforceTokenResponse {
  access_token?: string;
  refresh_token?: string;
  instance_url?: string;
  id?: string;
  issued_at?: string;
  signature?: string;
  token_type?: string;
  scope?: string;
}

function resolveSalesforceRedirectUri(): string {
  if (process.env.ARC_ENV === "testing") {
    return SALESFORCE_LOCAL_CALLBACK_URL;
  }

  return buildMcpOAuthCallbackUrl("salesforce");
}

/**
 * Generate Salesforce OAuth authorization URL
 */
export function generateSalesforceAuthUrl(
  workspaceId: string,
  serverId: string,
  state?: string
): string {
  const clientId = getDefined(
    process.env.SALESFORCE_OAUTH_CLIENT_ID,
    "SALESFORCE_OAUTH_CLIENT_ID is not set"
  );
  const redirectUri = resolveSalesforceRedirectUri();
  const stateToken = state || generateMcpOAuthStateToken(workspaceId, serverId);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SALESFORCE_SCOPES,
    state: stateToken,
  });

  return `${SALESFORCE_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeSalesforceCode(
  code: string
): Promise<McpOAuthTokenInfo> {
  const clientId = getDefined(
    process.env.SALESFORCE_OAUTH_CLIENT_ID,
    "SALESFORCE_OAUTH_CLIENT_ID is not set"
  );
  const clientSecret = getDefined(
    process.env.SALESFORCE_OAUTH_CLIENT_SECRET,
    "SALESFORCE_OAUTH_CLIENT_SECRET is not set"
  );
  const redirectUri = resolveSalesforceRedirectUri();

  const response = await fetch(SALESFORCE_TOKEN_URL, {
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
      `Failed to exchange Salesforce code: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as SalesforceTokenResponse;

  if (!data.access_token) {
    throw new Error("No access token received from Salesforce");
  }

  if (!data.instance_url) {
    throw new Error("No instance URL received from Salesforce");
  }

  const expiresAt = new Date(Date.now() + ONE_YEAR_MS).toISOString();
  const refreshToken = data.refresh_token || data.access_token;

  return {
    accessToken: data.access_token,
    refreshToken,
    expiresAt,
    instanceUrl: data.instance_url,
  };
}

/**
 * Refresh Salesforce access token
 */
export async function refreshSalesforceToken(
  refreshToken: string
): Promise<McpOAuthTokenInfo> {
  const clientId = getDefined(
    process.env.SALESFORCE_OAUTH_CLIENT_ID,
    "SALESFORCE_OAUTH_CLIENT_ID is not set"
  );
  const clientSecret = getDefined(
    process.env.SALESFORCE_OAUTH_CLIENT_SECRET,
    "SALESFORCE_OAUTH_CLIENT_SECRET is not set"
  );

  const response = await fetch(SALESFORCE_TOKEN_URL, {
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
      `Failed to refresh Salesforce token: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as SalesforceTokenResponse;

  if (!data.access_token) {
    throw new Error("No access token received from Salesforce refresh");
  }

  const expiresAt = new Date(Date.now() + ONE_YEAR_MS).toISOString();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt,
    instanceUrl: data.instance_url,
  };
}
