import {
  ensureValidToken,
  getOAuthTokens,
} from "../googleApi/oauth";
import type { RefreshTokenFunction } from "../googleApi/oauth";
import { refreshTodoistToken } from "../oauth/mcp/todoist";

const TODOIST_API_BASE = "https://api.todoist.com";

interface TodoistApiErrorResponse {
  error?: string;
  error_description?: string;
  message?: string;
}

async function makeTodoistApiRequest<T>(
  workspaceId: string,
  serverId: string,
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const tokens = await getOAuthTokens(workspaceId, serverId);
  const refreshTokenFn: RefreshTokenFunction = refreshTodoistToken;
  const accessToken = await ensureValidToken(
    workspaceId,
    serverId,
    tokens,
    refreshTokenFn
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${TODOIST_API_BASE}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 401) {
      throw new Error(
        "Todoist authentication failed. Please reconnect your Todoist account."
      );
    }

    if (!response.ok) {
      let errorMessage = `${response.status} ${response.statusText}`;
      try {
        const errorData = (await response.json()) as TodoistApiErrorResponse;
        errorMessage =
          errorData.error_description ||
          errorData.error ||
          errorData.message ||
          errorMessage;
      } catch {
        // Ignore JSON parse errors
      }

      if (response.status === 404) {
        throw new Error(`Todoist resource not found: ${errorMessage}`);
      }

      if (response.status === 403) {
        throw new Error(
          `Todoist API access forbidden: ${errorMessage}. Please check your Todoist OAuth scopes.`
        );
      }

      throw new Error(`Todoist API error: ${errorMessage}`);
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
      throw new Error("Todoist API request timeout");
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error(`Unexpected error: ${String(error)}`);
  }
}

export async function listTasks(
  workspaceId: string,
  serverId: string,
  filter?: string
) {
  const query = filter
    ? `?${new URLSearchParams({ filter }).toString()}`
    : "";
  return makeTodoistApiRequest(workspaceId, serverId, `/rest/v2/tasks${query}`);
}

export async function addTask(
  workspaceId: string,
  serverId: string,
  payload: { content: string; due_string?: string; priority?: number }
) {
  const body: Record<string, unknown> = { content: payload.content };
  if (payload.due_string) {
    body.due_string = payload.due_string;
  }
  if (payload.priority !== undefined) {
    body.priority = payload.priority;
  }

  return makeTodoistApiRequest(workspaceId, serverId, "/rest/v2/tasks", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function closeTask(
  workspaceId: string,
  serverId: string,
  taskId: string
) {
  return makeTodoistApiRequest(
    workspaceId,
    serverId,
    `/rest/v2/tasks/${taskId}/close`,
    {
      method: "POST",
    }
  );
}

export async function listProjects(workspaceId: string, serverId: string) {
  return makeTodoistApiRequest(
    workspaceId,
    serverId,
    "/rest/v2/projects"
  );
}
