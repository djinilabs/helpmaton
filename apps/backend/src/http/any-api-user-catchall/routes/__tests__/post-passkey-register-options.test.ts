import { unauthorized } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
} from "../../../utils/__tests__/test-helpers";

const mockGeneratePasskeyRegistrationOptions = vi.hoisted(() => vi.fn());
const mockListPasskeysForUser = vi.hoisted(() => vi.fn());
const mockSetPasskeyChallengeCookie = vi.hoisted(() => vi.fn());

vi.mock("../../../../utils/passkey", () => ({
  generatePasskeyRegistrationOptions: mockGeneratePasskeyRegistrationOptions,
  listPasskeysForUser: mockListPasskeysForUser,
}));

vi.mock("../../../../utils/passkeyChallengeCookie", () => ({
  setPasskeyChallengeCookie: mockSetPasskeyChallengeCookie,
}));

describe("POST /api/user/passkey/register/options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function callHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>,
    next: express.NextFunction
  ) {
    const handler = async (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      try {
        const session = req.session;
        if (!session?.user?.id || !session?.user?.email) {
          throw unauthorized("User authentication required");
        }
        const userId = session.user.id;
        const userEmail = session.user.email;
        const existingPasskeys = await mockListPasskeysForUser(userId);
        const excludeCredentialIds = existingPasskeys.map((p: { sk: string }) =>
          p.sk.replace(/^PASSKEY#/, "")
        );
        const { options } = await mockGeneratePasskeyRegistrationOptions(
          userId,
          userEmail,
          excludeCredentialIds.length > 0 ? excludeCredentialIds : undefined
        );
        const challenge =
          typeof options.challenge === "string"
            ? options.challenge
            : Buffer.from(options.challenge).toString("base64url");
        await mockSetPasskeyChallengeCookie(res, challenge, "passkey-register");
        res.json(options);
      } catch (error) {
        next(error);
      }
    };
    await handler(req as express.Request, res as express.Response, next);
  }

  it("should return options and set challenge cookie when user has no passkeys", async () => {
    mockListPasskeysForUser.mockResolvedValue([]);
    const options = {
      challenge: "challenge-base64",
      rp: { name: "Helpmaton", id: "localhost" },
      user: { id: "user-id", name: "user@example.com", displayName: "user@example.com" },
    };
    mockGeneratePasskeyRegistrationOptions.mockResolvedValue({
      options,
      origin: "http://localhost:5173",
    });
    mockSetPasskeyChallengeCookie.mockResolvedValue(undefined);

    const req = createMockRequest({
      session: {
        user: { id: "user-123", email: "user@example.com" },
      } as express.Request["session"],
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callHandler(req, res, next);

    expect(mockListPasskeysForUser).toHaveBeenCalledWith("user-123");
    expect(mockGeneratePasskeyRegistrationOptions).toHaveBeenCalledWith(
      "user-123",
      "user@example.com",
      undefined
    );
    expect(mockSetPasskeyChallengeCookie).toHaveBeenCalledWith(
      res,
      "challenge-base64",
      "passkey-register"
    );
    expect(res.json).toHaveBeenCalledWith(options);
    expect(next).not.toHaveBeenCalled();
  });

  it("should pass excludeCredentialIds when user has existing passkeys", async () => {
    mockListPasskeysForUser.mockResolvedValue([
      { sk: "PASSKEY#cred1" },
      { sk: "PASSKEY#cred2" },
    ]);
    const options = {
      challenge: "challenge-base64",
      rp: { name: "Helpmaton" },
      user: { id: "user-id", name: "user@example.com", displayName: "user@example.com" },
      excludeCredentials: [{ id: "cred1", type: "public-key" }, { id: "cred2", type: "public-key" }],
    };
    mockGeneratePasskeyRegistrationOptions.mockResolvedValue({
      options,
      origin: "http://localhost:5173",
    });
    mockSetPasskeyChallengeCookie.mockResolvedValue(undefined);

    const req = createMockRequest({
      session: {
        user: { id: "user-456", email: "other@example.com" },
      } as express.Request["session"],
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callHandler(req, res, next);

    expect(mockGeneratePasskeyRegistrationOptions).toHaveBeenCalledWith(
      "user-456",
      "other@example.com",
      ["cred1", "cred2"]
    );
    expect(res.json).toHaveBeenCalledWith(options);
    expect(next).not.toHaveBeenCalled();
  });

  it("should call next with unauthorized when session has no user", async () => {
    const req = createMockRequest({ session: undefined });
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
    expect(mockListPasskeysForUser).not.toHaveBeenCalled();
  });
});
