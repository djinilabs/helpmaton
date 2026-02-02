import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
} from "../../../utils/__tests__/test-helpers";

const mockGeneratePasskeyAuthenticationOptions = vi.hoisted(() => vi.fn());
const mockSetPasskeyChallengeCookie = vi.hoisted(() => vi.fn());

vi.mock("../../../../utils/passkey", () => ({
  generatePasskeyAuthenticationOptions: mockGeneratePasskeyAuthenticationOptions,
}));

vi.mock("../../../../utils/passkeyChallengeCookie", () => ({
  setPasskeyChallengeCookie: mockSetPasskeyChallengeCookie,
}));

describe("GET /api/user/passkey/login/options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function callHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>,
    next: express.NextFunction
  ) {
    const handler = async (
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      try {
        const { options } = await mockGeneratePasskeyAuthenticationOptions();
        const challenge =
          typeof options.challenge === "string"
            ? options.challenge
            : Buffer.from(options.challenge).toString("base64url");
        await mockSetPasskeyChallengeCookie(res, challenge, "passkey-login");
        res.json(options);
      } catch (error) {
        next(error);
      }
    };
    await handler(req as express.Request, res as express.Response, next);
  }

  it("should return options and set challenge cookie", async () => {
    const options = {
      challenge: "base64url-challenge",
      rpId: "localhost",
      timeout: 60000,
    };
    mockGeneratePasskeyAuthenticationOptions.mockResolvedValue({
      options,
      origin: "http://localhost:5173",
    });
    mockSetPasskeyChallengeCookie.mockResolvedValue(undefined);

    const req = createMockRequest();
    const res = createMockResponse();
    const next = vi.fn();

    await callHandler(req, res, next);

    expect(res.json).toHaveBeenCalledWith(options);
    expect(mockGeneratePasskeyAuthenticationOptions).toHaveBeenCalled();
    expect(mockSetPasskeyChallengeCookie).toHaveBeenCalledWith(
      res,
      "base64url-challenge",
      "passkey-login"
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("should convert buffer challenge to base64url when setting cookie", async () => {
    const challengeBuffer = Buffer.from("challenge-bytes");
    mockGeneratePasskeyAuthenticationOptions.mockResolvedValue({
      options: { challenge: challengeBuffer, rpId: "localhost" },
      origin: "http://localhost:5173",
    });
    mockSetPasskeyChallengeCookie.mockResolvedValue(undefined);

    const req = createMockRequest();
    const res = createMockResponse();
    const next = vi.fn();

    await callHandler(req, res, next);

    expect(mockSetPasskeyChallengeCookie).toHaveBeenCalledWith(
      res,
      expect.any(String),
      "passkey-login"
    );
  });
});
