import type express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { buildAuthGateMiddleware } from "../auth-app";

const {
  mockGetUserByEmail,
  mockNormalizeAuthCallbackUrl,
  mockVerifyAuthGateToken,
} = vi.hoisted(() => {
  return {
    mockGetUserByEmail: vi.fn(),
    mockNormalizeAuthCallbackUrl: vi.fn(),
    mockVerifyAuthGateToken: vi.fn(),
  };
});

vi.mock("../../../utils/subscriptionUtils", () => ({
  getUserByEmail: mockGetUserByEmail,
}));

vi.mock("../../../utils/authGate", () => ({
  normalizeAuthCallbackUrl: mockNormalizeAuthCallbackUrl,
  verifyAuthGateToken: mockVerifyAuthGateToken,
}));

describe("auth-app auth gate middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.E2E_AUTH_GATE_BYPASS;
  });

  const createReq = (
    overrides: Partial<express.Request> = {}
  ): express.Request => {
    return {
      query: {},
      originalUrl: "/api/auth/callback/email?token=abc&email=test@example.com",
      ...overrides,
    } as express.Request;
  };

  const createRes = () =>
    ({
      redirect: vi.fn(),
    }) as unknown as express.Response;

  it("skips gate when email is missing", async () => {
    const middleware = buildAuthGateMiddleware("http://localhost:5173");
    const req = createReq({ query: {} });
    const res = createRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it("skips gate for existing users", async () => {
    mockGetUserByEmail.mockResolvedValue({
      userId: "user-1",
      email: "test@example.com",
    });

    const middleware = buildAuthGateMiddleware("http://localhost:5173");
    const req = createReq({
      query: { email: "test@example.com" },
    });
    const res = createRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it("skips gate when bypass env is set", async () => {
    process.env.E2E_AUTH_GATE_BYPASS = "true";
    mockGetUserByEmail.mockResolvedValue(undefined);

    const middleware = buildAuthGateMiddleware("http://localhost:5173");
    const req = createReq({
      query: { email: "test@example.com" },
    });
    const res = createRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it("redirects to gate when gate token is missing", async () => {
    mockGetUserByEmail.mockResolvedValue(undefined);
    mockNormalizeAuthCallbackUrl.mockReturnValue(
      new URL("http://localhost:5173/api/auth/callback/email?token=abc")
    );

    const middleware = buildAuthGateMiddleware("http://localhost:5173");
    const req = createReq({
      query: { email: "test@example.com" },
    });
    const res = createRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith(
      302,
      "http://localhost:5173/auth/gate?callbackUrl=http%3A%2F%2Flocalhost%3A5173%2Fapi%2Fauth%2Fcallback%2Femail%3Ftoken%3Dabc&error=missing_gate"
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("redirects to gate when gate token is invalid", async () => {
    mockGetUserByEmail.mockResolvedValue(undefined);
    mockNormalizeAuthCallbackUrl.mockReturnValue(
      new URL("http://localhost:5173/api/auth/callback/email?token=abc")
    );
    mockVerifyAuthGateToken.mockRejectedValue(new Error("invalid"));

    const middleware = buildAuthGateMiddleware("http://localhost:5173");
    const req = createReq({
      query: { email: "test@example.com", gateToken: "bad-token" },
    });
    const res = createRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith(
      302,
      "http://localhost:5173/auth/gate?callbackUrl=http%3A%2F%2Flocalhost%3A5173%2Fapi%2Fauth%2Fcallback%2Femail%3Ftoken%3Dabc&error=invalid_gate"
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("redirects when gate payload mismatches", async () => {
    mockGetUserByEmail.mockResolvedValue(undefined);
    mockNormalizeAuthCallbackUrl.mockReturnValue(
      new URL("http://localhost:5173/api/auth/callback/email?token=abc")
    );
    mockVerifyAuthGateToken.mockResolvedValue({
      email: "other@example.com",
      callbackUrl: "http://localhost:5173/api/auth/callback/email?token=abc",
    });

    const middleware = buildAuthGateMiddleware("http://localhost:5173");
    const req = createReq({
      query: { email: "test@example.com", gateToken: "token" },
    });
    const res = createRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith(
      302,
      "http://localhost:5173/auth/gate?callbackUrl=http%3A%2F%2Flocalhost%3A5173%2Fapi%2Fauth%2Fcallback%2Femail%3Ftoken%3Dabc&error=invalid_gate"
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("continues when gate token matches", async () => {
    mockGetUserByEmail.mockResolvedValue(undefined);
    mockNormalizeAuthCallbackUrl.mockReturnValue(
      new URL("http://localhost:5173/api/auth/callback/email?token=abc")
    );
    mockVerifyAuthGateToken.mockResolvedValue({
      email: "test@example.com",
      callbackUrl: "http://localhost:5173/api/auth/callback/email?token=abc",
    });

    const middleware = buildAuthGateMiddleware("http://localhost:5173");
    const req = createReq({
      query: { email: "test@example.com", gateToken: "token" },
    });
    const res = createRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });
});
