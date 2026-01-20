import { database } from "../../../tables";
import { getDefined } from "../../../utils";
import { assertValidShopifyShopDomain } from "../../shopify/utils";

import {
  buildMcpOAuthCallbackUrl,
  generateMcpOAuthStateToken,
} from "./common";
import type { McpOAuthTokenInfo } from "./types";

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const SHOPIFY_SCOPES = ["read_orders", "read_products", "read_customers"].join(
  ","
);

interface ShopifyTokenResponse {
  access_token?: string;
  scope?: string;
}

async function getShopifyConfig(
  workspaceId: string,
  serverId: string
): Promise<{ shopDomain: string }> {
  const db = await database();
  const pk = `mcp-servers/${workspaceId}/${serverId}`;
  const server = await db["mcp-server"].get(pk, "server");
  if (!server) {
    throw new Error(`MCP server ${serverId} not found`);
  }
  if (server.authType !== "oauth" || server.serviceType !== "shopify") {
    throw new Error(`MCP server ${serverId} is not a Shopify OAuth server`);
  }
  const config = server.config as {
    shopDomain?: string;
  };
  if (!config.shopDomain) {
    throw new Error("Shopify shop domain is missing from MCP server config");
  }
  return {
    shopDomain: assertValidShopifyShopDomain(config.shopDomain),
  };
}

function buildShopifyBaseUrl(shopDomain: string): string {
  return `https://${shopDomain}`;
}

/**
 * Generate Shopify OAuth authorization URL
 */
export async function generateShopifyAuthUrl(
  workspaceId: string,
  serverId: string,
  state?: string
): Promise<string> {
  const clientId = getDefined(
    process.env.SHOPIFY_OAUTH_CLIENT_ID,
    "SHOPIFY_OAUTH_CLIENT_ID is not set"
  );
  const { shopDomain } = await getShopifyConfig(workspaceId, serverId);
  const redirectUri = buildMcpOAuthCallbackUrl("shopify");
  const stateToken = state || generateMcpOAuthStateToken(workspaceId, serverId);

  const params = new URLSearchParams({
    client_id: clientId,
    scope: SHOPIFY_SCOPES,
    redirect_uri: redirectUri,
    state: stateToken,
    access_mode: "offline",
  });

  return `${buildShopifyBaseUrl(shopDomain)}/admin/oauth/authorize?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeShopifyCode(
  workspaceId: string,
  serverId: string,
  code: string
): Promise<McpOAuthTokenInfo> {
  const clientId = getDefined(
    process.env.SHOPIFY_OAUTH_CLIENT_ID,
    "SHOPIFY_OAUTH_CLIENT_ID is not set"
  );
  const clientSecret = getDefined(
    process.env.SHOPIFY_OAUTH_CLIENT_SECRET,
    "SHOPIFY_OAUTH_CLIENT_SECRET is not set"
  );
  const { shopDomain } = await getShopifyConfig(workspaceId, serverId);

  const response = await fetch(
    `${buildShopifyBaseUrl(shopDomain)}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to exchange Shopify code: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as ShopifyTokenResponse;
  if (!data.access_token) {
    throw new Error("No access token received from Shopify");
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.access_token,
    expiresAt: new Date(Date.now() + ONE_YEAR_MS).toISOString(),
  };
}

/**
 * Refresh Shopify access token (not supported for offline tokens)
 */
export async function refreshShopifyToken(): Promise<McpOAuthTokenInfo> {
  throw new Error(
    "Shopify OAuth does not support refresh tokens. Please reconnect."
  );
}
