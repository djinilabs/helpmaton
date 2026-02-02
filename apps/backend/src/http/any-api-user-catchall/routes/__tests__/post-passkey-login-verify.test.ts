import { badRequest } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
} from "../../../utils/__tests__/test-helpers";

const mockGetPasskeyChallengeFromCookie = vi.hoisted(() => vi.fn());
const mockVerifyPasskeyAuthentication = vi.hoisted(() => vi.fn());
const mockUpdatePasskeyCounter = vi.hoisted(() => vi.fn());
const mockGeneratePasskeyLoginToken = vi.hoisted(() => vi.fn());

vi.mock("../../../../utils/passkeyChallengeCookie", () => ({
  getPasskeyChallengeFromCookie: mockGetPasskeyChallengeFromCookie,
}));

vi.mock("../../../../utils/passkey", () => ({
  verifyPasskeyAuthentication: mockVerifyPasskeyAuthentication,
  updatePasskeyCounter: mockUpdatePasskeyCounter,
}));

vi.mock("../../../../utils/tokenUtils", () => ({
  generatePasskeyLoginToken: mockGeneratePasskeyLoginToken,
}));

const validBody = {
  id: "cred-id-base64",
  rawId: "raw-id-base64",
  type: "public-key" as const,
  response: {
    clientDataJSON: "clientData",
    authenticatorData: "authData",
    signature: "sig",
  },
};

describe("POST /api/user/passkey/login/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function callHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>,
    next: express.NextFunction
  ) {
    const { validateBody } = await import("../../../utils/bodyValidation");
    const { passkeyLoginVerifySchema } = await import(
      "../../../utils/schemas/userSchemas"
    );
    const handler = async (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      try {
        const cookieHeader = req.headers.cookie;
        const expectedChallenge = await mockGetPasskeyChallengeFromCookie(
          cookieHeader,
          "passkey-login"
        );
        if (!expectedChallenge) {
          throw badRequest(
            "Missing or invalid passkey challenge. Please request new login options."
          );
        }
        const body = validateBody(req.body ?? {}, passkeyLoginVerifySchema);
        const result = await mockVerifyPasskeyAuthentication(
          body,
          expectedChallenge
        );
        if (!result) {
          throw badRequest("Passkey authentication verification failed");
        }
        const { userId, newCounter } = result;
        const credentialIdBase64 = body.id;
        await mockUpdatePasskeyCounter(userId, credentialIdBase64, newCounter);
        const token = await mockGeneratePasskeyLoginToken(userId);
        res.status(200).json({ token });
      } catch (error) {
        next(error);
      }
    };
    await handler(req as express.Request, res as express.Response, next);
  }

  it("should call next with badRequest when challenge cookie is missing", async () => {
    mockGetPasskeyChallengeFromCookie.mockResolvedValue(null);

    const req = createMockRequest({
      body: validBody,
      headers: {},
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining("Missing or invalid passkey challenge"),
          }),
        }),
      })
    );
    expect(mockVerifyPasskeyAuthentication).not.toHaveBeenCalled();
  });

  it("should call next with validation error when body is invalid", async () => {
    mockGetPasskeyChallengeFromCookie.mockResolvedValue("challenge");

    const req = createMockRequest({
      body: {},
      headers: {},
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callHandler(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mockVerifyPasskeyAuthentication).not.toHaveBeenCalled();
  });

  it("should call next with badRequest when verification returns null", async () => {
    mockGetPasskeyChallengeFromCookie.mockResolvedValue("challenge");
    mockVerifyPasskeyAuthentication.mockResolvedValue(null);

    const req = createMockRequest({
      body: validBody,
      headers: {},
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining("verification failed"),
          }),
        }),
      })
    );
    expect(mockGeneratePasskeyLoginToken).not.toHaveBeenCalled();
  });

  it("should return 200 and token on success", async () => {
    mockGetPasskeyChallengeFromCookie.mockResolvedValue("challenge");
    mockVerifyPasskeyAuthentication.mockResolvedValue({
      userId: "user-123",
      newCounter: 1,
    });
    mockUpdatePasskeyCounter.mockResolvedValue(undefined);
    mockGeneratePasskeyLoginToken.mockResolvedValue("one-time-jwt");

    const req = createMockRequest({
      body: validBody,
      headers: {},
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ token: "one-time-jwt" });
    expect(mockVerifyPasskeyAuthentication).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cred-id-base64" }),
      "challenge"
    );
    expect(mockUpdatePasskeyCounter).toHaveBeenCalledWith(
      "user-123",
      "cred-id-base64",
      1
    );
    expect(mockGeneratePasskeyLoginToken).toHaveBeenCalledWith("user-123");
    expect(next).not.toHaveBeenCalled();
  });
});
