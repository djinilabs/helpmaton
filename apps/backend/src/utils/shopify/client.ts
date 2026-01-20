import { database } from "../../tables";
import { ensureValidToken, getOAuthTokens } from "../googleApi/oauth";
import type { RefreshTokenFunction } from "../googleApi/oauth";
import { refreshShopifyToken } from "../oauth/mcp/shopify";

import { assertValidShopifyShopDomain } from "./utils";

const SHOPIFY_API_VERSION = "2024-01";

interface ShopifyApiError {
  errors?: string | string[];
}

async function getShopifyShopDomain(
  workspaceId: string,
  serverId: string
): Promise<string> {
  const db = await database();
  const pk = `mcp-servers/${workspaceId}/${serverId}`;
  const server = await db["mcp-server"].get(pk, "server");

  if (!server) {
    throw new Error(`MCP server ${serverId} not found`);
  }

  if (server.authType !== "oauth" || server.serviceType !== "shopify") {
    throw new Error(`MCP server ${serverId} is not a Shopify OAuth server`);
  }

  const config = server.config as { shopDomain?: string };
  if (!config.shopDomain) {
    throw new Error("Shopify shop domain is missing from MCP server config");
  }

  return assertValidShopifyShopDomain(config.shopDomain);
}

function buildShopifyApiBase(shopDomain: string): string {
  return `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}`;
}

async function makeShopifyApiRequest<T>(
  workspaceId: string,
  serverId: string,
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const tokens = await getOAuthTokens(workspaceId, serverId);
  const refreshTokenFn: RefreshTokenFunction = refreshShopifyToken;
  const accessToken = await ensureValidToken(
    workspaceId,
    serverId,
    tokens,
    refreshTokenFn
  );

  const shopDomain = await getShopifyShopDomain(workspaceId, serverId);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${buildShopifyApiBase(shopDomain)}${path}`, {
      ...options,
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...options.headers,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 401) {
      throw new Error(
        "Shopify authentication failed. Please reconnect your Shopify account."
      );
    }

    if (!response.ok) {
      let errorMessage = `${response.status} ${response.statusText}`;
      try {
        const errorData = (await response.json()) as ShopifyApiError;
        if (errorData.errors) {
          errorMessage = Array.isArray(errorData.errors)
            ? errorData.errors.join(", ")
            : errorData.errors;
        }
      } catch {
        // Ignore parse errors
      }

      if (response.status === 404) {
        throw new Error(`Shopify resource not found: ${errorMessage}`);
      }

      if (response.status === 403) {
        throw new Error(
          `Shopify API access forbidden: ${errorMessage}. Please check your OAuth scopes.`
        );
      }

      throw new Error(`Shopify API error: ${errorMessage}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return (await response.text()) as unknown as T;
    }

    return (await response.json()) as T;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Shopify API request timeout");
    }
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Unexpected error: ${String(error)}`);
  }
}

function normalizeOrderNumber(orderNumber: string): string {
  const trimmed = orderNumber.trim();
  return trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
}

export async function getOrderByNumber(
  workspaceId: string,
  serverId: string,
  orderNumber: string
) {
  const normalized = normalizeOrderNumber(orderNumber);
  const params = new URLSearchParams({
    name: normalized,
    status: "any",
  });
  return makeShopifyApiRequest(
    workspaceId,
    serverId,
    `/orders.json?${params.toString()}`
  );
}

export async function searchProductsByTitle(
  workspaceId: string,
  serverId: string,
  query: string
) {
  const params = new URLSearchParams({
    title: query,
  });
  return makeShopifyApiRequest(
    workspaceId,
    serverId,
    `/products.json?${params.toString()}`
  );
}

export async function getSalesReport(
  workspaceId: string,
  serverId: string,
  options: {
    startDate: string;
    endDate: string;
    limit?: number;
  }
) {
  const params = new URLSearchParams({
    status: "any",
    created_at_min: new Date(options.startDate).toISOString(),
    created_at_max: new Date(options.endDate).toISOString(),
  });
  const fieldsParams = new URLSearchParams({
    status: "any",
    created_at_min: new Date(options.startDate).toISOString(),
    created_at_max: new Date(options.endDate).toISOString(),
    fields: "id,total_price,currency",
    limit: String(options.limit ?? 250),
  });

  const [countResult, ordersResult] = await Promise.all([
    makeShopifyApiRequest<{ count?: number }>(
      workspaceId,
      serverId,
      `/orders/count.json?${params.toString()}`
    ),
    makeShopifyApiRequest<{ orders?: Array<{ total_price?: string; currency?: string }> }>(
      workspaceId,
      serverId,
      `/orders.json?${fieldsParams.toString()}`
    ),
  ]);

  const orders = ordersResult.orders ?? [];
  const grossSales = orders.reduce((sum, order) => {
    const amount = order.total_price ? Number(order.total_price) : 0;
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);

  const currency = orders.find((order) => order.currency)?.currency ?? null;

  return {
    count: countResult.count ?? 0,
    grossSales,
    currency,
    ordersFetched: orders.length,
  };
}
