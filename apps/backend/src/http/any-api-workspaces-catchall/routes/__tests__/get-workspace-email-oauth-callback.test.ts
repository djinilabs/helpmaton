import { badRequest, unauthorized } from "@hapi/boom";
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
  mockValidateStateToken,
  mockExchangeGmailCode,
  mockExchangeOutlookCode,
} = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockValidateStateToken: vi.fn(),
    mockExchangeGmailCode: vi.fn(),
    mockExchangeOutlookCode: vi.fn(),
  };
});

// Mock the modules
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/oauth/common", () => ({
  validateStateToken: mockValidateStateToken,
}));

vi.mock("../../../../utils/oauth/gmail", () => ({
  exchangeGmailCode: mockExchangeGmailCode,
}));

vi.mock("../../../../utils/oauth/outlook", () => ({
  exchangeOutlookCode: mockExchangeOutlookCode,
}));

describe("GET /api/workspaces/:workspaceId/email/oauth/:provider/callback", () => {
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
        const workspaceId = req.params.workspaceId;
        const provider = req.params.provider as "gmail" | "outlook";
        const code = req.query.code as string | undefined;
        const state = req.query.state as string | undefined;
        const error = req.query.error as string | undefined;

        if (error) {
          const errorDescription = req.query.error_description as
            | string
            | undefined;
          throw badRequest(
            `OAuth error: ${error}${
              errorDescription ? ` - ${errorDescription}` : ""
            }`
          );
        }

        if (!code) {
          throw badRequest("Authorization code is missing");
        }

        if (!state) {
          throw badRequest("State parameter is missing");
        }

        // Validate state token (includes workspaceId)
        const { validateStateToken } = await import(
          "../../../../utils/oauth/common"
        );
        if (!validateStateToken(state, workspaceId)) {
          throw badRequest("Invalid or expired state token");
        }

        if (!["gmail", "outlook"].includes(provider)) {
          throw badRequest('provider must be "gmail" or "outlook"');
        }

        const db = await mockDatabase();
        const currentUserRef = (req as { userRef?: string }).userRef;
        if (!currentUserRef) {
          throw unauthorized();
        }

        // Exchange code for tokens
        let tokenInfo: {
          accessToken: string;
          refreshToken: string;
          expiresAt: string;
          email?: string;
        };
        if (provider === "gmail") {
          const { exchangeGmailCode } = await import(
            "../../../../utils/oauth/gmail"
          );
          tokenInfo = await exchangeGmailCode(code);
        } else {
          const { exchangeOutlookCode } = await import(
            "../../../../utils/oauth/outlook"
          );
          tokenInfo = await exchangeOutlookCode(code);
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
    const userRef = "users/user-456";
    const code = "auth-code-789";
    const state = "state-token-123";

    mockValidateStateToken.mockReturnValue(true);
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
      userRef,
      params: {
        workspaceId,
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

    expect(mockValidateStateToken).toHaveBeenCalledWith(state, workspaceId);
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

  it("should update existing Gmail email connection successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userRef = "users/user-456";
    const code = "auth-code-789";
    const state = "state-token-123";

    mockValidateStateToken.mockReturnValue(true);
    mockExchangeGmailCode.mockResolvedValue({
      accessToken: "new-access-token-123",
      refreshToken: "new-refresh-token-456",
      expiresAt: "2024-12-31T23:59:59Z",
      email: "user@gmail.com",
    });

    const existingConnection = {
      pk: `email-connections/${workspaceId}`,
      sk: "connection",
      workspaceId,
      type: "gmail",
      name: "Gmail Connection",
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
        email: "user@gmail.com",
      },
      updatedBy: userRef,
      updatedAt: "2024-01-02T00:00:00Z",
    });

    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: mockGet,
      update: mockUpdate,
    };

    const req = createMockRequest({
      userRef,
      params: {
        workspaceId,
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

    expect(mockGet).toHaveBeenCalledWith(
      `email-connections/${workspaceId}`,
      "connection"
    );
    expect(mockUpdate).toHaveBeenCalledWith({
      pk: `email-connections/${workspaceId}`,
      sk: "connection",
      workspaceId,
      type: "gmail",
      name: "Gmail Connection",
      config: {
        accessToken: "new-access-token-123",
        refreshToken: "new-refresh-token-456",
        expiresAt: "2024-12-31T23:59:59Z",
        email: "user@gmail.com",
      },
      updatedBy: userRef,
      updatedAt: expect.any(String),
    });
    expect(res.redirect).toHaveBeenCalledWith(
      `http://localhost:5173/workspaces/${workspaceId}/email-oauth-callback?success=true&provider=gmail`
    );
  });

  it("should create new Outlook email connection successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userRef = "users/user-456";
    const code = "auth-code-789";
    const state = "state-token-123";

    mockValidateStateToken.mockReturnValue(true);
    mockExchangeOutlookCode.mockResolvedValue({
      accessToken: "access-token-123",
      refreshToken: "refresh-token-456",
      expiresAt: "2024-12-31T23:59:59Z",
      email: "user@outlook.com",
    });

    const mockGet = vi.fn().mockResolvedValue(null);
    const mockCreate = vi.fn().mockResolvedValue({
      pk: `email-connections/${workspaceId}`,
      sk: "connection",
      workspaceId,
      type: "outlook",
      name: "Outlook Connection",
      config: {
        accessToken: "access-token-123",
        refreshToken: "refresh-token-456",
        expiresAt: "2024-12-31T23:59:59Z",
        email: "user@outlook.com",
      },
      createdBy: userRef,
      createdAt: "2024-01-01T00:00:00Z",
    });

    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: mockGet,
      create: mockCreate,
    };

    const req = createMockRequest({
      userRef,
      params: {
        workspaceId,
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

    expect(mockValidateStateToken).toHaveBeenCalledWith(state, workspaceId);
    expect(mockExchangeOutlookCode).toHaveBeenCalledWith(code);
    expect(mockGet).toHaveBeenCalledWith(
      `email-connections/${workspaceId}`,
      "connection"
    );
    expect(mockCreate).toHaveBeenCalledWith({
      pk: `email-connections/${workspaceId}`,
      sk: "connection",
      workspaceId,
      type: "outlook",
      name: "Outlook Connection",
      config: {
        accessToken: "access-token-123",
        refreshToken: "refresh-token-456",
        expiresAt: "2024-12-31T23:59:59Z",
        email: "user@outlook.com",
      },
      createdBy: userRef,
    });
    expect(res.redirect).toHaveBeenCalledWith(
      `http://localhost:5173/workspaces/${workspaceId}/email-oauth-callback?success=true&provider=outlook`
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("should throw badRequest when OAuth error is present", async () => {
    const workspaceId = "workspace-123";
    const userRef = "users/user-456";

    const req = createMockRequest({
      userRef,
      params: {
        workspaceId,
        provider: "gmail",
      },
      query: {
        error: "access_denied",
        error_description: "User denied access",
      },
    });
    const res = createMockResponse();
    (res as { redirect?: ReturnType<typeof vi.fn> }).redirect = vi.fn();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining("OAuth error: access_denied"),
          }),
        }),
      })
    );
    expect(mockValidateStateToken).not.toHaveBeenCalled();
    expect(mockExchangeGmailCode).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it("should throw badRequest when code is missing", async () => {
    const workspaceId = "workspace-123";
    const userRef = "users/user-456";
    const state = "state-token-123";

    const req = createMockRequest({
      userRef,
      params: {
        workspaceId,
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

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: "Authorization code is missing",
          }),
        }),
      })
    );
    expect(mockValidateStateToken).not.toHaveBeenCalled();
    expect(mockExchangeGmailCode).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it("should throw badRequest when state is missing", async () => {
    const workspaceId = "workspace-123";
    const userRef = "users/user-456";
    const code = "auth-code-789";

    const req = createMockRequest({
      userRef,
      params: {
        workspaceId,
        provider: "gmail",
      },
      query: {
        code,
      },
    });
    const res = createMockResponse();
    (res as { redirect?: ReturnType<typeof vi.fn> }).redirect = vi.fn();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: "State parameter is missing",
          }),
        }),
      })
    );
    expect(mockValidateStateToken).not.toHaveBeenCalled();
    expect(mockExchangeGmailCode).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it("should throw badRequest when state token is invalid", async () => {
    const workspaceId = "workspace-123";
    const userRef = "users/user-456";
    const code = "auth-code-789";
    const state = "invalid-state-token";

    mockValidateStateToken.mockReturnValue(false);

    const req = createMockRequest({
      userRef,
      params: {
        workspaceId,
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

    expect(mockValidateStateToken).toHaveBeenCalledWith(state, workspaceId);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: "Invalid or expired state token",
          }),
        }),
      })
    );
    expect(mockExchangeGmailCode).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it("should throw badRequest when provider is invalid", async () => {
    const workspaceId = "workspace-123";
    const userRef = "users/user-456";
    const code = "auth-code-789";
    const state = "state-token-123";

    mockValidateStateToken.mockReturnValue(true);

    const req = createMockRequest({
      userRef,
      params: {
        workspaceId,
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

    expect(mockValidateStateToken).toHaveBeenCalledWith(state, workspaceId);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: 'provider must be "gmail" or "outlook"',
          }),
        }),
      })
    );
    expect(mockExchangeGmailCode).not.toHaveBeenCalled();
    expect(mockExchangeOutlookCode).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it("should throw unauthorized when userRef is missing", async () => {
    const workspaceId = "workspace-123";
    const code = "auth-code-789";
    const state = "state-token-123";

    mockValidateStateToken.mockReturnValue(true);

    const req = createMockRequest({
      params: {
        workspaceId,
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

    expect(mockValidateStateToken).toHaveBeenCalledWith(state, workspaceId);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 401,
        }),
      })
    );
    expect(mockExchangeGmailCode).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it("should handle token info without email", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userRef = "users/user-456";
    const code = "auth-code-789";
    const state = "state-token-123";

    mockValidateStateToken.mockReturnValue(true);
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
      userRef,
      params: {
        workspaceId,
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
