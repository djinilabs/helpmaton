import { createPrivateKey } from "crypto";

import { SignJWT, importPKCS8 } from "jose";

import { getDefined } from "../../../utils";

import { buildMcpOAuthCallbackUrl, generateMcpOAuthStateToken } from "./common";
import type { McpOAuthTokenInfo } from "./types";

/**
 * Error indicating that the user needs to reconnect their GitHub account
 * (e.g., refresh token is invalid or expired)
 */
export class GitHubReconnectError extends Error {
  constructor(message: string = "GitHub refresh token is invalid or expired. Please reconnect your GitHub account.") {
    super(message);
    this.name = "GitHubReconnectError";
  }
}

const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
// GitHub OAuth scopes
// Using 'public_repo' scope for read-only access to public repositories
// Private repository access would require the broader 'repo' scope, but we restrict to public_repo
// for better security alignment with read-only operations
const GITHUB_SCOPES = "public_repo";

export interface GithubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  refresh_token?: string; // May be present if refresh tokens are enabled in OAuth app
  expires_in?: number; // May be present if tokens expire
  refresh_token_expires_in?: number; // May be present if refresh tokens expire
}

/**
 * Generate a JWT for GitHub App authentication as a GitHub App (for installation token flows).
 *
 * This helper is ONLY intended for GitHub App installation token support, where a GitHub App
 * authenticates as itself using a short-lived JWT. It MUST NOT be used in the standard
 * GitHub OAuth web flow (i.e., the authorization code / access token exchange for users).
 *
 * For user OAuth flows, use client_secret authentication instead.
 *
 * @internal This function is exported for potential future use with installation tokens.
 * Currently, it is not used in the OAuth flow implementation.
 */
export async function generateGithubAppJWT(): Promise<string> {
  const appId = getDefined(process.env.GH_APP_ID, "GH_APP_ID is not set");
  const privateKey = getDefined(
    process.env.GH_APP_PRIVATE_KEY,
    "GH_APP_PRIVATE_KEY is not set"
  );

  // Normalize the private key (ensure it has proper line breaks)
  // Handle keys that might be stored as a single line or with escaped newlines
  let normalizedKey = privateKey;

  // If the key doesn't have line breaks, try to add them
  if (!normalizedKey.includes("\n") && !normalizedKey.includes("\\n")) {
    // If it's a base64 string without headers, we can't easily parse it
    // Assume it's already in PEM format but might need line breaks
    normalizedKey = privateKey;
  } else if (normalizedKey.includes("\\n")) {
    // Handle escaped newlines (common in environment variables)
    normalizedKey = normalizedKey.replace(/\\n/g, "\n");
  }

  // Ensure the key has proper PEM headers if missing
  if (!normalizedKey.includes("BEGIN")) {
    // If no headers, assume it's PKCS8 format
    normalizedKey = `-----BEGIN PRIVATE KEY-----\n${normalizedKey.replace(
      /\s/g,
      ""
    )}\n-----END PRIVATE KEY-----`;
  }

  // Import the private key using jose
  // jose can handle PKCS8 format directly, but we also need to support RSA format
  let key;
  try {
    // Try importing as PKCS8 (most common format for GitHub Apps)
    key = await importPKCS8(normalizedKey, "RS256");
  } catch (pkcs8Error) {
    // If that fails, the key might be in RSA format (BEGIN RSA PRIVATE KEY)
    // Convert it to PKCS8 format using Node's crypto module
    try {
      const cryptoKey = createPrivateKey(normalizedKey);
      // Export as PKCS8 PEM format
      const pkcs8Key = cryptoKey.export({
        type: "pkcs8",
        format: "pem",
      }) as string;
      // Now import the converted key
      key = await importPKCS8(pkcs8Key, "RS256");
    } catch {
      // If both fail, the key is invalid
      throw new Error(
        `Failed to import GitHub App private key. Please ensure it's in PKCS8 or RSA format. Original error: ${
          pkcs8Error instanceof Error ? pkcs8Error.message : String(pkcs8Error)
        }`
      );
    }
  }

  // Generate JWT with required claims
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({
    iss: appId, // Use App ID as issuer (can also use Client ID)
    iat: now - 60, // Issued at (60 seconds ago to account for clock skew)
    exp: now + 600, // Expires in 10 minutes (max allowed)
  })
    .setProtectedHeader({ alg: "RS256" })
    .sign(key);

  return jwt;
}

/**
 * Generate GitHub OAuth authorization URL
 */
export function generateGithubAuthUrl(
  workspaceId: string,
  serverId: string,
  state?: string
): string {
  // For GitHub Apps, we can use either App ID or Client ID in the authorization URL
  // Client ID is preferred for the OAuth flow
  const clientId = getDefined(
    process.env.GH_APP_CLIENT_ID || process.env.GH_APP_ID,
    "GH_APP_CLIENT_ID or GH_APP_ID is not set"
  );
  const redirectUri = buildMcpOAuthCallbackUrl("github");
  const stateToken = state || generateMcpOAuthStateToken(workspaceId, serverId);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: GITHUB_SCOPES,
    state: stateToken,
  });

  return `${GITHUB_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeGithubCode(
  code: string
): Promise<McpOAuthTokenInfo> {
  const clientId = getDefined(
    process.env.GH_APP_CLIENT_ID || process.env.GH_APP_ID,
    "GH_APP_CLIENT_ID or GH_APP_ID is not set"
  );
  const clientSecret = getDefined(
    process.env.GH_APP_CLIENT_SECRET,
    "GH_APP_CLIENT_SECRET is not set"
  );
  const redirectUri = buildMcpOAuthCallbackUrl("github");

  // GitHub Apps OAuth flow requires client_secret in the request body
  // JWT authentication is only used for installation tokens, not user OAuth flows
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to exchange GitHub code: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as GithubTokenResponse;

  if (!data.access_token) {
    throw new Error("No access token received from GitHub");
  }

  // Calculate expiration time
  // If expires_in is provided, use it; otherwise assume tokens don't expire (set far future date)
  const expiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000).toISOString()
    : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(); // 1 year from now if no expiration

  // Get refresh token if available, otherwise use access token as fallback
  const refreshToken = data.refresh_token || data.access_token;

  // Get user email from GitHub API
  let email: string | undefined;
  try {
    const userInfoResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${data.access_token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });
    if (userInfoResponse.ok) {
      const userInfo = (await userInfoResponse.json()) as {
        email?: string;
        login?: string;
      };
      email = userInfo.email || userInfo.login;
    }
  } catch {
    // Email fetch is optional, continue without it
  }

  return {
    accessToken: data.access_token,
    refreshToken,
    expiresAt,
    email,
  };
}

/**
 * Refresh GitHub access token
 * If a refresh token is available, uses it to get a new access token.
 * Otherwise, returns the same token (for backward compatibility with non-expiring tokens).
 */
export async function refreshGithubToken(
  refreshToken: string
): Promise<McpOAuthTokenInfo> {
  const clientId = getDefined(
    process.env.GH_APP_CLIENT_ID || process.env.GH_APP_ID,
    "GH_APP_CLIENT_ID or GH_APP_ID is not set"
  );
  const clientSecret = getDefined(
    process.env.GH_APP_CLIENT_SECRET,
    "GH_APP_CLIENT_SECRET is not set"
  );

  // GitHub Apps OAuth refresh flow requires client_secret in the request body
  // JWT authentication is only used for installation tokens, not user OAuth flows
  // Check if this looks like a refresh token (longer, different format) or an access token
  // If it's the same as what we'd use as a fallback, it might be an access token
  // Try to refresh it first, and if that fails, assume it's a non-expiring token
  try {
    const response = await fetch(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (response.ok) {
      const data = (await response.json()) as GithubTokenResponse;

      if (!data.access_token) {
        throw new Error("No access token received from GitHub refresh");
      }

      // Calculate expiration time
      const expiresAt = data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000).toISOString()
        : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

      // Use new refresh token if provided, otherwise keep the existing one
      const newRefreshToken = data.refresh_token || refreshToken;

      return {
        accessToken: data.access_token,
        refreshToken: newRefreshToken,
        expiresAt,
      };
    }

    // If refresh fails, parse the error response
    let errorMessage = `Failed to refresh GitHub token: ${response.status}`;
    let specificError: Error | null = null;
    try {
      const errorData = (await response.json()) as {
        error?: string;
        error_description?: string;
      };
      if (
        errorData.error === "invalid_grant" ||
        errorData.error === "invalid_request"
      ) {
        // This could mean:
        // 1. The refresh token is invalid/expired
        // 2. This is actually an access token (non-expiring token scenario)
        specificError = new GitHubReconnectError();
      } else if (errorData.error_description) {
        errorMessage = errorData.error_description;
      } else if (errorData.error) {
        errorMessage = `${errorMessage} - ${errorData.error}`;
      }
    } catch (jsonError) {
      // Only catch JSON parsing errors, not intentional throws
      // Check if this is our specific error class
      if (jsonError instanceof GitHubReconnectError) {
        // This is our intentional error, re-throw it
        throw jsonError;
      }
      // If JSON parsing fails, try to get text
      // Note: response.json() may have consumed the body, so this might fail
      try {
        const errorText = await response.text();
        errorMessage = `${errorMessage} ${errorText}`;
      } catch {
        // Ignore text parsing errors (body may already be consumed)
      }
    }

    // If we have a specific error, throw it instead of the generic one
    if (specificError) {
      throw specificError;
    }

    throw new Error(errorMessage);
  } catch (error) {
    // Re-throw if it's already our specific error class
    if (error instanceof GitHubReconnectError) {
      throw error;
    }
    // Otherwise, wrap it in a helpful error
    throw new Error(
      `GitHub token refresh failed. Please reconnect your GitHub account if the issue persists. Original error: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
