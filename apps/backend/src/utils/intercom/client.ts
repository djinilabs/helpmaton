import {
  ensureValidToken,
  getOAuthTokens,
} from "../googleApi/oauth";
import type { RefreshTokenFunction } from "../googleApi/oauth";
import { refreshIntercomToken } from "../oauth/mcp/intercom";

const INTERCOM_API_BASE = "https://api.intercom.io";

interface IntercomApiErrorResponse {
  errors?: Array<{ message?: string }>;
  error?: string;
}

function buildPaginationParams(options?: {
  perPage?: number;
  startingAfter?: string;
}): URLSearchParams {
  const params = new URLSearchParams();
  if (options?.perPage !== undefined) {
    params.set("per_page", options.perPage.toString());
  }
  if (options?.startingAfter) {
    params.set("starting_after", options.startingAfter);
  }
  return params;
}

function buildPaginationPayload(options?: {
  perPage?: number;
  startingAfter?: string;
}): Record<string, number | string> | undefined {
  if (!options?.perPage && !options?.startingAfter) {
    return undefined;
  }
  const payload: Record<string, number | string> = {};
  if (options?.perPage !== undefined) {
    payload.per_page = options.perPage;
  }
  if (options?.startingAfter) {
    payload.starting_after = options.startingAfter;
  }
  return payload;
}

async function makeIntercomApiRequest<T>(
  workspaceId: string,
  serverId: string,
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const tokens = await getOAuthTokens(workspaceId, serverId);
  const refreshTokenFn: RefreshTokenFunction = refreshIntercomToken;
  const accessToken = await ensureValidToken(
    workspaceId,
    serverId,
    tokens,
    refreshTokenFn
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${INTERCOM_API_BASE}${path}`, {
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
        "Intercom authentication failed. Please reconnect your Intercom account."
      );
    }

    if (!response.ok) {
      let errorMessage = `${response.status} ${response.statusText}`;
      try {
        const errorData = (await response.json()) as IntercomApiErrorResponse;
        if (errorData.errors?.length) {
          errorMessage = errorData.errors
            .map((err) => err.message)
            .filter(Boolean)
            .join("; ");
        } else if (errorData.error) {
          errorMessage = errorData.error;
        }
      } catch {
        // Ignore JSON parse errors
      }

      if (response.status === 404) {
        throw new Error(`Intercom resource not found: ${errorMessage}`);
      }

      if (response.status === 403) {
        throw new Error(
          `Intercom API access forbidden: ${errorMessage}. Please check your Intercom OAuth scopes.`
        );
      }

      throw new Error(`Intercom API error: ${errorMessage}`);
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
      throw new Error("Intercom API request timeout");
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error(`Unexpected error: ${String(error)}`);
  }
}

export async function getCurrentAdmin(
  workspaceId: string,
  serverId: string
) {
  return makeIntercomApiRequest<{ id?: string; type?: string }>(
    workspaceId,
    serverId,
    "/me"
  );
}

export async function listContacts(
  workspaceId: string,
  serverId: string,
  options?: { perPage?: number; startingAfter?: string }
) {
  const params = buildPaginationParams(options);
  const query = params.toString() ? `?${params.toString()}` : "";
  return makeIntercomApiRequest(
    workspaceId,
    serverId,
    `/contacts${query}`
  );
}

export async function getContact(
  workspaceId: string,
  serverId: string,
  contactId: string
) {
  return makeIntercomApiRequest(
    workspaceId,
    serverId,
    `/contacts/${contactId}`
  );
}

export async function searchContacts(
  workspaceId: string,
  serverId: string,
  options: {
    query: Record<string, unknown>;
    pagination?: { perPage?: number; startingAfter?: string };
  }
) {
  const payload: Record<string, unknown> = {
    query: options.query,
  };
  const pagination = buildPaginationPayload(options.pagination);
  if (pagination) {
    payload.pagination = pagination;
  }
  return makeIntercomApiRequest(workspaceId, serverId, "/contacts/search", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateContact(
  workspaceId: string,
  serverId: string,
  contactId: string,
  updates: Record<string, unknown>
) {
  return makeIntercomApiRequest(
    workspaceId,
    serverId,
    `/contacts/${contactId}`,
    {
      method: "PUT",
      body: JSON.stringify(updates),
    }
  );
}

export async function listConversations(
  workspaceId: string,
  serverId: string,
  options?: { perPage?: number; startingAfter?: string }
) {
  const params = buildPaginationParams(options);
  const query = params.toString() ? `?${params.toString()}` : "";
  return makeIntercomApiRequest(
    workspaceId,
    serverId,
    `/conversations${query}`
  );
}

export async function getConversation(
  workspaceId: string,
  serverId: string,
  conversationId: string
) {
  return makeIntercomApiRequest(
    workspaceId,
    serverId,
    `/conversations/${conversationId}`
  );
}

export async function searchConversations(
  workspaceId: string,
  serverId: string,
  options: {
    query: Record<string, unknown>;
    pagination?: { perPage?: number; startingAfter?: string };
  }
) {
  const payload: Record<string, unknown> = {
    query: options.query,
  };
  const pagination = buildPaginationPayload(options.pagination);
  if (pagination) {
    payload.pagination = pagination;
  }
  return makeIntercomApiRequest(workspaceId, serverId, "/conversations/search", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function replyConversation(
  workspaceId: string,
  serverId: string,
  conversationId: string,
  payload: Record<string, unknown>
) {
  return makeIntercomApiRequest(
    workspaceId,
    serverId,
    `/conversations/${conversationId}/reply`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
}
