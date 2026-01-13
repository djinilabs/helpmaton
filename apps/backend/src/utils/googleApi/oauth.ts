import { database } from "../../tables";

/**
 * OAuth token information from mcp-server config
 */
export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

/**
 * Token refresh function type
 */
export type RefreshTokenFunction = (refreshToken: string) => Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}>;

/**
 * Get OAuth tokens from mcp-server config
 */
export async function getOAuthTokens(
  workspaceId: string,
  serverId: string
): Promise<OAuthTokens> {
  const db = await database();
  const pk = `mcp-servers/${workspaceId}/${serverId}`;
  const server = await db["mcp-server"].get(pk, "server");

  if (!server) {
    throw new Error(`MCP server ${serverId} not found`);
  }

  if (server.authType !== "oauth") {
    throw new Error(`MCP server ${serverId} is not an OAuth server`);
  }

  const config = server.config as {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: string;
  };

  if (!config.accessToken || !config.refreshToken) {
    throw new Error(`OAuth tokens not found for MCP server ${serverId}`);
  }

  return {
    accessToken: config.accessToken,
    refreshToken: config.refreshToken,
    expiresAt: config.expiresAt || new Date().toISOString(),
  };
}

/**
 * Update OAuth tokens in mcp-server config
 */
export async function updateOAuthTokens(
  workspaceId: string,
  serverId: string,
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
  }
): Promise<void> {
  const db = await database();
  const pk = `mcp-servers/${workspaceId}/${serverId}`;
  const server = await db["mcp-server"].get(pk, "server");

  if (!server) {
    throw new Error(`MCP server ${serverId} not found`);
  }

  // Update config with new tokens
  const updatedConfig = {
    ...(server.config as Record<string, unknown>),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
  };

  await db["mcp-server"].update({
    pk,
    sk: "server",
    config: updatedConfig,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Check if token is expired or about to expire (within 1 minute)
 */
export function isTokenExpired(expiresAt: string): boolean {
  const expirationTime = new Date(expiresAt).getTime();
  const now = Date.now();
  const bufferMs = 60 * 1000; // 1 minute buffer
  return now >= expirationTime - bufferMs;
}

/**
 * Refresh access token if expired
 */
export async function ensureValidToken(
  workspaceId: string,
  serverId: string,
  tokens: OAuthTokens,
  refreshTokenFn: RefreshTokenFunction
): Promise<string> {
  // Check if token is expired
  if (isTokenExpired(tokens.expiresAt)) {
    try {
      // Refresh the token
      const refreshed = await refreshTokenFn(tokens.refreshToken);

      // Update tokens in database
      await updateOAuthTokens(workspaceId, serverId, {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
      });

      return refreshed.accessToken;
    } catch (error) {
      throw new Error(
        `Failed to refresh token: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return tokens.accessToken;
}
