import {
  ensureValidToken,
  getOAuthTokens,
  updateOAuthTokens,
} from "../googleApi/oauth";
import type { RefreshTokenFunction } from "../googleApi/oauth";
import { refreshHubspotToken } from "../oauth/mcp/hubspot";

const HUBSPOT_API_BASE = "https://api.hubapi.com";

interface HubspotApiError {
  message?: string;
}

async function makeHubspotApiRequest<T>(
  workspaceId: string,
  serverId: string,
  url: string,
  options: RequestInit = {},
  attempt: number = 0
): Promise<T> {
  let tokens = await getOAuthTokens(workspaceId, serverId);
  const refreshTokenFn: RefreshTokenFunction = refreshHubspotToken;
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
        "Content-Type": "application/json",
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
      return makeHubspotApiRequest<T>(
        workspaceId,
        serverId,
        url,
        {
          ...options,
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            "Content-Type": "application/json",
            ...options.headers,
          },
        },
        attempt + 1
      );
    }

    if (!response.ok) {
      let errorMessage = `${response.status} ${response.statusText}`;
      try {
        const errorData = (await response.json()) as HubspotApiError;
        if (errorData.message) {
          errorMessage = errorData.message;
        }
      } catch {
        // Ignore JSON parse errors
      }

      if (response.status === 404) {
        throw new Error(`HubSpot resource not found: ${errorMessage}`);
      }

      if (response.status === 403) {
        throw new Error(
          `HubSpot API access forbidden: ${errorMessage}. Please check your HubSpot permissions.`
        );
      }

      throw new Error(`HubSpot API error: ${errorMessage}`);
    }

    return (await response.json()) as T;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("HubSpot API request timeout");
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error(`Unexpected error: ${String(error)}`);
  }
}

function buildPropertiesParam(properties?: string[]): string | undefined {
  if (!properties || properties.length === 0) {
    return undefined;
  }
  return properties.join(",");
}

function buildListParams(options?: {
  limit?: number;
  after?: string;
  properties?: string[];
  archived?: boolean;
}) {
  const params = new URLSearchParams();
  if (options?.limit !== undefined) {
    params.set("limit", options.limit.toString());
  }
  if (options?.after) {
    params.set("after", options.after);
  }
  const propertiesParam = buildPropertiesParam(options?.properties);
  if (propertiesParam) {
    params.set("properties", propertiesParam);
  }
  if (options?.archived !== undefined) {
    params.set("archived", options.archived ? "true" : "false");
  }
  return params;
}

export async function listContacts(
  workspaceId: string,
  serverId: string,
  options?: {
    limit?: number;
    after?: string;
    properties?: string[];
    archived?: boolean;
  }
) {
  const params = buildListParams(options);
  const url = `${HUBSPOT_API_BASE}/crm/v3/objects/contacts${
    params.toString() ? `?${params.toString()}` : ""
  }`;
  return makeHubspotApiRequest(workspaceId, serverId, url);
}

export async function getContact(
  workspaceId: string,
  serverId: string,
  contactId: string,
  options?: {
    properties?: string[];
    archived?: boolean;
  }
) {
  const params = buildListParams({
    properties: options?.properties,
    archived: options?.archived,
  });
  const url = `${HUBSPOT_API_BASE}/crm/v3/objects/contacts/${contactId}${
    params.toString() ? `?${params.toString()}` : ""
  }`;
  return makeHubspotApiRequest(workspaceId, serverId, url);
}

export async function searchContacts(
  workspaceId: string,
  serverId: string,
  options: {
    query: string;
    limit?: number;
    after?: string;
    properties?: string[];
    archived?: boolean;
  }
) {
  const url = `${HUBSPOT_API_BASE}/crm/v3/objects/contacts/search`;
  return makeHubspotApiRequest(workspaceId, serverId, url, {
    method: "POST",
    body: JSON.stringify({
      query: options.query,
      limit: options.limit,
      after: options.after,
      properties: options.properties,
      archived: options.archived,
    }),
  });
}

export async function listCompanies(
  workspaceId: string,
  serverId: string,
  options?: {
    limit?: number;
    after?: string;
    properties?: string[];
    archived?: boolean;
  }
) {
  const params = buildListParams(options);
  const url = `${HUBSPOT_API_BASE}/crm/v3/objects/companies${
    params.toString() ? `?${params.toString()}` : ""
  }`;
  return makeHubspotApiRequest(workspaceId, serverId, url);
}

export async function getCompany(
  workspaceId: string,
  serverId: string,
  companyId: string,
  options?: {
    properties?: string[];
    archived?: boolean;
  }
) {
  const params = buildListParams({
    properties: options?.properties,
    archived: options?.archived,
  });
  const url = `${HUBSPOT_API_BASE}/crm/v3/objects/companies/${companyId}${
    params.toString() ? `?${params.toString()}` : ""
  }`;
  return makeHubspotApiRequest(workspaceId, serverId, url);
}

export async function searchCompanies(
  workspaceId: string,
  serverId: string,
  options: {
    query: string;
    limit?: number;
    after?: string;
    properties?: string[];
    archived?: boolean;
  }
) {
  const url = `${HUBSPOT_API_BASE}/crm/v3/objects/companies/search`;
  return makeHubspotApiRequest(workspaceId, serverId, url, {
    method: "POST",
    body: JSON.stringify({
      query: options.query,
      limit: options.limit,
      after: options.after,
      properties: options.properties,
      archived: options.archived,
    }),
  });
}

export async function listDeals(
  workspaceId: string,
  serverId: string,
  options?: {
    limit?: number;
    after?: string;
    properties?: string[];
    archived?: boolean;
  }
) {
  const params = buildListParams(options);
  const url = `${HUBSPOT_API_BASE}/crm/v3/objects/deals${
    params.toString() ? `?${params.toString()}` : ""
  }`;
  return makeHubspotApiRequest(workspaceId, serverId, url);
}

export async function getDeal(
  workspaceId: string,
  serverId: string,
  dealId: string,
  options?: {
    properties?: string[];
    archived?: boolean;
  }
) {
  const params = buildListParams({
    properties: options?.properties,
    archived: options?.archived,
  });
  const url = `${HUBSPOT_API_BASE}/crm/v3/objects/deals/${dealId}${
    params.toString() ? `?${params.toString()}` : ""
  }`;
  return makeHubspotApiRequest(workspaceId, serverId, url);
}

export async function searchDeals(
  workspaceId: string,
  serverId: string,
  options: {
    query: string;
    limit?: number;
    after?: string;
    properties?: string[];
    archived?: boolean;
  }
) {
  const url = `${HUBSPOT_API_BASE}/crm/v3/objects/deals/search`;
  return makeHubspotApiRequest(workspaceId, serverId, url, {
    method: "POST",
    body: JSON.stringify({
      query: options.query,
      limit: options.limit,
      after: options.after,
      properties: options.properties,
      archived: options.archived,
    }),
  });
}

export async function listOwners(
  workspaceId: string,
  serverId: string,
  options?: {
    limit?: number;
    after?: string;
    email?: string;
  }
) {
  const params = new URLSearchParams();
  if (options?.limit !== undefined) {
    params.set("limit", options.limit.toString());
  }
  if (options?.after) {
    params.set("after", options.after);
  }
  if (options?.email) {
    params.set("email", options.email);
  }
  const url = `${HUBSPOT_API_BASE}/crm/v3/owners${
    params.toString() ? `?${params.toString()}` : ""
  }`;
  return makeHubspotApiRequest(workspaceId, serverId, url);
}

export async function getOwner(
  workspaceId: string,
  serverId: string,
  ownerId: string
) {
  const url = `${HUBSPOT_API_BASE}/crm/v3/owners/${ownerId}`;
  return makeHubspotApiRequest(workspaceId, serverId, url);
}
