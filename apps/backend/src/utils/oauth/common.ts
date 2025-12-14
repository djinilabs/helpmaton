import { randomBytes } from "crypto";

import { getDefined } from "../../utils";

/**
 * Generate a state token for OAuth flow with workspaceId encoded
 */
export function generateStateToken(workspaceId: string): string {
  const random = randomBytes(16).toString("base64url");
  const timestamp = Date.now().toString(36);
  // Encode workspaceId and timestamp in state token
  const encoded = Buffer.from(
    JSON.stringify({ workspaceId, timestamp, random })
  ).toString("base64url");
  return encoded;
}

/**
 * Validate and extract workspaceId from state token
 * Returns the workspaceId if valid, null otherwise
 */
export function validateAndExtractStateToken(
  state: string
): { workspaceId: string } | null {
  try {
    const decoded = JSON.parse(
      Buffer.from(state, "base64url").toString("utf-8")
    ) as { workspaceId: string; timestamp: string; random: string };
    
    // Check if token is not too old (1 hour)
    const timestamp = parseInt(decoded.timestamp, 36);
    const age = Date.now() - timestamp;
    if (age > 60 * 60 * 1000) {
      return null;
    }
    
    return { workspaceId: decoded.workspaceId };
  } catch {
    return null;
  }
}

/**
 * Validate state token with workspaceId (for backward compatibility)
 * @deprecated Use validateAndExtractStateToken instead
 */
export function validateStateToken(
  state: string,
  workspaceId: string
): boolean {
  const extracted = validateAndExtractStateToken(state);
  return extracted !== null && extracted.workspaceId === workspaceId;
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
 * Build OAuth callback URL (fixed, no workspaceId in path)
 * The workspaceId is encoded in the state token instead
 */
export function buildCallbackUrl(
  provider: "gmail" | "outlook"
): string {
  const baseUrl = getOAuthRedirectBaseUrl();
  return `${baseUrl}/api/email/oauth/${provider}/callback`;
}

