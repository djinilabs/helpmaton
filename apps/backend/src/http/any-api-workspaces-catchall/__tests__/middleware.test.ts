import type express from "express";
import { describe, expect, it, vi } from "vitest";

import {
  InsufficientCreditsError,
  SpendingLimitExceededError,
} from "../../../utils/creditErrors";
import { asyncHandler } from "../middleware";

vi.mock("../../../utils/agentErrorNotifications", () => ({
  sendAgentErrorNotification: vi.fn().mockResolvedValue(undefined),
}));

const createResponse = (): express.Response => {
  const res = {
    status: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return res as unknown as express.Response;
};

const flushPromises = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

describe("asyncHandler", () => {
  it("returns 402 for insufficient credits errors", async () => {
    const handler = asyncHandler(async () => {
      throw new InsufficientCreditsError("workspace-1", 552, 0, "usd");
    });
    const req = {} as express.Request;
    const res = createResponse();
    const next = vi.fn();

    handler(req, res, next);
    await flushPromises();

    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.set).toHaveBeenCalledWith({
      "Content-Type": "application/json",
    });
    expect(res.send).toHaveBeenCalledWith(
      expect.stringContaining("Insufficient credits")
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 402 for spending limit errors", async () => {
    const handler = asyncHandler(async () => {
      throw new SpendingLimitExceededError("workspace-1", [
        {
          scope: "workspace",
          timeFrame: "daily",
          limit: 1000,
          current: 1500,
        },
      ]);
    });
    const req = {} as express.Request;
    const res = createResponse();
    const next = vi.fn();

    handler(req, res, next);
    await flushPromises();

    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.set).toHaveBeenCalledWith({
      "Content-Type": "application/json",
    });
    expect(res.send).toHaveBeenCalledWith(
      expect.stringContaining("Spending limits exceeded")
    );
    expect(next).not.toHaveBeenCalled();
  });
});
