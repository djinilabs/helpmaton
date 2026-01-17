import { database } from "../../tables";
import type { McpServerRecord } from "../../tables/schema";

import { isValidPosthogBaseUrl, normalizePosthogBaseUrl } from "./constants";

const POSTHOG_TIMEOUT_MS = 30000;

type PosthogQueryParams = Record<
  string,
  string | number | boolean | Array<string | number | boolean> | undefined
>;

function ensurePosthogServer(server: McpServerRecord): {
  apiKey: string;
  baseUrl: string;
} {
  if (server.serviceType !== "posthog") {
    throw new Error("Invalid PostHog MCP server configuration");
  }

  if (!server.url) {
    throw new Error("PostHog base URL is missing");
  }

  const baseUrl = normalizePosthogBaseUrl(server.url);
  if (!isValidPosthogBaseUrl(baseUrl)) {
    throw new Error(
      "PostHog base URL must be https://us.posthog.com or https://eu.posthog.com"
    );
  }

  const config = server.config as { apiKey?: string };
  if (!config.apiKey) {
    throw new Error("PostHog API key is missing");
  }

  return { apiKey: config.apiKey, baseUrl };
}

async function getPosthogServer(
  workspaceId: string,
  serverId: string
): Promise<McpServerRecord> {
  const db = await database();
  const pk = `mcp-servers/${workspaceId}/${serverId}`;
  const server = await db["mcp-server"].get(pk, "server");

  if (!server) {
    throw new Error("PostHog MCP server not found");
  }

  if (server.workspaceId !== workspaceId) {
    throw new Error("PostHog MCP server does not belong to this workspace");
  }

  return server;
}

function buildPosthogUrl(
  baseUrl: string,
  path: string,
  params?: PosthogQueryParams
): string {
  if (!path.startsWith("/api/")) {
    throw new Error('PostHog API path must start with "/api/"');
  }

  const url = new URL(path, baseUrl);

  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        value.forEach((item) => {
          searchParams.append(key, String(item));
        });
      } else {
        searchParams.append(key, String(value));
      }
    }
    const queryString = searchParams.toString();
    if (queryString) {
      url.search = queryString;
    }
  }

  return url.toString();
}

export async function getPosthogJson<T>(
  workspaceId: string,
  serverId: string,
  path: string,
  params?: PosthogQueryParams
): Promise<T> {
  const server = await getPosthogServer(workspaceId, serverId);
  const { apiKey, baseUrl } = ensurePosthogServer(server);
  const url = buildPosthogUrl(baseUrl, path, params);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), POSTHOG_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorMessage = `${response.status} ${response.statusText}`;
      try {
        const errorData = (await response.json()) as { detail?: string };
        errorMessage = errorData.detail || errorMessage;
      } catch {
        // Ignore JSON parse errors
      }

      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `PostHog authentication failed: ${errorMessage}. Please check your API key.`
        );
      }

      throw new Error(`PostHog API error: ${errorMessage}`);
    }

    return (await response.json()) as T;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("PostHog API request timeout");
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error(`Unexpected PostHog error: ${String(error)}`);
  }
}
