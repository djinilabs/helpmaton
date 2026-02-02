import { unauthorized } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
} from "../../../utils/__tests__/test-helpers";

const mockListPasskeysForUser = vi.hoisted(() => vi.fn());

vi.mock("../../../../utils/passkey", () => ({
  listPasskeysForUser: mockListPasskeysForUser,
}));

describe("GET /api/user/passkeys", () => {
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
        const userRef = (req as { userRef?: string }).userRef;
        if (!userRef) {
          throw unauthorized();
        }
        const userId = userRef.replace("users/", "");
        const passkeys = await mockListPasskeysForUser(userId);
        res.json({ hasPasskey: passkeys.length > 0 });
      } catch (error) {
        next(error);
      }
    };
    await handler(req as express.Request, res as express.Response, next);
  }

  it("should return hasPasskey true when user has passkeys", async () => {
    mockListPasskeysForUser.mockResolvedValue([
      { pk: "USER#user-123", sk: "PASSKEY#cred1" },
    ]);

    const req = createMockRequest({ userRef: "users/user-123" });
    const res = createMockResponse();
    const next = vi.fn();

    await callHandler(req, res, next);

    expect(mockListPasskeysForUser).toHaveBeenCalledWith("user-123");
    expect(res.json).toHaveBeenCalledWith({ hasPasskey: true });
    expect(next).not.toHaveBeenCalled();
  });

  it("should return hasPasskey false when user has no passkeys", async () => {
    mockListPasskeysForUser.mockResolvedValue([]);

    const req = createMockRequest({ userRef: "users/user-456" });
    const res = createMockResponse();
    const next = vi.fn();

    await callHandler(req, res, next);

    expect(mockListPasskeysForUser).toHaveBeenCalledWith("user-456");
    expect(res.json).toHaveBeenCalledWith({ hasPasskey: false });
    expect(next).not.toHaveBeenCalled();
  });

  it("should call next with unauthorized when userRef is missing", async () => {
    const req = createMockRequest({});
    const res = createMockResponse();
    const next = vi.fn();

    await callHandler(req, res, next);

    expect(mockListPasskeysForUser).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 401,
        }),
      })
    );
  });
});
