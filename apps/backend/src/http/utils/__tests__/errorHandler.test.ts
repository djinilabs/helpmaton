import type { Request, Response } from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCaptureException, mockFlushSentry } = vi.hoisted(() => ({
  mockCaptureException: vi.fn(),
  mockFlushSentry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../utils/sentry", () => ({
  initSentry: vi.fn(),
  Sentry: { captureException: mockCaptureException },
  flushSentry: mockFlushSentry,
  ensureError: vi.fn((err: unknown) => err),
}));

import { expressErrorHandler } from "../errorHandler";

describe("expressErrorHandler", () => {
  const baseReq = {
    method: "POST",
    path: "/api/scrape",
    url: "/api/scrape",
  } as Request;

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as unknown as Response;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFlushSentry.mockResolvedValue(undefined);
  });

  it("does not call Sentry when req.skipSentryCapture is true for server error", async () => {
    const req = { ...baseReq, skipSentryCapture: true } as Request;
    const serverError = new Error("Navigation timeout of 30000 ms exceeded");

    await expressErrorHandler(serverError, req, res, vi.fn());

    expect(mockCaptureException).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalled();
  });

  it("calls Sentry when req.skipSentryCapture is false/undefined for server error", async () => {
    const req = { ...baseReq } as Request;
    const serverError = new Error("Database connection failed");

    await expressErrorHandler(serverError, req, res, vi.fn());

    expect(mockCaptureException).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalled();
  });

  it("still returns 500 and payload when skipSentryCapture is true", async () => {
    const req = { ...baseReq, skipSentryCapture: true } as Request;
    const serverError = new Error("Timeout");

    await expressErrorHandler(serverError, req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        error: "Internal Server Error",
      })
    );
  });
});
