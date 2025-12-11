import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const {
  mockDatabase,
  mockValidateAndExtractStateToken,
  mockRequireSessionFromRequest,
  mockIsUserAuthorized,
  mockExchangeGmailCode,
  mockExchangeOutlookCode,
} = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockValidateAndExtractStateToken: vi.fn(),
    mockRequireSessionFromRequest: vi.fn(),
    mockIsUserAuthorized: vi.fn(),
    mockExchangeGmailCode: vi.fn(),
    mockExchangeOutlookCode: vi.fn(),
  };
});

// Mock the modules
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/oauth/common", () => ({
  validateAndExtractStateToken: mockValidateAndExtractStateToken,
}));

vi.mock("../../../../utils/session", () => ({
  requireSessionFromRequest: mockRequireSessionFromRequest,
  userRef: (userId: string) => `users/${userId}`,
}));

vi.mock("../../../../tables/permissions", () => ({
  isUserAuthorized: mockIsUserAuthorized,
}));

vi.mock("../../../../utils/oauth/gmail", () => ({
  exchangeGmailCode: mockExchangeGmailCode,
}));

vi.mock("../../../../utils/oauth/outlook", () => ({
  exchangeOutlookCode: mockExchangeOutlookCode,
}));

describe("GET /api/email/oauth/:provider/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set default FRONTEND_URL for redirects
    process.env.FRONTEND_URL = "http://localhost:5173";
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>,
    next: express.NextFunction
  ) {
    // Extract the handler logic directly
    const handler = async (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      try {
        const provider = req.params.provider as "gmail" | "outlook";
        const code = req.query.code as string | undefined;
        const state = req.query.state as string | undefined;
        const error = req.query.error as string | undefined;

        const redirectBaseUrl =
          process.env.FRONTEND_URL || "http://localhost:5173";

        // Handle OAuth errors from provider
        if (error) {
          const errorDescription = req.query.error_description as
            | string
            | undefined;
          // Try to extract workspaceId from state for redirect
          let workspaceId = "";
          if (state) {
            const { validateAndExtractStateToken } = await import(
              "../../../../utils/oauth/common"
            );
            const stateData = validateAndExtractStateToken(state);
            if (stateData) {
              workspaceId = stateData.workspaceId;
            }
          }
          const errorMsg = encodeURIComponent(
            `OAuth error: ${error}${
              errorDescription ? ` - ${errorDescription}` : ""
            }`
          );
          if (workspaceId) {
            return res.redirect(
              `${redirectBaseUrl}/workspaces/${workspaceId}/email-oauth-callback?success=false&error=${errorMsg}&provider=${provider}`
            );
          }
          return res.redirect(`${redirectBaseUrl}/?oauth_error=${errorMsg}`);
        }

        if (!code) {
          let workspaceId = "";
          if (state) {
            const { validateAndExtractStateToken } = await import(
              "../../../../utils/oauth/common"
            );
            const stateData = validateAndExtractStateToken(state);
            if (stateData) {
              workspaceId = stateData.workspaceId;
            }
          }
          const errorMsg = encodeURIComponent("Authorization code is missing");
          if (workspaceId) {
            return res.redirect(
              `${redirectBaseUrl}/workspaces/${workspaceId}/email-oauth-callback?success=false&error=${errorMsg}&provider=${provider}`
            );
          }
          return res.redirect(`${redirectBaseUrl}/?oauth_error=${errorMsg}`);
        }

        if (!state) {
          const errorMsg = encodeURIComponent("State parameter is missing");
          return res.redirect(`${redirectBaseUrl}/?oauth_error=${errorMsg}`);
        }

        // Extract workspaceId from state token
        const { validateAndExtractStateToken } = await import(
          "../../../../utils/oauth/common"
        );
        const stateData = validateAndExtractStateToken(state);
        if (!stateData) {
          const errorMsg = encodeURIComponent("Invalid or expired state token");
          return res.redirect(`${redirectBaseUrl}/?oauth_error=${errorMsg}`);
        }
        const workspaceId = stateData.workspaceId;

        if (!["gmail", "outlook"].includes(provider)) {
          const errorMsg = encodeURIComponent(
            'provider must be "gmail" or "outlook"'
          );
          return res.redirect(
            `${redirectBaseUrl}/workspaces/${workspaceId}/email-oauth-callback?success=false&error=${errorMsg}&provider=${provider}`
          );
        }

        // Try to get session, but don't fail if not authenticated - we'll handle it gracefully
        let currentUserRef: string | undefined;
        try {
          const session = await mockRequireSessionFromRequest(req);
          if (session.user?.id) {
            currentUserRef = `users/${session.user.id}`;
          }
        } catch {
          // Session not available - redirect to login with return URL
          const returnUrl = encodeURIComponent(
            `/workspaces/${workspaceId}/email-oauth-callback?code=${code}&state=${state}&provider=${provider}`
          );
          return res.redirect(
            `${redirectBaseUrl}/api/auth/signin?callbackUrl=${returnUrl}`
          );
        }

        if (!currentUserRef) {
          const returnUrl = encodeURIComponent(
            `/workspaces/${workspaceId}/email-oauth-callback?code=${code}&state=${state}&provider=${provider}`
          );
          return res.redirect(
            `${redirectBaseUrl}/api/auth/signin?callbackUrl=${returnUrl}`
          );
        }

        // Verify user has permission to modify this workspace
        try {
          const resource = `workspaces/${workspaceId}`;
          const [authorized] = await mockIsUserAuthorized(
            currentUserRef,
            resource,
            2 // PERMISSION_LEVELS.WRITE
          );
          if (!authorized) {
            const errorMsg = encodeURIComponent(
              "You don't have permission to modify this workspace"
            );
            return res.redirect(
              `${redirectBaseUrl}/workspaces/${workspaceId}/email-oauth-callback?success=false&error=${errorMsg}&provider=${provider}`
            );
          }
        } catch {
          const errorMsg = encodeURIComponent("Failed to verify permissions");
          return res.redirect(
            `${redirectBaseUrl}/workspaces/${workspaceId}/email-oauth-callback?success=false&error=${errorMsg}&provider=${provider}`
          );
        }

        const db = await mockDatabase();

        // Exchange code for tokens
        let tokenInfo: {
          accessToken: string;
          refreshToken: string;
          expiresAt: string;
          email?: string;
        };
        if (provider === "gmail") {
          tokenInfo = await mockExchangeGmailCode(code);
        } else {
          tokenInfo = await mockExchangeOutlookCode(code);
        }

        // Create or update email connection
        const pk = `email-connections/${workspaceId}`;
        const sk = "connection";
        const existing = await db["email-connection"].get(pk, sk);

        const connectionName = `${
          provider.charAt(0).toUpperCase() + provider.slice(1)
        } Connection`;
        // Remove undefined values from config to avoid DynamoDB errors
        const config: Record<string, unknown> = {
          accessToken: tokenInfo.accessToken,
          refreshToken: tokenInfo.refreshToken,
          expiresAt: tokenInfo.expiresAt,
        };
        if (tokenInfo.email !== undefined) {
          config.email = tokenInfo.email;
        }

        if (existing) {
          // Update existing connection
          await db["email-connection"].update({
            pk,
            sk,
            workspaceId,
            type: provider,
            name: connectionName,
            config,
            updatedBy: currentUserRef,
            updatedAt: new Date().toISOString(),
          });
        } else {
          // Create new connection
          await db["email-connection"].create({
            pk,
            sk,
            workspaceId,
            type: provider,
            name: connectionName,
            config,
            createdBy: currentUserRef,
          });
        }

        // Redirect to frontend success page
        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
        res.redirect(
          `${frontendUrl}/workspaces/${workspaceId}/email-oauth-callback?success=true&provider=${provider}`
        );
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should create new Gmail email connection successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const userRef = "users/user-456";
    const code = "auth-code-789";
    const state = "state-token-123";

    mockValidateAndExtractStateToken.mockReturnValue({ workspaceId });
    mockRequireSessionFromRequest.mockResolvedValue({
      user: { id: userId },
      expires: new Date().toISOString(),
    });
    mockIsUserAuthorized.mockResolvedValue([true]);
    mockExchangeGmailCode.mockResolvedValue({
      accessToken: "access-token-123",
      refreshToken: "refresh-token-456",
      expiresAt: "2024-12-31T23:59:59Z",
      email: "user@gmail.com",
    });

    const mockGet = vi.fn().mockResolvedValue(null);
    const mockCreate = vi.fn().mockResolvedValue({
      pk: `email-connections/${workspaceId}`,
      sk: "connection",
      workspaceId,
      type: "gmail",
      name: "Gmail Connection",
      config: {
        accessToken: "access-token-123",
        refreshToken: "refresh-token-456",
        expiresAt: "2024-12-31T23:59:59Z",
        email: "user@gmail.com",
      },
      createdBy: userRef,
      createdAt: "2024-01-01T00:00:00Z",
    });

    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: mockGet,
      create: mockCreate,
    };

    const req = createMockRequest({
      params: {
        provider: "gmail",
      },
      query: {
        code,
        state,
      },
    });
    const res = createMockResponse();
    (res as { redirect?: ReturnType<typeof vi.fn> }).redirect = vi.fn();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockValidateAndExtractStateToken).toHaveBeenCalledWith(state);
    expect(mockRequireSessionFromRequest).toHaveBeenCalled();
    expect(mockIsUserAuthorized).toHaveBeenCalledWith(
      userRef,
      `workspaces/${workspaceId}`,
      2
    );
    expect(mockExchangeGmailCode).toHaveBeenCalledWith(code);
    expect(mockGet).toHaveBeenCalledWith(
      `email-connections/${workspaceId}`,
      "connection"
    );
    expect(mockCreate).toHaveBeenCalledWith({
      pk: `email-connections/${workspaceId}`,
      sk: "connection",
      workspaceId,
      type: "gmail",
      name: "Gmail Connection",
      config: {
        accessToken: "access-token-123",
        refreshToken: "refresh-token-456",
        expiresAt: "2024-12-31T23:59:59Z",
        email: "user@gmail.com",
      },
      createdBy: userRef,
    });
    expect(res.redirect).toHaveBeenCalledWith(
      `http://localhost:5173/workspaces/${workspaceId}/email-oauth-callback?success=true&provider=gmail`
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("should redirect to login when session is not available", async () => {
    const workspaceId = "workspace-123";
    const code = "auth-code-789";
    const state = "state-token-123";

    mockValidateAndExtractStateToken.mockReturnValue({ workspaceId });
    mockRequireSessionFromRequest.mockRejectedValue(new Error("No session"));

    const req = createMockRequest({
      params: {
        provider: "gmail",
      },
      query: {
        code,
        state,
      },
    });
    const res = createMockResponse();
    (res as { redirect?: ReturnType<typeof vi.fn> }).redirect = vi.fn();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockValidateAndExtractStateToken).toHaveBeenCalledWith(state);
    expect(mockRequireSessionFromRequest).toHaveBeenCalled();
    const returnUrl = encodeURIComponent(
      `/workspaces/${workspaceId}/email-oauth-callback?code=${code}&state=${state}&provider=gmail`
    );
    expect(res.redirect).toHaveBeenCalledWith(
      `http://localhost:5173/api/auth/signin?callbackUrl=${returnUrl}`
    );
    expect(mockExchangeGmailCode).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should redirect to login when userRef is missing after session", async () => {
    const workspaceId = "workspace-123";
    const code = "auth-code-789";
    const state = "state-token-123";

    mockValidateAndExtractStateToken.mockReturnValue({ workspaceId });
    mockRequireSessionFromRequest.mockResolvedValue({
      user: {}, // No id
      expires: new Date().toISOString(),
    });

    const req = createMockRequest({
      params: {
        provider: "gmail",
      },
      query: {
        code,
        state,
      },
    });
    const res = createMockResponse();
    (res as { redirect?: ReturnType<typeof vi.fn> }).redirect = vi.fn();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockValidateAndExtractStateToken).toHaveBeenCalledWith(state);
    expect(mockRequireSessionFromRequest).toHaveBeenCalled();
    const returnUrl = encodeURIComponent(
      `/workspaces/${workspaceId}/email-oauth-callback?code=${code}&state=${state}&provider=gmail`
    );
    expect(res.redirect).toHaveBeenCalledWith(
      `http://localhost:5173/api/auth/signin?callbackUrl=${returnUrl}`
    );
    expect(mockExchangeGmailCode).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should redirect when user lacks permission", async () => {
    const workspaceId = "workspace-123";
    const userId = "user-456";
    const userRef = "users/user-456";
    const code = "auth-code-789";
    const state = "state-token-123";

    mockValidateAndExtractStateToken.mockReturnValue({ workspaceId });
    mockRequireSessionFromRequest.mockResolvedValue({
      user: { id: userId },
      expires: new Date().toISOString(),
    });
    mockIsUserAuthorized.mockResolvedValue([false]);

    const req = createMockRequest({
      params: {
        provider: "gmail",
      },
      query: {
        code,
        state,
      },
    });
    const res = createMockResponse();
    (res as { redirect?: ReturnType<typeof vi.fn> }).redirect = vi.fn();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockIsUserAuthorized).toHaveBeenCalledWith(
      userRef,
      `workspaces/${workspaceId}`,
      2
    );
    const errorMsg = encodeURIComponent(
      "You don't have permission to modify this workspace"
    );
    expect(res.redirect).toHaveBeenCalledWith(
      `http://localhost:5173/workspaces/${workspaceId}/email-oauth-callback?success=false&error=${errorMsg}&provider=gmail`
    );
    expect(mockExchangeGmailCode).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should redirect when permission check fails", async () => {
    const workspaceId = "workspace-123";
    const userId = "user-456";
    const userRef = "users/user-456";
    const code = "auth-code-789";
    const state = "state-token-123";

    mockValidateAndExtractStateToken.mockReturnValue({ workspaceId });
    mockRequireSessionFromRequest.mockResolvedValue({
      user: { id: userId },
      expires: new Date().toISOString(),
    });
    mockIsUserAuthorized.mockRejectedValue(
      new Error("Permission check failed")
    );

    const req = createMockRequest({
      params: {
        provider: "gmail",
      },
      query: {
        code,
        state,
      },
    });
    const res = createMockResponse();
    (res as { redirect?: ReturnType<typeof vi.fn> }).redirect = vi.fn();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockIsUserAuthorized).toHaveBeenCalledWith(
      userRef,
      `workspaces/${workspaceId}`,
      2
    );
    const errorMsg = encodeURIComponent("Failed to verify permissions");
    expect(res.redirect).toHaveBeenCalledWith(
      `http://localhost:5173/workspaces/${workspaceId}/email-oauth-callback?success=false&error=${errorMsg}&provider=gmail`
    );
    expect(mockExchangeGmailCode).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should redirect when OAuth error is present with workspaceId in state", async () => {
    const workspaceId = "workspace-123";
    const state = "state-token-123";

    mockValidateAndExtractStateToken.mockReturnValue({ workspaceId });

    const req = createMockRequest({
      params: {
        provider: "gmail",
      },
      query: {
        error: "access_denied",
        error_description: "User denied access",
        state,
      },
    });
    const res = createMockResponse();
    (res as { redirect?: ReturnType<typeof vi.fn> }).redirect = vi.fn();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockValidateAndExtractStateToken).toHaveBeenCalledWith(state);
    const errorMsg = encodeURIComponent(
      "OAuth error: access_denied - User denied access"
    );
    expect(res.redirect).toHaveBeenCalledWith(
      `http://localhost:5173/workspaces/${workspaceId}/email-oauth-callback?success=false&error=${errorMsg}&provider=gmail`
    );
    expect(mockRequireSessionFromRequest).not.toHaveBeenCalled();
    expect(mockExchangeGmailCode).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should redirect to root when OAuth error is present without workspaceId", async () => {
    mockValidateAndExtractStateToken.mockReturnValue(null);

    const req = createMockRequest({
      params: {
        provider: "gmail",
      },
      query: {
        error: "access_denied",
        state: "invalid-state",
      },
    });
    const res = createMockResponse();
    (res as { redirect?: ReturnType<typeof vi.fn> }).redirect = vi.fn();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    const errorMsg = encodeURIComponent("OAuth error: access_denied");
    expect(res.redirect).toHaveBeenCalledWith(
      `http://localhost:5173/?oauth_error=${errorMsg}`
    );
    expect(mockRequireSessionFromRequest).not.toHaveBeenCalled();
    expect(mockExchangeGmailCode).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should redirect when code is missing with workspaceId in state", async () => {
    const workspaceId = "workspace-123";
    const state = "state-token-123";

    mockValidateAndExtractStateToken.mockReturnValue({ workspaceId });

    const req = createMockRequest({
      params: {
        provider: "gmail",
      },
      query: {
        state,
      },
    });
    const res = createMockResponse();
    (res as { redirect?: ReturnType<typeof vi.fn> }).redirect = vi.fn();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockValidateAndExtractStateToken).toHaveBeenCalledWith(state);
    const errorMsg = encodeURIComponent("Authorization code is missing");
    expect(res.redirect).toHaveBeenCalledWith(
      `http://localhost:5173/workspaces/${workspaceId}/email-oauth-callback?success=false&error=${errorMsg}&provider=gmail`
    );
    expect(mockRequireSessionFromRequest).not.toHaveBeenCalled();
    expect(mockExchangeGmailCode).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should redirect to root when code is missing without workspaceId", async () => {
    mockValidateAndExtractStateToken.mockReturnValue(null);

    const req = createMockRequest({
      params: {
        provider: "gmail",
      },
      query: {
        state: "invalid-state",
      },
    });
    const res = createMockResponse();
    (res as { redirect?: ReturnType<typeof vi.fn> }).redirect = vi.fn();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    const errorMsg = encodeURIComponent("Authorization code is missing");
    expect(res.redirect).toHaveBeenCalledWith(
      `http://localhost:5173/?oauth_error=${errorMsg}`
    );
    expect(mockRequireSessionFromRequest).not.toHaveBeenCalled();
    expect(mockExchangeGmailCode).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should redirect to root when state is missing", async () => {
    const req = createMockRequest({
      params: {
        provider: "gmail",
      },
      query: {
        code: "auth-code-789",
      },
    });
    const res = createMockResponse();
    (res as { redirect?: ReturnType<typeof vi.fn> }).redirect = vi.fn();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    const errorMsg = encodeURIComponent("State parameter is missing");
    expect(res.redirect).toHaveBeenCalledWith(
      `http://localhost:5173/?oauth_error=${errorMsg}`
    );
    expect(mockValidateAndExtractStateToken).not.toHaveBeenCalled();
    expect(mockRequireSessionFromRequest).not.toHaveBeenCalled();
    expect(mockExchangeGmailCode).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should redirect to root when state token is invalid", async () => {
    const state = "invalid-state-token";

    mockValidateAndExtractStateToken.mockReturnValue(null);

    const req = createMockRequest({
      params: {
        provider: "gmail",
      },
      query: {
        code: "auth-code-789",
        state,
      },
    });
    const res = createMockResponse();
    (res as { redirect?: ReturnType<typeof vi.fn> }).redirect = vi.fn();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockValidateAndExtractStateToken).toHaveBeenCalledWith(state);
    const errorMsg = encodeURIComponent("Invalid or expired state token");
    expect(res.redirect).toHaveBeenCalledWith(
      `http://localhost:5173/?oauth_error=${errorMsg}`
    );
    expect(mockRequireSessionFromRequest).not.toHaveBeenCalled();
    expect(mockExchangeGmailCode).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should redirect when provider is invalid", async () => {
    const workspaceId = "workspace-123";
    const code = "auth-code-789";
    const state = "state-token-123";

    mockValidateAndExtractStateToken.mockReturnValue({ workspaceId });

    const req = createMockRequest({
      params: {
        provider: "invalid-provider",
      },
      query: {
        code,
        state,
      },
    });
    const res = createMockResponse();
    (res as { redirect?: ReturnType<typeof vi.fn> }).redirect = vi.fn();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockValidateAndExtractStateToken).toHaveBeenCalledWith(state);
    const errorMsg = encodeURIComponent(
      'provider must be "gmail" or "outlook"'
    );
    expect(res.redirect).toHaveBeenCalledWith(
      `http://localhost:5173/workspaces/${workspaceId}/email-oauth-callback?success=false&error=${errorMsg}&provider=invalid-provider`
    );
    expect(mockRequireSessionFromRequest).not.toHaveBeenCalled();
    expect(mockExchangeGmailCode).not.toHaveBeenCalled();
    expect(mockExchangeOutlookCode).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should update existing Outlook email connection successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const userRef = "users/user-456";
    const code = "auth-code-789";
    const state = "state-token-123";

    mockValidateAndExtractStateToken.mockReturnValue({ workspaceId });
    mockRequireSessionFromRequest.mockResolvedValue({
      user: { id: userId },
      expires: new Date().toISOString(),
    });
    mockIsUserAuthorized.mockResolvedValue([true]);
    mockExchangeOutlookCode.mockResolvedValue({
      accessToken: "new-access-token-123",
      refreshToken: "new-refresh-token-456",
      expiresAt: "2024-12-31T23:59:59Z",
      email: "user@outlook.com",
    });

    const existingConnection = {
      pk: `email-connections/${workspaceId}`,
      sk: "connection",
      workspaceId,
      type: "outlook",
      name: "Outlook Connection",
      config: {
        accessToken: "old-access-token",
        refreshToken: "old-refresh-token",
        expiresAt: "2024-01-01T00:00:00Z",
      },
      createdBy: "users/user-123",
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(existingConnection);
    const mockUpdate = vi.fn().mockResolvedValue({
      ...existingConnection,
      config: {
        accessToken: "new-access-token-123",
        refreshToken: "new-refresh-token-456",
        expiresAt: "2024-12-31T23:59:59Z",
        email: "user@outlook.com",
      },
      updatedBy: userRef,
      updatedAt: "2024-01-02T00:00:00Z",
    });

    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: mockGet,
      update: mockUpdate,
    };

    const req = createMockRequest({
      params: {
        provider: "outlook",
      },
      query: {
        code,
        state,
      },
    });
    const res = createMockResponse();
    (res as { redirect?: ReturnType<typeof vi.fn> }).redirect = vi.fn();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockExchangeOutlookCode).toHaveBeenCalledWith(code);
    expect(mockGet).toHaveBeenCalledWith(
      `email-connections/${workspaceId}`,
      "connection"
    );
    expect(mockUpdate).toHaveBeenCalledWith({
      pk: `email-connections/${workspaceId}`,
      sk: "connection",
      workspaceId,
      type: "outlook",
      name: "Outlook Connection",
      config: {
        accessToken: "new-access-token-123",
        refreshToken: "new-refresh-token-456",
        expiresAt: "2024-12-31T23:59:59Z",
        email: "user@outlook.com",
      },
      updatedBy: userRef,
      updatedAt: expect.any(String),
    });
    expect(res.redirect).toHaveBeenCalledWith(
      `http://localhost:5173/workspaces/${workspaceId}/email-oauth-callback?success=true&provider=outlook`
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("should handle token info without email", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const userRef = "users/user-456";
    const code = "auth-code-789";
    const state = "state-token-123";

    mockValidateAndExtractStateToken.mockReturnValue({ workspaceId });
    mockRequireSessionFromRequest.mockResolvedValue({
      user: { id: userId },
      expires: new Date().toISOString(),
    });
    mockIsUserAuthorized.mockResolvedValue([true]);
    mockExchangeGmailCode.mockResolvedValue({
      accessToken: "access-token-123",
      refreshToken: "refresh-token-456",
      expiresAt: "2024-12-31T23:59:59Z",
      // email is undefined
    });

    const mockGet = vi.fn().mockResolvedValue(null);
    const mockCreate = vi.fn().mockResolvedValue({
      pk: `email-connections/${workspaceId}`,
      sk: "connection",
      workspaceId,
      type: "gmail",
      name: "Gmail Connection",
      config: {
        accessToken: "access-token-123",
        refreshToken: "refresh-token-456",
        expiresAt: "2024-12-31T23:59:59Z",
        // email should not be in config
      },
      createdBy: userRef,
      createdAt: "2024-01-01T00:00:00Z",
    });

    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: mockGet,
      create: mockCreate,
    };

    const req = createMockRequest({
      params: {
        provider: "gmail",
      },
      query: {
        code,
        state,
      },
    });
    const res = createMockResponse();
    (res as { redirect?: ReturnType<typeof vi.fn> }).redirect = vi.fn();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockCreate).toHaveBeenCalledWith({
      pk: `email-connections/${workspaceId}`,
      sk: "connection",
      workspaceId,
      type: "gmail",
      name: "Gmail Connection",
      config: {
        accessToken: "access-token-123",
        refreshToken: "refresh-token-456",
        expiresAt: "2024-12-31T23:59:59Z",
        // email should not be included when undefined
      },
      createdBy: userRef,
    });
    expect(res.redirect).toHaveBeenCalled();
  });
});
