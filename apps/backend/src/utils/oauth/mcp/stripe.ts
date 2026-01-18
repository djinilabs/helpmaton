import { getDefined } from "../../../utils";

import {
  buildMcpOAuthCallbackUrl,
  generateMcpOAuthStateToken,
} from "./common";
import type { McpOAuthTokenInfo } from "./types";

const STRIPE_AUTH_URL = "https://connect.stripe.com/oauth/authorize";
const STRIPE_TOKEN_URL = "https://connect.stripe.com/oauth/token";
const STRIPE_SCOPES = "read_only";
const ONE_HOUR_MS = 60 * 60 * 1000;

export interface StripeTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  livemode?: boolean;
  stripe_user_id?: string;
  expires_in?: number;
}

/**
 * Generate Stripe OAuth authorization URL
 */
export function generateStripeAuthUrl(
  workspaceId: string,
  serverId: string,
  state?: string
): string {
  const clientId = getDefined(
    process.env.STRIPE_OAUTH_CLIENT_ID,
    "STRIPE_OAUTH_CLIENT_ID is not set"
  );
  const redirectUri = buildMcpOAuthCallbackUrl("stripe");
  const stateToken = state || generateMcpOAuthStateToken(workspaceId, serverId);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: STRIPE_SCOPES,
    redirect_uri: redirectUri,
    state: stateToken,
  });

  return `${STRIPE_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeStripeCode(
  code: string
): Promise<McpOAuthTokenInfo> {
  const clientId = getDefined(
    process.env.STRIPE_OAUTH_CLIENT_ID,
    "STRIPE_OAUTH_CLIENT_ID is not set"
  );
  const clientSecret = getDefined(
    process.env.STRIPE_OAUTH_CLIENT_SECRET,
    "STRIPE_OAUTH_CLIENT_SECRET is not set"
  );
  const redirectUri = buildMcpOAuthCallbackUrl("stripe");

  const response = await fetch(STRIPE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to exchange Stripe code: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as StripeTokenResponse;
  if (!data.access_token) {
    throw new Error("No access token received from Stripe");
  }

  const expiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000).toISOString()
    : new Date(Date.now() + ONE_HOUR_MS).toISOString();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || data.access_token,
    expiresAt,
  };
}

/**
 * Refresh Stripe access token
 */
export async function refreshStripeToken(
  refreshToken: string
): Promise<McpOAuthTokenInfo> {
  const clientId = getDefined(
    process.env.STRIPE_OAUTH_CLIENT_ID,
    "STRIPE_OAUTH_CLIENT_ID is not set"
  );
  const clientSecret = getDefined(
    process.env.STRIPE_OAUTH_CLIENT_SECRET,
    "STRIPE_OAUTH_CLIENT_SECRET is not set"
  );

  const response = await fetch(STRIPE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to refresh Stripe token: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as StripeTokenResponse;
  if (!data.access_token) {
    throw new Error("No access token received from Stripe refresh");
  }

  const expiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000).toISOString()
    : new Date(Date.now() + ONE_HOUR_MS).toISOString();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt,
  };
}
