import { randomBytes } from "crypto";

import { getDefined } from "../../../utils";

import type { McpOAuthStatePayload } from "./types";

/**
 * Generate a state token for MCP OAuth flow with workspaceId and serverId encoded
 */
export function generateMcpOAuthStateToken(
  workspaceId: string,
  serverId: string
): string {
  const random = randomBytes(16).toString("base64url");
  const timestamp = Date.now().toString(36);
  // Encode workspaceId, serverId and timestamp in state token
  const payload: McpOAuthStatePayload = {
    workspaceId,
    serverId,
    timestamp,
    random,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return encoded;
}

/**
 * Validate and extract workspaceId and serverId from MCP OAuth state token
 * Returns the payload if valid, null otherwise
 */
export function validateAndExtractMcpOAuthStateToken(
  state: string
): McpOAuthStatePayload | null {
  try {
    const decoded = JSON.parse(
      Buffer.from(state, "base64url").toString("utf-8")
    ) as McpOAuthStatePayload;

    // Check if token is not too old (1 hour)
    const timestamp = parseInt(decoded.timestamp, 36);
    const age = Date.now() - timestamp;
    if (age > 60 * 60 * 1000) {
      return null;
    }

    // Validate required fields
    if (!decoded.workspaceId || !decoded.serverId) {
      return null;
    }

    return decoded;
  } catch {
    return null;
  }
}

/**
 * Get the OAuth redirect base URL from environment
 * Normalizes the URL by removing trailing slashes
 */
export function getOAuthRedirectBaseUrl(): string {
  const baseUrl = getDefined(
    process.env.OAUTH_REDIRECT_BASE_URL,
    "OAUTH_REDIRECT_BASE_URL is not set"
  );
  // Remove trailing slash if present to avoid double slashes
  return baseUrl.replace(/\/+$/, "");
}

/**
 * Build OAuth callback URL for MCP servers
 * The workspaceId and serverId are encoded in the state token
 */
export function buildMcpOAuthCallbackUrl(serviceType: string): string {
  const baseUrl = getOAuthRedirectBaseUrl();
  return `${baseUrl}/api/mcp/oauth/${serviceType}/callback`;
}
