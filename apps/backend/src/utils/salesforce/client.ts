import { database } from "../../tables";
import { isTokenExpired } from "../googleApi/oauth";
import { refreshSalesforceToken } from "../oauth/mcp/salesforce";

const SALESFORCE_API_VERSION = "v60.0";
const REQUEST_TIMEOUT_MS = 30000;

interface SalesforceConfig {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  instanceUrl: string;
  rawConfig: Record<string, unknown>;
}

interface SalesforceApiError {
  message?: string;
  errorCode?: string;
}

function normalizeInstanceUrl(instanceUrl: string): string {
  return instanceUrl.replace(/\/+$/, "");
}

async function getSalesforceConfig(
  workspaceId: string,
  serverId: string
): Promise<SalesforceConfig> {
  const db = await database();
  const pk = `mcp-servers/${workspaceId}/${serverId}`;
  const server = await db["mcp-server"].get(pk, "server");

  if (!server) {
    throw new Error(`MCP server ${serverId} not found`);
  }

  if (server.authType !== "oauth") {
    throw new Error(`MCP server ${serverId} is not an OAuth server`);
  }

  const config = server.config as {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: string;
    instanceUrl?: string;
  };

  if (!config.accessToken || !config.refreshToken) {
    throw new Error(`OAuth tokens not found for MCP server ${serverId}`);
  }

  if (!config.instanceUrl) {
    throw new Error(
      `Salesforce instance URL not found for MCP server ${serverId}`
    );
  }

  return {
    accessToken: config.accessToken,
    refreshToken: config.refreshToken,
    expiresAt: config.expiresAt || new Date().toISOString(),
    instanceUrl: config.instanceUrl,
    rawConfig: server.config as Record<string, unknown>,
  };
}

async function updateSalesforceTokens(
  workspaceId: string,
  serverId: string,
  updates: {
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
    instanceUrl?: string;
    rawConfig: Record<string, unknown>;
  }
): Promise<void> {
  const db = await database();
  const pk = `mcp-servers/${workspaceId}/${serverId}`;

  await db["mcp-server"].update({
    pk,
    sk: "server",
    config: {
      ...updates.rawConfig,
      accessToken: updates.accessToken,
      refreshToken: updates.refreshToken,
      expiresAt: updates.expiresAt,
      instanceUrl: updates.instanceUrl ?? updates.rawConfig.instanceUrl,
    },
    updatedAt: new Date().toISOString(),
  });
}

async function ensureValidSalesforceConfig(
  workspaceId: string,
  serverId: string
): Promise<SalesforceConfig> {
  let config = await getSalesforceConfig(workspaceId, serverId);

  if (isTokenExpired(config.expiresAt)) {
    const refreshed = await refreshSalesforceToken(config.refreshToken);
    await updateSalesforceTokens(workspaceId, serverId, {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt,
      instanceUrl: refreshed.instanceUrl || config.instanceUrl,
      rawConfig: config.rawConfig,
    });
    config = await getSalesforceConfig(workspaceId, serverId);
  }

  return config;
}

async function makeSalesforceApiRequest<T>(
  workspaceId: string,
  serverId: string,
  path: string,
  options: RequestInit = {},
  attempt: number = 0
): Promise<T> {
  const config = await ensureValidSalesforceConfig(workspaceId, serverId);
  const instanceUrl = normalizeInstanceUrl(config.instanceUrl);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${instanceUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 401 && attempt === 0) {
      const refreshed = await refreshSalesforceToken(config.refreshToken);
      await updateSalesforceTokens(workspaceId, serverId, {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
        instanceUrl: refreshed.instanceUrl || config.instanceUrl,
        rawConfig: config.rawConfig,
      });

      return makeSalesforceApiRequest<T>(
        workspaceId,
        serverId,
        path,
        options,
        attempt + 1
      );
    }

    if (!response.ok) {
      let errorMessage = `${response.status} ${response.statusText}`;
      try {
        const errorData = (await response.json()) as SalesforceApiError[];
        if (Array.isArray(errorData) && errorData[0]?.message) {
          errorMessage = errorData[0].message;
        }
      } catch {
        // Ignore JSON parse errors
      }

      if (response.status === 404) {
        throw new Error(`Salesforce resource not found: ${errorMessage}`);
      }

      if (response.status === 403) {
        throw new Error(
          `Salesforce API access forbidden: ${errorMessage}. Please check your Salesforce permissions.`
        );
      }

      throw new Error(`Salesforce API error: ${errorMessage}`);
    }

    return (await response.json()) as T;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Salesforce API request timeout");
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error(`Unexpected error: ${String(error)}`);
  }
}

export async function listObjects(workspaceId: string, serverId: string) {
  return makeSalesforceApiRequest(
    workspaceId,
    serverId,
    `/services/data/${SALESFORCE_API_VERSION}/sobjects/`
  );
}

export async function describeObject(
  workspaceId: string,
  serverId: string,
  objectName: string
) {
  const encodedName = encodeURIComponent(objectName);
  return makeSalesforceApiRequest(
    workspaceId,
    serverId,
    `/services/data/${SALESFORCE_API_VERSION}/sobjects/${encodedName}/describe/`
  );
}

export async function querySalesforce(
  workspaceId: string,
  serverId: string,
  query: string
) {
  const params = new URLSearchParams({ q: query });
  return makeSalesforceApiRequest(
    workspaceId,
    serverId,
    `/services/data/${SALESFORCE_API_VERSION}/query/?${params.toString()}`
  );
}
