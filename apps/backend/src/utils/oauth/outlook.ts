import { getDefined } from "../../utils";

import { buildCallbackUrl, generateStateToken } from "./common";

const OUTLOOK_AUTH_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const OUTLOOK_TOKEN_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token";
// Include offline_access scope to ensure refresh_token is returned
const OUTLOOK_SCOPE = "https://graph.microsoft.com/Mail.Send offline_access";

export interface OutlookTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export interface OutlookTokenInfo {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO datetime string
  email?: string;
}

/**
 * Generate Outlook OAuth authorization URL
 */
export function generateOutlookAuthUrl(
  workspaceId: string,
  state?: string
): string {
  const clientId = getDefined(
    process.env.OUTLOOK_CLIENT_ID,
    "OUTLOOK_CLIENT_ID is not set"
  );
  const redirectUri = buildCallbackUrl("outlook");
  const stateToken = state || generateStateToken(workspaceId);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: OUTLOOK_SCOPE,
    response_mode: "query",
    state: stateToken,
    prompt: "consent", // Force consent to ensure refresh_token is returned
  });

  return `${OUTLOOK_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeOutlookCode(
  code: string
): Promise<OutlookTokenInfo> {
  const clientId = getDefined(
    process.env.OUTLOOK_CLIENT_ID,
    "OUTLOOK_CLIENT_ID is not set"
  );
  const clientSecret = getDefined(
    process.env.OUTLOOK_CLIENT_SECRET,
    "OUTLOOK_CLIENT_SECRET is not set"
  );
  const redirectUri = buildCallbackUrl("outlook");

  const response = await fetch(OUTLOOK_TOKEN_URL, {
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
      scope: OUTLOOK_SCOPE,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to exchange Outlook code: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as OutlookTokenResponse;

  // Log the response to debug missing refresh_token issues
  console.log("[Outlook OAuth] Token exchange response:", {
    hasAccessToken: !!data.access_token,
    hasRefreshToken: !!data.refresh_token,
    expiresIn: data.expires_in,
    tokenType: data.token_type,
  });

  // Microsoft should return refresh_token when offline_access scope is included
  // and prompt=consent is used
  if (!data.refresh_token) {
    console.error("[Outlook OAuth] No refresh_token in response", {
      responseKeys: Object.keys(data),
      hasAccessToken: !!data.access_token,
      expiresIn: data.expires_in,
      fullResponse: data,
      request: {
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: OUTLOOK_SCOPE,
        prompt: "consent",
      },
    });
    throw new Error(
      "No refresh_token received from Microsoft. This is unexpected when using 'prompt: consent' and 'offline_access' scope. Please contact support with this error message."
    );
  }

  // Calculate expiration time
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  // Get user email from Microsoft Graph API
  let email: string | undefined;
  try {
    const userInfoResponse = await fetch(
      "https://graph.microsoft.com/v1.0/me",
      {
        headers: {
          Authorization: `Bearer ${data.access_token}`,
        },
      }
    );
    if (userInfoResponse.ok) {
      const userInfo = (await userInfoResponse.json()) as {
        mail?: string;
        userPrincipalName?: string;
      };
      email = userInfo.mail || userInfo.userPrincipalName;
      console.log("[Outlook OAuth] Retrieved user email:", email);
    } else {
      console.warn("[Outlook OAuth] Failed to retrieve user email:", userInfoResponse.status, await userInfoResponse.text());
    }
  } catch (error) {
    // Email fetch is optional, continue without it
    console.warn("[Outlook OAuth] Error fetching user email:", error);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
    email,
  };
}

/**
 * Refresh Outlook access token
 */
export async function refreshOutlookToken(
  refreshToken: string
): Promise<OutlookTokenInfo> {
  const clientId = getDefined(
    process.env.OUTLOOK_CLIENT_ID,
    "OUTLOOK_CLIENT_ID is not set"
  );
  const clientSecret = getDefined(
    process.env.OUTLOOK_CLIENT_SECRET,
    "OUTLOOK_CLIENT_SECRET is not set"
  );

  const response = await fetch(OUTLOOK_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: OUTLOOK_SCOPE,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to refresh Outlook token: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as Omit<
    OutlookTokenResponse,
    "refresh_token"
  >;

  // Calculate expiration time
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  return {
    accessToken: data.access_token,
    refreshToken, // Keep the existing refresh token
    expiresAt,
  };
}
