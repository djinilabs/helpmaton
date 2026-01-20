import type express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
} from "../../../utils/__tests__/test-helpers";
import { registerPostVerifyAuthGate } from "../post-verify-auth-gate";

const {
  mockValidateCloudflareTurnstile,
  mockNormalizeAuthCallbackUrl,
  mockExtractEmailFromCallbackUrl,
  mockCreateAuthGateToken,
  mockHandleError,
} = vi.hoisted(() => {
  return {
    mockValidateCloudflareTurnstile: vi.fn(),
    mockNormalizeAuthCallbackUrl: vi.fn(),
    mockExtractEmailFromCallbackUrl: vi.fn(),
    mockCreateAuthGateToken: vi.fn(),
    mockHandleError: vi.fn(),
  };
});

vi.mock("../../../../utils/captcha", () => ({
  validateCloudflareTurnstile: mockValidateCloudflareTurnstile,
}));

vi.mock("../../../../utils/authGate", () => ({
  normalizeAuthCallbackUrl: mockNormalizeAuthCallbackUrl,
  extractEmailFromCallbackUrl: mockExtractEmailFromCallbackUrl,
  createAuthGateToken: mockCreateAuthGateToken,
}));

vi.mock("../../../any-api-workspaces-catchall/middleware", () => ({
  handleError: mockHandleError,
}));

describe("POST /api/user/verify-gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FRONTEND_URL = "http://localhost:5173";
  });

  const getHandler = () => {
    const app = {
      post: vi.fn(),
    } as unknown as express.Application;
    registerPostVerifyAuthGate(app);
    return (app.post as ReturnType<typeof vi.fn>).mock.calls[0][1] as (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => Promise<void>;
  };

  it("returns a gate token for valid requests", async () => {
    const handler = getHandler();
    const callbackUrl =
      "http://localhost:5173/api/auth/callback/email?token=abc&email=test@example.com";
    const normalizedUrl = new URL(callbackUrl);

    mockValidateCloudflareTurnstile.mockResolvedValue(true);
    mockNormalizeAuthCallbackUrl.mockReturnValue(normalizedUrl);
    mockExtractEmailFromCallbackUrl.mockReturnValue("test@example.com");
    mockCreateAuthGateToken.mockResolvedValue("gate-token");

    const req = createMockRequest({
      body: {
        captchaToken: "captcha-token",
        acceptedTerms: true,
        callbackUrl,
      },
      ip: "127.0.0.1",
    });
    const res = createMockResponse();
    const next = vi.fn();

    await handler(req as express.Request, res as express.Response, next);

    expect(mockValidateCloudflareTurnstile).toHaveBeenCalledWith(
      "captcha-token",
      "127.0.0.1"
    );
    expect(mockNormalizeAuthCallbackUrl).toHaveBeenCalledWith(
      callbackUrl,
      "http://localhost:5173"
    );
    expect(mockExtractEmailFromCallbackUrl).toHaveBeenCalledWith(normalizedUrl);
    expect(mockCreateAuthGateToken).toHaveBeenCalledWith({
      email: "test@example.com",
      callbackUrl: normalizedUrl.toString(),
    });
    expect(res.json).toHaveBeenCalledWith({ gateToken: "gate-token" });
    expect(mockHandleError).not.toHaveBeenCalled();
  });

  it("handles failed captcha validation", async () => {
    const handler = getHandler();
    const callbackUrl =
      "http://localhost:5173/api/auth/callback/email?token=abc&email=test@example.com";

    mockValidateCloudflareTurnstile.mockResolvedValue(false);
    mockNormalizeAuthCallbackUrl.mockReturnValue(new URL(callbackUrl));
    mockExtractEmailFromCallbackUrl.mockReturnValue("test@example.com");

    const req = createMockRequest({
      body: {
        captchaToken: "captcha-token",
        acceptedTerms: true,
        callbackUrl,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await handler(req as express.Request, res as express.Response, next);

    expect(mockHandleError).toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
