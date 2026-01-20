import { badRequest, forbidden, resourceGone } from "@hapi/boom";
import type express from "express";

import { database } from "../../../tables";
import {
  isValidPosthogBaseUrl,
  normalizePosthogBaseUrl,
} from "../../../utils/posthog/constants";
import { assertValidShopifyShopDomain } from "../../../utils/shopify/utils";
import { trackBusinessEvent } from "../../../utils/tracking";
import { validateBody } from "../../utils/bodyValidation";
import { updateMcpServerSchema } from "../../utils/schemas/workspaceSchemas";
import { handleError } from "../middleware";

type McpAuthType = "none" | "header" | "basic" | "oauth";

const validateName = (name: unknown) => {
  if (name !== undefined && typeof name !== "string") {
    throw badRequest("name must be a string");
  }
};

const validateUrl = (url: unknown) => {
  if (url === undefined) {
    return;
  }
  if (typeof url !== "string") {
    throw badRequest("url must be a string");
  }
  try {
    new URL(url);
  } catch {
    throw badRequest("url must be a valid URL");
  }
};

const validateAuthType = (authType: unknown): authType is McpAuthType => {
  if (authType === undefined) {
    return true;
  }
  if (typeof authType !== "string") {
    throw badRequest("authType must be a string");
  }
  if (!["none", "header", "basic", "oauth"].includes(authType)) {
    throw badRequest(
      'authType must be one of: "none", "header", "basic", "oauth"'
    );
  }
  return true;
};

const assertNoOAuthTokenUpdates = (
  serverAuthType: string,
  config: unknown
) => {
  if (serverAuthType !== "oauth" || config === undefined) {
    return;
  }
  const configObj = config as Record<string, unknown>;
  if (
    configObj.accessToken !== undefined ||
    configObj.refreshToken !== undefined ||
    configObj.expiresAt !== undefined
  ) {
    throw badRequest(
      "OAuth tokens cannot be updated via this endpoint. Use OAuth endpoints instead."
    );
  }
};

const resolveFinalTypes = (params: {
  serviceType?: string;
  authType?: McpAuthType;
  serverServiceType?: string;
  serverAuthType: string;
}): { finalServiceType?: string; finalAuthType: McpAuthType } => {
  const finalServiceType = params.serviceType ?? params.serverServiceType;
  const finalAuthType = (params.authType || params.serverAuthType) as McpAuthType;
  return { finalServiceType, finalAuthType };
};

const validateConfigObject = (config: unknown) => {
  if (config !== undefined && (typeof config !== "object" || config === null)) {
    throw badRequest("config must be an object");
  }
};

const validateAuthConfig = (params: {
  config: Record<string, unknown> | undefined;
  finalAuthType: McpAuthType;
  finalServiceType?: string;
}) => {
  if (!params.config) {
    return;
  }
  if (params.finalAuthType === "header" && params.finalServiceType !== "posthog") {
    if (
      !params.config.headerValue ||
      typeof params.config.headerValue !== "string"
    ) {
      throw badRequest("config.headerValue is required for header authentication");
    }
  } else if (params.finalAuthType === "basic") {
    if (!params.config.username || typeof params.config.username !== "string") {
      throw badRequest("config.username is required for basic authentication");
    }
    if (!params.config.password || typeof params.config.password !== "string") {
      throw badRequest("config.password is required for basic authentication");
    }
  } else if (params.finalServiceType === "posthog") {
    if (!params.config.apiKey || typeof params.config.apiKey !== "string") {
      throw badRequest("config.apiKey is required for PostHog authentication");
    }
  }
};

const validatePosthogConfig = (params: {
  finalServiceType?: string;
  finalAuthType: McpAuthType;
  url?: string;
  serverUrl?: string;
  config?: Record<string, unknown>;
  serverConfig?: Record<string, unknown>;
}) => {
  if (params.finalServiceType !== "posthog") {
    return;
  }
  if (params.finalAuthType !== "header") {
    throw badRequest("PostHog requires header authentication");
  }
  const baseUrl = params.url ?? params.serverUrl;
  if (!baseUrl || typeof baseUrl !== "string") {
    throw badRequest(
      "url is required for PostHog and must be a valid PostHog base URL"
    );
  }
  const normalizedUrl = normalizePosthogBaseUrl(baseUrl);
  if (!isValidPosthogBaseUrl(normalizedUrl)) {
    throw badRequest("url must be https://us.posthog.com or https://eu.posthog.com");
  }
  if (params.config === undefined) {
    const existingConfig = params.serverConfig as { apiKey?: string };
    if (!existingConfig.apiKey) {
      throw badRequest("config.apiKey is required for PostHog authentication");
    }
  }
};

const validateZendeskOAuthConfig = (params: {
  finalServiceType?: string;
  finalAuthType: McpAuthType;
  serverConfig?: Record<string, unknown>;
  config?: Record<string, unknown>;
}) => {
  if (params.finalServiceType !== "zendesk" || params.finalAuthType !== "oauth") {
    return;
  }
  const existingConfig = params.serverConfig as {
    subdomain?: string;
    clientId?: string;
    clientSecret?: string;
  };
  const newConfig = (params.config ?? {}) as {
    subdomain?: string;
    clientId?: string;
    clientSecret?: string;
  };
  const subdomain = newConfig.subdomain ?? existingConfig.subdomain;
  const clientId = newConfig.clientId ?? existingConfig.clientId;
  const clientSecret = newConfig.clientSecret ?? existingConfig.clientSecret;
  if (!subdomain || !clientId || !clientSecret) {
    throw badRequest(
      "config.subdomain, config.clientId, and config.clientSecret are required for Zendesk OAuth"
    );
  }
  const zendeskSubdomainPattern = /^[a-zA-Z0-9-]+$/;
  if (!zendeskSubdomainPattern.test(subdomain)) {
    throw badRequest(
      "config.subdomain must contain only alphanumeric characters and hyphens"
    );
  }
};

const validateShopifyOAuthConfig = (params: {
  finalServiceType?: string;
  finalAuthType: McpAuthType;
  serverConfig?: Record<string, unknown>;
  config?: Record<string, unknown>;
}) => {
  if (params.finalServiceType !== "shopify" || params.finalAuthType !== "oauth") {
    return;
  }
  const existingConfig = params.serverConfig as {
    shopDomain?: string;
  };
  const newConfig = (params.config ?? {}) as {
    shopDomain?: string;
  };
  const shopDomain = newConfig.shopDomain ?? existingConfig.shopDomain;
  if (!shopDomain) {
    throw badRequest("config.shopDomain is required for Shopify OAuth");
  }
  try {
    const normalizedShopDomain = assertValidShopifyShopDomain(shopDomain);
    if (params.config && typeof params.config === "object") {
      (params.config as { shopDomain?: string }).shopDomain =
        normalizedShopDomain;
    }
  } catch (error) {
    throw badRequest(
      error instanceof Error ? error.message : "config.shopDomain is invalid"
    );
  }
};

const mergeOAuthConfig = (params: {
  serverAuthType: string;
  config?: Record<string, unknown>;
  serverConfig?: Record<string, unknown>;
}) => {
  if (params.serverAuthType !== "oauth" || params.config === undefined) {
    return params.config !== undefined ? params.config : params.serverConfig;
  }
  const existingConfig = params.serverConfig || {};
  const newConfig = params.config;
  return {
    ...existingConfig,
    ...newConfig,
    accessToken: existingConfig.accessToken,
    refreshToken: existingConfig.refreshToken,
    expiresAt: existingConfig.expiresAt,
    email: existingConfig.email,
  };
};

export const handlePutMcpServer = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  try {
    const body = validateBody(req.body, updateMcpServerSchema);
    const { name, url, authType, serviceType, config } = body;
    const db = await database();
    const workspaceResource = req.workspaceResource;
    if (!workspaceResource) {
      throw badRequest("Workspace resource not found");
    }
    const workspaceId = req.params.workspaceId;
    const serverId = req.params.serverId;
    const pk = `mcp-servers/${workspaceId}/${serverId}`;

    const server = await db["mcp-server"].get(pk, "server");
    if (!server) {
      throw resourceGone("MCP server not found");
    }
    if (server.workspaceId !== workspaceId) {
      throw forbidden("MCP server does not belong to this workspace");
    }

    validateName(name);
    validateUrl(url);
    validateAuthType(authType);
    assertNoOAuthTokenUpdates(server.authType, config);

    const { finalServiceType, finalAuthType } = resolveFinalTypes({
      serviceType,
      authType,
      serverServiceType: server.serviceType,
      serverAuthType: server.authType,
    });

    validateConfigObject(config);
    validateAuthConfig({
      config: config as Record<string, unknown> | undefined,
      finalAuthType,
      finalServiceType,
    });
    validatePosthogConfig({
      finalServiceType,
      finalAuthType,
      url,
      serverUrl: server.url,
      config: config as Record<string, unknown> | undefined,
      serverConfig: server.config as Record<string, unknown> | undefined,
    });
    validateZendeskOAuthConfig({
      finalServiceType,
      finalAuthType,
      serverConfig: server.config as Record<string, unknown> | undefined,
      config: config as Record<string, unknown> | undefined,
    });
    validateShopifyOAuthConfig({
      finalServiceType,
      finalAuthType,
      serverConfig: server.config as Record<string, unknown> | undefined,
      config: config as Record<string, unknown> | undefined,
    });

    const finalConfig = mergeOAuthConfig({
      serverAuthType: server.authType,
      config: config as Record<string, unknown> | undefined,
      serverConfig: server.config as Record<string, unknown> | undefined,
    });

    const updated = await db["mcp-server"].update({
      pk,
      sk: "server",
      workspaceId,
      name: name !== undefined ? name : server.name,
      url: url !== undefined ? url : server.url,
      authType: authType !== undefined ? authType : server.authType,
      serviceType: serviceType !== undefined ? serviceType : server.serviceType,
      config: finalConfig,
      updatedBy: req.userRef || "",
      updatedAt: new Date().toISOString(),
    });

    trackBusinessEvent(
      "mcp_server",
      "updated",
      {
        workspace_id: workspaceId,
        server_id: serverId,
      },
      req
    );

    const oauthConfig = updated.config as { accessToken?: string };
    const oauthConnected =
      updated.authType === "oauth" && !!oauthConfig.accessToken;

    res.json({
      id: serverId,
      name: updated.name,
      url: updated.url,
      authType: updated.authType,
      serviceType: updated.serviceType,
      oauthConnected: updated.authType === "oauth" ? oauthConnected : undefined,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    });
  } catch (error) {
    handleError(
      error,
      next,
      "PUT /api/workspaces/:workspaceId/mcp-servers/:serverId"
    );
  }
};
