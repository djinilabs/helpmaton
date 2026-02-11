import express from "express";

import { database } from "../../tables";
import { isUserAuthorized } from "../../tables/permissions";
import type { McpServerRecord } from "../../tables/schema";
import { PERMISSION_LEVELS } from "../../tables/schema";
import { expressErrorHandler } from "../utils/errorHandler";
import { posthogResetMiddleware } from "../utils/posthogMiddleware";
import { requireSessionFromRequest, userRef } from "../utils/session";

type McpOAuthTokenInfo = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  email?: string;
  instanceUrl?: string;
  adminId?: string;
};

type McpOAuthStateData = {
  workspaceId: string;
  serverId: string;
};

type OAuthExchangeParams = {
  code: string;
  workspaceId: string;
  serverId: string;
};

const getRedirectBaseUrl = () =>
  process.env.FRONTEND_URL || "http://localhost:5173";

const encodeErrorMessage = (message: string) => encodeURIComponent(message);

export const buildWorkspaceCallbackUrl = (params: {
  redirectBaseUrl: string;
  workspaceId: string;
  serverId: string;
  serviceType: string;
  success: boolean;
  errorMsg?: string;
}) => {
  const errorSegment = params.errorMsg ? `&error=${params.errorMsg}` : "";
  return `${params.redirectBaseUrl}/workspaces/${params.workspaceId}/mcp-servers/${params.serverId}/oauth-callback?success=${
    params.success ? "true" : "false"
  }${errorSegment}&serviceType=${params.serviceType}`;
};

export const buildRootErrorRedirectUrl = (
  redirectBaseUrl: string,
  errorMsg: string,
) => `${redirectBaseUrl}/?oauth_error=${errorMsg}`;

export const buildSignInRedirectUrl = (params: {
  redirectBaseUrl: string;
  workspaceId: string;
  serverId: string;
  code: string;
  state: string;
  serviceType: string;
}) => {
  const returnUrl = encodeURIComponent(
    `/workspaces/${params.workspaceId}/mcp-servers/${params.serverId}/oauth-callback?code=${params.code}&state=${params.state}&serviceType=${params.serviceType}`,
  );
  return `${params.redirectBaseUrl}/api/auth/signin?callbackUrl=${returnUrl}`;
};

const tryExtractStateData = async (
  state?: string,
): Promise<McpOAuthStateData | null> => {
  if (!state) {
    return null;
  }
  const { validateAndExtractMcpOAuthStateToken } =
    await import("../../utils/oauth/mcp/common");
  return validateAndExtractMcpOAuthStateToken(state);
};

const buildErrorRedirectFromState = async (params: {
  redirectBaseUrl: string;
  state?: string;
  serviceType: string;
  errorMsg: string;
}) => {
  const stateData = await tryExtractStateData(params.state);
  if (stateData) {
    return buildWorkspaceCallbackUrl({
      redirectBaseUrl: params.redirectBaseUrl,
      workspaceId: stateData.workspaceId,
      serverId: stateData.serverId,
      serviceType: params.serviceType,
      success: false,
      errorMsg: params.errorMsg,
    });
  }
  return buildRootErrorRedirectUrl(params.redirectBaseUrl, params.errorMsg);
};

const requireStateData = async (
  state: string | undefined,
  redirectBaseUrl: string,
): Promise<{ stateData?: McpOAuthStateData; redirectUrl?: string }> => {
  if (!state) {
    return {
      redirectUrl: buildRootErrorRedirectUrl(
        redirectBaseUrl,
        encodeErrorMessage("State parameter is missing"),
      ),
    };
  }
  const stateData = await tryExtractStateData(state);
  if (!stateData) {
    return {
      redirectUrl: buildRootErrorRedirectUrl(
        redirectBaseUrl,
        encodeErrorMessage("Invalid or expired state token"),
      ),
    };
  }
  return { stateData };
};

const exchangeHandlers: Record<
  string,
  (params: OAuthExchangeParams) => Promise<McpOAuthTokenInfo>
> = {
  "google-drive": async ({ code }) => {
    const { exchangeGoogleDriveCode } =
      await import("../../utils/oauth/mcp/google-drive");
    return exchangeGoogleDriveCode(code);
  },
  gmail: async ({ code }) => {
    const { exchangeGmailCode } = await import("../../utils/oauth/mcp/gmail");
    return exchangeGmailCode(code);
  },
  "google-calendar": async ({ code }) => {
    const { exchangeGoogleCalendarCode } =
      await import("../../utils/oauth/mcp/google-calendar");
    return exchangeGoogleCalendarCode(code);
  },
  notion: async ({ code }) => {
    const { exchangeNotionCode } = await import("../../utils/oauth/mcp/notion");
    return exchangeNotionCode(code);
  },
  github: async ({ code }) => {
    const { exchangeGithubCode } = await import("../../utils/oauth/mcp/github");
    return exchangeGithubCode(code);
  },
  linear: async ({ code }) => {
    const { exchangeLinearCode } = await import("../../utils/oauth/mcp/linear");
    return exchangeLinearCode(code);
  },
  hubspot: async ({ code }) => {
    const { exchangeHubspotCode } =
      await import("../../utils/oauth/mcp/hubspot");
    return exchangeHubspotCode(code);
  },
  shopify: async ({ code, workspaceId, serverId }) => {
    const { exchangeShopifyCode } =
      await import("../../utils/oauth/mcp/shopify");
    return exchangeShopifyCode(workspaceId, serverId, code);
  },
  slack: async ({ code }) => {
    const { exchangeSlackCode } = await import("../../utils/oauth/mcp/slack");
    return exchangeSlackCode(code);
  },
  stripe: async ({ code }) => {
    const { exchangeStripeCode } = await import("../../utils/oauth/mcp/stripe");
    return exchangeStripeCode(code);
  },
  salesforce: async ({ code }) => {
    const { exchangeSalesforceCode } =
      await import("../../utils/oauth/mcp/salesforce");
    return exchangeSalesforceCode(code);
  },
  intercom: async ({ code }) => {
    const { exchangeIntercomCode } =
      await import("../../utils/oauth/mcp/intercom");
    return exchangeIntercomCode(code);
  },
  todoist: async ({ code }) => {
    const { exchangeTodoistCode } =
      await import("../../utils/oauth/mcp/todoist");
    return exchangeTodoistCode(code);
  },
  zendesk: async ({ code, workspaceId, serverId }) => {
    const { exchangeZendeskCode } =
      await import("../../utils/oauth/mcp/zendesk");
    return exchangeZendeskCode(workspaceId, serverId, code);
  },
};

const ALLOWED_SERVICE_TYPES = new Set(Object.keys(exchangeHandlers));

const exchangeOAuthCode = async (
  serviceType: string,
  params: OAuthExchangeParams,
) => {
  const handler = exchangeHandlers[serviceType];
  if (!handler) {
    throw new Error(`Unsupported service type: ${serviceType}`);
  }
  return handler(params);
};

const resolveUserRefOrRedirect = async (params: {
  req: express.Request;
  redirectBaseUrl: string;
  workspaceId: string;
  serverId: string;
  code: string;
  state: string;
  serviceType: string;
}): Promise<{ currentUserRef?: string; redirectUrl?: string }> => {
  try {
    const session = await requireSessionFromRequest(params.req);
    if (session.user?.id) {
      return { currentUserRef: userRef(session.user.id) };
    }
  } catch {
    // Session not available - redirect to login with return URL
  }
  return {
    redirectUrl: buildSignInRedirectUrl(params),
  };
};

const ensureWorkspacePermission = async (params: {
  currentUserRef: string;
  workspaceId: string;
  serverId: string;
  redirectBaseUrl: string;
  serviceType: string;
}): Promise<string | undefined> => {
  try {
    const resource = `workspaces/${params.workspaceId}`;
    const [authorized] = await isUserAuthorized(
      params.currentUserRef,
      resource,
      PERMISSION_LEVELS.WRITE,
    );
    if (!authorized) {
      return buildWorkspaceCallbackUrl({
        redirectBaseUrl: params.redirectBaseUrl,
        workspaceId: params.workspaceId,
        serverId: params.serverId,
        serviceType: params.serviceType,
        success: false,
        errorMsg: encodeErrorMessage(
          "You don't have permission to modify this workspace",
        ),
      });
    }
  } catch {
    return buildWorkspaceCallbackUrl({
      redirectBaseUrl: params.redirectBaseUrl,
      workspaceId: params.workspaceId,
      serverId: params.serverId,
      serviceType: params.serviceType,
      success: false,
      errorMsg: encodeErrorMessage("Failed to verify permissions"),
    });
  }
  return undefined;
};

const loadOauthServerOrRedirect = async (params: {
  workspaceId: string;
  serverId: string;
  serviceType: string;
  redirectBaseUrl: string;
  db: Awaited<ReturnType<typeof database>>;
}): Promise<{ server?: McpServerRecord; redirectUrl?: string }> => {
  const pk = `mcp-servers/${params.workspaceId}/${params.serverId}`;
  const server = await params.db["mcp-server"].get(pk, "server");

  if (!server) {
    return {
      redirectUrl: buildWorkspaceCallbackUrl({
        redirectBaseUrl: params.redirectBaseUrl,
        workspaceId: params.workspaceId,
        serverId: params.serverId,
        serviceType: params.serviceType,
        success: false,
        errorMsg: encodeErrorMessage(`MCP server ${params.serverId} not found`),
      }),
    };
  }

  if (server.authType !== "oauth") {
    return {
      redirectUrl: buildWorkspaceCallbackUrl({
        redirectBaseUrl: params.redirectBaseUrl,
        workspaceId: params.workspaceId,
        serverId: params.serverId,
        serviceType: params.serviceType,
        success: false,
        errorMsg: encodeErrorMessage(
          `MCP server ${params.serverId} is not an OAuth-based server`,
        ),
      }),
    };
  }

  if (server.serviceType !== params.serviceType) {
    return {
      redirectUrl: buildWorkspaceCallbackUrl({
        redirectBaseUrl: params.redirectBaseUrl,
        workspaceId: params.workspaceId,
        serverId: params.serverId,
        serviceType: params.serviceType,
        success: false,
        errorMsg: encodeErrorMessage(
          `Service type mismatch: expected ${server.serviceType}, got ${params.serviceType}`,
        ),
      }),
    };
  }

  return { server };
};

export const buildOAuthConfig = (params: {
  tokenInfo: McpOAuthTokenInfo;
  serviceType: string;
  serverConfig?: Record<string, unknown>;
}) => {
  let config: Record<string, unknown> = {
    accessToken: String(params.tokenInfo.accessToken),
    refreshToken: String(params.tokenInfo.refreshToken),
    expiresAt: String(params.tokenInfo.expiresAt),
  };

  if (params.serviceType === "zendesk" || params.serviceType === "shopify") {
    config = {
      ...(params.serverConfig ?? {}),
      ...config,
    };
  }

  if (
    params.tokenInfo.email !== undefined &&
    params.tokenInfo.email !== null &&
    params.tokenInfo.email !== ""
  ) {
    config.email = String(params.tokenInfo.email);
  }
  if (params.tokenInfo.instanceUrl) {
    config.instanceUrl = String(params.tokenInfo.instanceUrl);
  }
  if (params.tokenInfo.adminId) {
    config.adminId = String(params.tokenInfo.adminId);
  }

  return config;
};

const hasRequiredTokenFields = (tokenInfo: McpOAuthTokenInfo) =>
  !!tokenInfo.accessToken && !!tokenInfo.refreshToken && !!tokenInfo.expiresAt;

const handleMcpOauthCallback: express.RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    const serviceType = req.params.serviceType as string;
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    const error = req.query.error as string | undefined;

    const redirectBaseUrl = getRedirectBaseUrl();

    if (error) {
      const errorDescription = req.query.error_description as
        | string
        | undefined;
      const errorMsg = encodeErrorMessage(
        `OAuth error: ${error}${
          errorDescription ? ` - ${errorDescription}` : ""
        }`,
      );
      const redirectUrl = await buildErrorRedirectFromState({
        redirectBaseUrl,
        state,
        serviceType,
        errorMsg,
      });
      return res.redirect(redirectUrl);
    }

    if (!code) {
      const errorMsg = encodeErrorMessage("Authorization code is missing");
      const redirectUrl = await buildErrorRedirectFromState({
        redirectBaseUrl,
        state,
        serviceType,
        errorMsg,
      });
      return res.redirect(redirectUrl);
    }

    const stateResult = await requireStateData(state, redirectBaseUrl);
    if (stateResult.redirectUrl) {
      return res.redirect(stateResult.redirectUrl);
    }
    const { workspaceId, serverId } = stateResult.stateData!;
    const stateToken = state as string;

    if (!ALLOWED_SERVICE_TYPES.has(serviceType)) {
      const errorMsg = encodeErrorMessage(
        `Unsupported service type: ${serviceType}`,
      );
      return res.redirect(
        buildWorkspaceCallbackUrl({
          redirectBaseUrl,
          workspaceId,
          serverId,
          serviceType,
          success: false,
          errorMsg,
        }),
      );
    }

    const userResult = await resolveUserRefOrRedirect({
      req,
      redirectBaseUrl,
      workspaceId,
      serverId,
      code,
      state: stateToken,
      serviceType,
    });
    if (userResult.redirectUrl) {
      return res.redirect(userResult.redirectUrl);
    }
    const currentUserRef = userResult.currentUserRef!;

    const permissionRedirectUrl = await ensureWorkspacePermission({
      currentUserRef,
      workspaceId,
      serverId,
      redirectBaseUrl,
      serviceType,
    });
    if (permissionRedirectUrl) {
      return res.redirect(permissionRedirectUrl);
    }

    const db = await database();
    const serverResult = await loadOauthServerOrRedirect({
      workspaceId,
      serverId,
      serviceType,
      redirectBaseUrl,
      db,
    });
    if (serverResult.redirectUrl) {
      return res.redirect(serverResult.redirectUrl);
    }

    let tokenInfo: McpOAuthTokenInfo;
    try {
      tokenInfo = await exchangeOAuthCode(serviceType, {
        code,
        workspaceId,
        serverId,
      });
      console.log(
        `[MCP OAuth Callback] Token exchange successful for ${serviceType}`,
        {
          hasAccessToken: !!tokenInfo.accessToken,
          hasRefreshToken: !!tokenInfo.refreshToken,
          hasExpiresAt: !!tokenInfo.expiresAt,
          hasEmail: !!tokenInfo.email,
        },
      );
    } catch (error) {
      console.error(
        `[MCP OAuth Callback] Token exchange failed for ${serviceType}:`,
        error,
      );
      const errorMsg = encodeErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to exchange OAuth code for tokens",
      );
      return res.redirect(
        buildWorkspaceCallbackUrl({
          redirectBaseUrl,
          workspaceId,
          serverId,
          serviceType,
          success: false,
          errorMsg,
        }),
      );
    }

    if (!hasRequiredTokenFields(tokenInfo)) {
      console.error(
        `[MCP OAuth Callback] Missing required token fields for ${serviceType}:`,
        {
          hasAccessToken: !!tokenInfo.accessToken,
          hasRefreshToken: !!tokenInfo.refreshToken,
          hasExpiresAt: !!tokenInfo.expiresAt,
          hasEmail: !!tokenInfo.email,
        },
      );
      const errorMsg = encodeErrorMessage(
        "Failed to obtain required OAuth tokens",
      );
      return res.redirect(
        buildWorkspaceCallbackUrl({
          redirectBaseUrl,
          workspaceId,
          serverId,
          serviceType,
          success: false,
          errorMsg,
        }),
      );
    }

    const config = buildOAuthConfig({
      tokenInfo,
      serviceType,
      serverConfig: serverResult.server!.config as Record<string, unknown>,
    });

    await db["mcp-server"].update({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      config,
      updatedBy: currentUserRef,
      updatedAt: new Date().toISOString(),
    });

    return res.redirect(
      buildWorkspaceCallbackUrl({
        redirectBaseUrl,
        workspaceId,
        serverId,
        serviceType,
        success: true,
      }),
    );
  } catch (error) {
    return next(error);
  }
};

export const createApp: () => express.Application = () => {
  const app = express();
  app.set("etag", false);
  app.set("trust proxy", true);

  app.use(posthogResetMiddleware);

  // GET /api/mcp/oauth/:serviceType/callback - OAuth callback handler for MCP servers
  app.get("/api/mcp/oauth/:serviceType/callback", handleMcpOauthCallback);

  // Error handler must be last
  app.use(expressErrorHandler);
  return app;
};
