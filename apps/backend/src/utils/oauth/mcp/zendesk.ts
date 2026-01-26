import { database } from "../../../tables";

import {
  buildMcpOAuthCallbackUrl,
  generateMcpOAuthStateToken,
} from "./common";
import type { McpOAuthTokenInfo } from "./types";

const ZENDESK_SCOPES = [
  "tickets:read",
  "tickets:write",
  "hc:read",
].join(" ");
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

interface ZendeskTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

async function getZendeskConfig(
  workspaceId: string,
  serverId: string
): Promise<{ subdomain: string; clientId: string; clientSecret: string }> {
  const db = await database();
  const pk = `mcp-servers/${workspaceId}/${serverId}`;
  const server = await db["mcp-server"].get(pk, "server");
  if (!server) {
    throw new Error(`MCP server ${serverId} not found`);
  }
  if (server.authType !== "oauth" || server.serviceType !== "zendesk") {
    throw new Error(`MCP server ${serverId} is not a Zendesk OAuth server`);
  }
  const config = server.config as {
    subdomain?: string;
    clientId?: string;
    clientSecret?: string;
  };
  if (!config.subdomain || !config.clientId || !config.clientSecret) {
    throw new Error(
      "Zendesk OAuth requires config.subdomain, config.clientId, and config.clientSecret"
    );
  }
  return {
    subdomain: config.subdomain,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  };
}

function buildZendeskBaseUrl(subdomain: string): string {
  return `https://${subdomain}.zendesk.com`;
}

/**
 * Generate Zendesk OAuth authorization URL
 */
export async function generateZendeskAuthUrl(
  workspaceId: string,
  serverId: string,
  state?: string
): Promise<string> {
  const { subdomain, clientId } = await getZendeskConfig(workspaceId, serverId);
  const redirectUri = buildMcpOAuthCallbackUrl("zendesk");
  const stateToken = state || generateMcpOAuthStateToken(workspaceId, serverId);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: ZENDESK_SCOPES,
    state: stateToken,
  });

  return `${buildZendeskBaseUrl(subdomain)}/oauth/authorizations/new?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeZendeskCode(
  workspaceId: string,
  serverId: string,
  code: string
): Promise<McpOAuthTokenInfo> {
  const { subdomain, clientId, clientSecret } = await getZendeskConfig(
    workspaceId,
    serverId
  );
  const redirectUri = buildMcpOAuthCallbackUrl("zendesk");

  const response = await fetch(
    `${buildZendeskBaseUrl(subdomain)}/oauth/tokens`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to exchange Zendesk code: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as ZendeskTokenResponse;
  if (!data.access_token) {
    throw new Error("No access token received from Zendesk");
  }

  const expiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000).toISOString()
    : new Date(Date.now() + ONE_YEAR_MS).toISOString();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || data.access_token,
    expiresAt,
  };
}

/**
 * Refresh Zendesk access token
 */
export async function refreshZendeskToken(
  workspaceId: string,
  serverId: string,
  refreshToken: string
): Promise<McpOAuthTokenInfo> {
  const { subdomain, clientId, clientSecret } = await getZendeskConfig(
    workspaceId,
    serverId
  );

  const response = await fetch(
    `${buildZendeskBaseUrl(subdomain)}/oauth/tokens`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to refresh Zendesk token: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as ZendeskTokenResponse;
  if (!data.access_token) {
    throw new Error("No access token received from Zendesk refresh");
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
