import { badRequest, unauthorized } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
} from "../../../utils/__tests__/test-helpers";

const mockGetPasskeyChallengeFromCookie = vi.hoisted(() => vi.fn());
const mockClearPasskeyChallengeCookie = vi.hoisted(() => vi.fn());
const mockVerifyPasskeyRegistration = vi.hoisted(() => vi.fn());

vi.mock("../../../../utils/passkeyChallengeCookie", () => ({
  clearPasskeyChallengeCookie: mockClearPasskeyChallengeCookie,
  getPasskeyChallengeFromCookie: mockGetPasskeyChallengeFromCookie,
}));

vi.mock("../../../../utils/passkey", () => ({
  verifyPasskeyRegistration: mockVerifyPasskeyRegistration,
}));

const validBody = {
  id: "cred-id-base64",
  rawId: "raw-id-base64",
  type: "public-key" as const,
  response: {
    clientDataJSON: "clientData",
    attestationObject: "attestation",
  },
};

describe("POST /api/user/passkey/register/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function callHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>,
    next: express.NextFunction
  ) {
    const { validateBody } = await import("../../../utils/bodyValidation");
    const { passkeyRegisterVerifySchema } = await import(
      "../../../utils/schemas/userSchemas"
    );
    const handler = async (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      try {
        const session = req.session;
        if (!session?.user?.id) {
          throw unauthorized("User authentication required");
        }
        const userId = session.user.id;
        const cookieHeader = req.headers.cookie;
        const expectedChallenge = await mockGetPasskeyChallengeFromCookie(
          cookieHeader,
          "passkey-register"
        );
        if (!expectedChallenge) {
          throw badRequest(
            "Missing or invalid passkey challenge. Please request new registration options."
          );
        }
        const body = validateBody(req.body ?? {}, passkeyRegisterVerifySchema);
        const result = await mockVerifyPasskeyRegistration(
          userId,
          body,
          expectedChallenge
        );
        if (!result.verified) {
          throw badRequest("Passkey registration verification failed");
        }
        mockClearPasskeyChallengeCookie(res);
        res.status(200).json({ verified: true });
      } catch (error) {
        next(error);
      }
    };
    await handler(req as express.Request, res as express.Response, next);
  }

  it("should return 200 and clear challenge cookie on success", async () => {
    mockGetPasskeyChallengeFromCookie.mockResolvedValue("challenge");
    mockVerifyPasskeyRegistration.mockResolvedValue({ verified: true });

    const req = createMockRequest({
      body: validBody,
      headers: {},
      session: {
        user: { id: "user-123" },
      } as express.Request["session"],
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ verified: true });
    expect(mockClearPasskeyChallengeCookie).toHaveBeenCalledWith(res);
    expect(mockVerifyPasskeyRegistration).toHaveBeenCalledWith(
      "user-123",
      expect.objectContaining({ id: "cred-id-base64" }),
      "challenge"
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("should call next with badRequest when challenge cookie is missing", async () => {
    mockGetPasskeyChallengeFromCookie.mockResolvedValue(null);

    const req = createMockRequest({
      body: validBody,
      headers: {},
      session: { user: { id: "user-123" } } as express.Request["session"],
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
    expect(mockVerifyPasskeyRegistration).not.toHaveBeenCalled();
  });

  it("should call next when body is invalid", async () => {
    mockGetPasskeyChallengeFromCookie.mockResolvedValue("challenge");

    const req = createMockRequest({
      body: {},
      headers: {},
      session: { user: { id: "user-123" } } as express.Request["session"],
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callHandler(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mockVerifyPasskeyRegistration).not.toHaveBeenCalled();
  });

  it("should call next with badRequest when verification returns verified false", async () => {
    mockGetPasskeyChallengeFromCookie.mockResolvedValue("challenge");
    mockVerifyPasskeyRegistration.mockResolvedValue({ verified: false });

    const req = createMockRequest({
      body: validBody,
      headers: {},
      session: { user: { id: "user-123" } } as express.Request["session"],
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
    expect(mockClearPasskeyChallengeCookie).not.toHaveBeenCalled();
  });

  it("should call next with unauthorized when session has no user", async () => {
    const req = createMockRequest({
      body: validBody,
      headers: {},
      session: undefined,
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 401,
          payload: expect.objectContaining({
            message: expect.stringContaining("User authentication required"),
          }),
        }),
      })
    );
    expect(mockGetPasskeyChallengeFromCookie).not.toHaveBeenCalled();
  });
});
