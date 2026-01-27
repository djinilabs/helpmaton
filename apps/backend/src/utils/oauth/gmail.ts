import { getDefined } from "../../utils";

import { buildCallbackUrl, generateStateToken } from "./common";

const GMAIL_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GMAIL_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";

export interface GmailTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export interface GmailTokenInfo {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO datetime string
  email?: string;
}

/**
 * Generate Gmail OAuth authorization URL
 */
export function generateGmailAuthUrl(
  workspaceId: string,
  state?: string
): string {
  const clientId = getDefined(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    "GOOGLE_OAUTH_CLIENT_ID is not set"
  );
  const redirectUri = buildCallbackUrl("gmail");
  const stateToken = state || generateStateToken(workspaceId);

  // Log the redirect URI for debugging
  console.log("[Gmail OAuth] Redirect URI:", redirectUri);
  console.log("[Gmail OAuth] Make sure this exact URI is registered in Google Cloud Console");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state: stateToken,
  });

  return `${GMAIL_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeGmailCode(
  code: string
): Promise<GmailTokenInfo> {
  const clientId = getDefined(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    "GOOGLE_OAUTH_CLIENT_ID is not set"
  );
  const clientSecret = getDefined(
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    "GOOGLE_OAUTH_CLIENT_SECRET is not set"
  );
  const redirectUri = buildCallbackUrl("gmail");

  const response = await fetch(GMAIL_TOKEN_URL, {
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
      `Failed to exchange Gmail code: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as GmailTokenResponse;

  // Calculate expiration time
  const expiresAt = new Date(
    Date.now() + data.expires_in * 1000
  ).toISOString();

  // Get user email from Gmail API
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

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
    email,
  };
}

/**
 * Refresh Gmail access token
 */
export async function refreshGmailToken(
  refreshToken: string
): Promise<GmailTokenInfo> {
  const clientId = getDefined(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    "GOOGLE_OAUTH_CLIENT_ID is not set"
  );
  const clientSecret = getDefined(
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    "GOOGLE_OAUTH_CLIENT_SECRET is not set"
  );

  const response = await fetch(GMAIL_TOKEN_URL, {
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
      `Failed to refresh Gmail token: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as Omit<
    GmailTokenResponse,
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

