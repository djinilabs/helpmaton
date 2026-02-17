import {
  ensureValidToken,
  getOAuthTokens,
  updateOAuthTokens,
} from "../googleApi/oauth";
import type { RefreshTokenFunction } from "../googleApi/oauth";
import { refreshStripeToken } from "../oauth/mcp/stripe";

const STRIPE_API_BASE = "https://api.stripe.com";

interface StripeApiError {
  error?: {
    message?: string;
    type?: string;
  };
}

async function makeStripeApiRequest<T>(
  workspaceId: string,
  serverId: string,
  url: string,
  options: RequestInit = {},
  attempt: number = 0
): Promise<T> {
  let tokens = await getOAuthTokens(workspaceId, serverId);
  const refreshTokenFn: RefreshTokenFunction = refreshStripeToken;
  const accessToken = await ensureValidToken(
    workspaceId,
    serverId,
    tokens,
    refreshTokenFn
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...options.headers,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 401 && attempt === 0) {
      const refreshed = await refreshTokenFn(tokens.refreshToken);
      await updateOAuthTokens(workspaceId, serverId, {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
      });

      tokens = await getOAuthTokens(workspaceId, serverId);
      return makeStripeApiRequest<T>(
        workspaceId,
        serverId,
        url,
        {
          ...options,
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            ...options.headers,
          },
        },
        attempt + 1
      );
    }

    if (!response.ok) {
      let errorMessage = `${response.status} ${response.statusText}`;
      try {
        const errorData = (await response.json()) as StripeApiError;
        if (errorData.error?.message) {
          errorMessage = errorData.error.message;
        }
      } catch {
        // Ignore JSON parse errors
      }

      if (response.status === 404) {
        throw new Error(`Stripe resource not found: ${errorMessage}`);
      }

      if (response.status === 403) {
        throw new Error(
          `Stripe API access forbidden: ${errorMessage}. Please check your Stripe permissions.`
        );
      }

      throw new Error(`Stripe API error: ${errorMessage}`);
    }

    return (await response.json()) as T;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Stripe API request timeout");
    }
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Unexpected error: ${String(error)}`);
  }
}

export interface StripeSearchChargesOptions {
  limit?: number;
  page?: string;
}

export interface StripeSearchChargesResponse {
  object: string;
  data: unknown[];
  has_more: boolean;
  next_page?: string;
  url: string;
}

export async function searchCharges(
  workspaceId: string,
  serverId: string,
  query: string,
  options?: StripeSearchChargesOptions
): Promise<StripeSearchChargesResponse> {
  const params = new URLSearchParams({ query });
  if (options?.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  if (options?.page !== undefined && options.page !== "") {
    params.set("page", options.page);
  }
  const url = `${STRIPE_API_BASE}/v1/charges/search?${params.toString()}`;
  return makeStripeApiRequest<StripeSearchChargesResponse>(
    workspaceId,
    serverId,
    url
  );
}

export async function getBalance(workspaceId: string, serverId: string) {
  const url = `${STRIPE_API_BASE}/v1/balance`;
  return makeStripeApiRequest(workspaceId, serverId, url);
}

export async function listRefunds(
  workspaceId: string,
  serverId: string,
  options: {
    createdGte: number;
    createdLte: number;
    limit?: number;
  }
) {
  const params = new URLSearchParams();
  params.set("created[gte]", options.createdGte.toString());
  params.set("created[lte]", options.createdLte.toString());
  if (options.limit !== undefined) {
    params.set("limit", options.limit.toString());
  }
  const url = `${STRIPE_API_BASE}/v1/refunds?${params.toString()}`;
  return makeStripeApiRequest(workspaceId, serverId, url);
}
