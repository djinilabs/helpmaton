/**
 * OAuth token information for MCP servers
 */
export interface McpOAuthTokenInfo {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO datetime string
  email?: string;
}

/**
 * State token payload for MCP OAuth flow
 */
export interface McpOAuthStatePayload {
  workspaceId: string;
  serverId: string;
  timestamp: string;
  random: string;
}
