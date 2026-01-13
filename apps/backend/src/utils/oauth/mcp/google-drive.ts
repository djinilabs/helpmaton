import { getDefined } from "../../../utils";

import {
  buildMcpOAuthCallbackUrl,
  generateMcpOAuthStateToken,
} from "./common";
import type { McpOAuthTokenInfo } from "./types";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
// Google Drive API scopes
const GOOGLE_DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly", // Read-only access to Drive files
  "https://www.googleapis.com/auth/drive.metadata.readonly", // Read metadata
].join(" ");

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string; // May not be present if refresh token already exists
  expires_in: number;
  token_type: string;
}

/**
 * Generate Google Drive OAuth authorization URL
 */
export function generateGoogleDriveAuthUrl(
  workspaceId: string,
  serverId: string,
  state?: string
): string {
  const clientId = getDefined(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    "GOOGLE_OAUTH_CLIENT_ID is not set"
  );
  const redirectUri = buildMcpOAuthCallbackUrl("google-drive");
  const stateToken = state || generateMcpOAuthStateToken(workspaceId, serverId);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_DRIVE_SCOPES,
    access_type: "offline",
    prompt: "consent", // Force consent to get refresh token
    state: stateToken,
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeGoogleDriveCode(
  code: string
): Promise<McpOAuthTokenInfo> {
  const clientId = getDefined(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    "GOOGLE_OAUTH_CLIENT_ID is not set"
  );
  const clientSecret = getDefined(
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    "GOOGLE_OAUTH_CLIENT_SECRET is not set"
  );
  const redirectUri = buildMcpOAuthCallbackUrl("google-drive");

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to exchange Google Drive code: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as GoogleTokenResponse;

  // Calculate expiration time
  const expiresAt = new Date(
    Date.now() + data.expires_in * 1000
  ).toISOString();

  // Get user email from Google API
  let email: string | undefined;
  try {
    const userInfoResponse = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: {
          Authorization: `Bearer ${data.access_token}`,
        },
      }
    );
    if (userInfoResponse.ok) {
      const userInfo = (await userInfoResponse.json()) as { email?: string };
      email = userInfo.email;
    }
  } catch {
    // Email fetch is optional, continue without it
  }

  // Refresh token may not be present if it was already issued
  // In that case, we need to handle it (the caller should check)
  if (!data.refresh_token) {
    throw new Error(
      "No refresh token received. Please revoke access and reconnect."
    );
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
    email,
  };
}

/**
 * Refresh Google Drive access token
 */
export async function refreshGoogleDriveToken(
  refreshToken: string
): Promise<McpOAuthTokenInfo> {
  const clientId = getDefined(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    "GOOGLE_OAUTH_CLIENT_ID is not set"
  );
  const clientSecret = getDefined(
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    "GOOGLE_OAUTH_CLIENT_SECRET is not set"
  );

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to refresh Google Drive token: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as Omit<
    GoogleTokenResponse,
    "refresh_token"
  >;

  // Calculate expiration time
  const expiresAt = new Date(
    Date.now() + data.expires_in * 1000
  ).toISOString();

  return {
    accessToken: data.access_token,
    refreshToken, // Keep the existing refresh token
    expiresAt,
  };
}
