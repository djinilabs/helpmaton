import type { NextFunction, Request, Response } from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";


const {
  mockDatabase,
  mockReserveCredits,
  mockLaunchBrowser,
  mockGetContextFromRequestId,
  mockExtractWorkspaceContextFromToken,
  mockValidateBody,
  mockGetRandomProxyUrl,
  mockParseProxyUrl,
  mockReservationDelete,
} = vi.hoisted(() => ({
  mockDatabase: vi.fn(),
  mockReserveCredits: vi.fn(),
  mockLaunchBrowser: vi.fn(),
  mockGetContextFromRequestId: vi.fn(),
  mockExtractWorkspaceContextFromToken: vi.fn(),
  mockValidateBody: vi.fn(),
  mockGetRandomProxyUrl: vi.fn(),
  mockParseProxyUrl: vi.fn(),
  mockReservationDelete: vi.fn(),
}));

vi.mock("../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../utils/creditManagement", () => ({
  reserveCredits: mockReserveCredits,
}));

vi.mock("../../../utils/puppeteerBrowser", () => ({
  launchBrowser: mockLaunchBrowser,
}));

vi.mock("../../../utils/workspaceCreditContext", () => ({
  getContextFromRequestId: mockGetContextFromRequestId,
}));

vi.mock("../../utils/jwtUtils", () => ({
  extractWorkspaceContextFromToken: mockExtractWorkspaceContextFromToken,
}));

vi.mock("../utils/bodyValidation", () => ({
  validateBody: mockValidateBody,
}));

vi.mock("../../../utils/proxyUtils", () => ({
  getRandomProxyUrl: mockGetRandomProxyUrl,
  parseProxyUrl: mockParseProxyUrl,
}));

vi.mock("../../../utils/puppeteerResourceBlocking", () => ({
  setupResourceBlocking: vi.fn(),
}));

vi.mock("../../../utils/puppeteerContentLoading", () => ({
  delay: vi.fn(),
}));

vi.mock("../../../utils/captchaUtils", () => ({
  waitForCaptchaElements: vi.fn(),
  solveCaptchas: vi.fn(),
}));

vi.mock("../../../utils/aomUtils", () => ({
  extractAOM: vi.fn(),
  aomToXml: vi.fn(),
  escapeXml: vi.fn(),
}));

vi.mock("../../../utils/sentry", () => ({
  initSentry: vi.fn(),
  ensureError: vi.fn((error) => error),
  flushSentry: vi.fn().mockResolvedValue(undefined),
  Sentry: {
    captureException: vi.fn(),
  },
}));

vi.mock("../../../utils/tracking", () => ({
  trackBusinessEvent: vi.fn(),
}));

vi.mock("../utils/errorHandler", () => ({
  expressErrorHandler: vi.fn((_err, _req, _res, next) => next()),
}));

import { createApp } from "../index";

describe("POST /api/scrape billing", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockDatabase.mockResolvedValue({
      "credit-reservations": {
        delete: mockReservationDelete,
      },
    });

    mockReserveCredits.mockResolvedValue({
      reservationId: "res-1",
      reservedAmount: 5000,
      workspace: {
        pk: "workspaces/ws-1",
        sk: "workspace",
        creditBalance: 100_000_000,
      },
    });

    mockLaunchBrowser.mockRejectedValue(new Error("Browser failed"));

    mockGetContextFromRequestId.mockReturnValue({
      addWorkspaceCreditTransaction: vi.fn(),
    });

    mockExtractWorkspaceContextFromToken.mockResolvedValue({
      workspaceId: "ws-1",
      agentId: "agent-1",
      conversationId: "conv-1",
    });

    mockValidateBody.mockReturnValue({
      url: "https://example.com",
    });

    mockGetRandomProxyUrl.mockReturnValue(
      "http://user:pass@gate.decodo.com:10001"
    );

    mockParseProxyUrl.mockReturnValue({
      server: "http://gate.decodo.com:10001",
      username: "user",
      password: "pass",
    });
  });

  it("consumes the reservation on scrape failure without refund", async () => {
    const app = createApp();
    const router = (app as unknown as { _router?: { stack: Array<{ route?: { path?: string; stack?: Array<{ handle: (req: Request, res: Response, next: NextFunction) => Promise<void> }>; } }> }; router?: { stack: Array<{ route?: { path?: string; stack?: Array<{ handle: (req: Request, res: Response, next: NextFunction) => Promise<void> }>; } }> } })._router
      || (app as unknown as { router?: { stack: Array<{ route?: { path?: string; stack?: Array<{ handle: (req: Request, res: Response, next: NextFunction) => Promise<void> }>; } }> } }).router;

    const handlerLayer = router?.stack.find(
      (layer) => layer.route?.path === "/api/scrape"
    );

    expect(handlerLayer?.route?.stack?.[0]).toBeDefined();

    const handler = handlerLayer?.route?.stack?.[0].handle;
    if (!handler) {
      throw new Error("Scrape handler not found");
    }

    const req = {
      method: "POST",
      path: "/api/scrape",
      headers: {
        "x-amzn-requestid": "req-1",
      },
      body: {
        url: "https://example.com",
      },
    } as unknown as Request;

    const res = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    } as unknown as Response;

    const next = vi.fn();

    await handler(req, res, next);

    expect(mockReserveCredits).toHaveBeenCalled();
    expect(mockReservationDelete).toHaveBeenCalledWith(
      "credit-reservations/res-1"
    );
  });
});
