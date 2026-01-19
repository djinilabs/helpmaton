import { database } from "../../tables";
import {
  ensureValidToken,
  getOAuthTokens,
} from "../googleApi/oauth";
import type { RefreshTokenFunction } from "../googleApi/oauth";
import { refreshZendeskToken } from "../oauth/mcp/zendesk";

interface ZendeskApiError {
  error?: string;
  description?: string;
}

async function getZendeskSubdomain(
  workspaceId: string,
  serverId: string
): Promise<string> {
  const db = await database();
  const pk = `mcp-servers/${workspaceId}/${serverId}`;
  const server = await db["mcp-server"].get(pk, "server");

  if (!server) {
    throw new Error(`MCP server ${serverId} not found`);
  }

  if (server.authType !== "oauth" || server.serviceType !== "zendesk") {
    throw new Error(`MCP server ${serverId} is not a Zendesk OAuth server`);
  }

  const config = server.config as { subdomain?: string };
  if (!config.subdomain) {
    throw new Error("Zendesk subdomain is missing from MCP server config");
  }

  return config.subdomain;
}

function buildZendeskBaseUrl(subdomain: string): string {
  return `https://${subdomain}.zendesk.com`;
}

async function makeZendeskApiRequest<T>(
  workspaceId: string,
  serverId: string,
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const tokens = await getOAuthTokens(workspaceId, serverId);
  const refreshTokenFn: RefreshTokenFunction = (refreshToken) =>
    refreshZendeskToken(workspaceId, serverId, refreshToken);
  const accessToken = await ensureValidToken(
    workspaceId,
    serverId,
    tokens,
    refreshTokenFn
  );

  const subdomain = await getZendeskSubdomain(workspaceId, serverId);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${buildZendeskBaseUrl(subdomain)}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...options.headers,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 401) {
      throw new Error(
        "Zendesk authentication failed. Please reconnect your Zendesk account."
      );
    }

    if (!response.ok) {
      let errorMessage = `${response.status} ${response.statusText}`;
      try {
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const errorData = (await response.json()) as ZendeskApiError;
          errorMessage =
            errorData.description ||
            errorData.error ||
            errorMessage;
        } else {
          errorMessage = await response.text();
        }
      } catch {
        // Ignore parse errors
      }

      if (response.status === 404) {
        throw new Error(`Zendesk resource not found: ${errorMessage}`);
      }

      if (response.status === 403) {
        throw new Error(
          `Zendesk API access forbidden: ${errorMessage}. Please check your OAuth scopes.`
        );
      }

      throw new Error(`Zendesk API error: ${errorMessage}`);
    }

    if (response.status === 204) {
      return {} as T;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return (await response.text()) as unknown as T;
    }

    return (await response.json()) as T;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Zendesk API request timeout");
    }
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Unexpected error: ${String(error)}`);
  }
}

export async function searchZendeskTickets(
  workspaceId: string,
  serverId: string,
  query: string
) {
  const encodedQuery = encodeURIComponent(query);
  return makeZendeskApiRequest(
    workspaceId,
    serverId,
    `/api/v2/search.json?query=${encodedQuery}`
  );
}

export async function getZendeskTicketComments(
  workspaceId: string,
  serverId: string,
  ticketId: string
) {
  return makeZendeskApiRequest(
    workspaceId,
    serverId,
    `/api/v2/tickets/${encodeURIComponent(ticketId)}/comments.json`
  );
}

export async function draftZendeskTicketComment(
  workspaceId: string,
  serverId: string,
  ticketId: string,
  body: string
) {
  return makeZendeskApiRequest(
    workspaceId,
    serverId,
    `/api/v2/tickets/${encodeURIComponent(ticketId)}.json`,
    {
      method: "PUT",
      body: JSON.stringify({
        ticket: {
          comment: {
            body,
            public: false,
          },
        },
      }),
    }
  );
}

export async function searchZendeskHelpCenter(
  workspaceId: string,
  serverId: string,
  query: string
) {
  const encodedQuery = encodeURIComponent(query);
  return makeZendeskApiRequest(
    workspaceId,
    serverId,
    `/api/v2/help_center/articles/search.json?query=${encodedQuery}`
  );
}
