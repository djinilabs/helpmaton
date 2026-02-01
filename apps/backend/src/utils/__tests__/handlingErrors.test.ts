import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies - must be before imports
const {
  mockSentryCaptureException,
  mockSentryStartSpan,
  mockDatabase,
  mockCommitContextTransactions,
} = vi.hoisted(() => {
  const db = {
    workspace: { get: vi.fn() },
    "workspace-credit-transactions": { create: vi.fn() },
    atomicUpdate: vi.fn().mockResolvedValue([]),
  };
  return {
    mockSentryCaptureException: vi.fn(),
    mockSentryStartSpan: vi.fn(),
    mockDatabase: vi.fn().mockResolvedValue(db),
    mockCommitContextTransactions: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@architect/functions", () => ({
  tables: vi.fn().mockResolvedValue({
    reflect: vi.fn().mockResolvedValue({}),
    _client: {},
  }),
}));

vi.mock("../sentry", () => ({
  initSentry: vi.fn(),
  flushSentry: vi.fn(),
  ensureError: (error: unknown) =>
    error instanceof Error ? error : new Error(String(error)),
  Sentry: {
    captureException: mockSentryCaptureException,
    startSpan: mockSentryStartSpan,
    setTag: vi.fn(),
    setContext: vi.fn(),
  },
}));

vi.mock("../posthog", () => ({
  initPostHog: vi.fn(),
  flushPostHog: vi.fn(),
}));

vi.mock("../agentErrorNotifications", () => ({
  sendAgentErrorNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../tables/database", () => ({
  database: mockDatabase,
}));

vi.mock("../workspaceCreditContext", () => ({
  augmentContextWithCreditTransactions: vi.fn((context) => context),
  commitContextTransactions: mockCommitContextTransactions,
  setCurrentHTTPContext: vi.fn(),
  clearCurrentHTTPContext: vi.fn(),
}));

import { SpendingLimitExceededError } from "../creditErrors";
import {
  handlingErrors,
  handlingHttpErrors,
  handlingScheduledErrors,
} from "../handlingErrors";
import { flushPostHog } from "../posthog";
import { flushSentry } from "../sentry";

describe("handlingErrors", () => {
  const mockContext: Context = {
    awsRequestId: "test-request-id",
    functionName: "test-function",
    functionVersion: "$LATEST",
    invokedFunctionArn: "arn:aws:lambda:us-east-1:123456789012:function:test",
    memoryLimitInMB: "128",
    getRemainingTimeInMillis: () => 30000,
    logGroupName: "/aws/lambda/test",
    logStreamName: "2024/01/01/[$LATEST]test",
    callbackWaitsForEmptyEventLoop: false,
    succeed: vi.fn(),
    fail: vi.fn(),
    done: vi.fn(),
  };

  const mockEvent: APIGatewayProxyEventV2 = {
    version: "2.0",
    routeKey: "GET /test",
    rawPath: "/test",
    rawQueryString: "",
    headers: {},
    requestContext: {
      accountId: "123456789012",
      apiId: "test-api",
      domainName: "test.execute-api.us-east-1.amazonaws.com",
      domainPrefix: "test",
      http: {
        method: "GET",
        path: "/test",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test-agent",
      },
      requestId: "test-request-id",
      routeKey: "GET /test",
      stage: "test",
      time: "01/Jan/2024:00:00:00 +0000",
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(flushSentry).mockResolvedValue(undefined);
    vi.mocked(flushPostHog).mockResolvedValue(undefined);
    mockSentryStartSpan.mockImplementation(async (_config, callback) => {
      if (typeof callback === "function") {
        return callback();
      }
      return undefined;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("successful handler execution", () => {
    it("should return handler result on success", async () => {
      const mockHandler = vi.fn().mockResolvedValue({
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "success" }),
      });

      const wrappedHandler = handlingErrors(mockHandler);
      const result = (await wrappedHandler(
        mockEvent,
        mockContext,
        vi.fn()
      )) as {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      };

      expect(result.statusCode).toBe(200);
      expect(mockHandler).toHaveBeenCalledWith(
        mockEvent,
        mockContext,
        expect.any(Function)
      );
      expect(mockSentryStartSpan).toHaveBeenCalledWith(
        expect.objectContaining({
          op: "http.server",
          name: "GET /test",
        }),
        expect.any(Function)
      );
      // Both PostHog and Sentry should be flushed in finally block
      expect(flushPostHog).toHaveBeenCalled();
      expect(flushSentry).toHaveBeenCalled();
    });

    it("should flush PostHog and Sentry even if flush succeeds", async () => {
      const mockHandler = vi.fn().mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: "",
      });

      const wrappedHandler = handlingErrors(mockHandler);
      await wrappedHandler(mockEvent, mockContext, vi.fn());

      // Both should be flushed in finally block
      expect(flushPostHog).toHaveBeenCalledTimes(1);
      expect(flushSentry).toHaveBeenCalledTimes(1);
    });

    it("should flush only after handler completes", async () => {
      const order: string[] = [];
      const mockHandler = vi.fn().mockImplementation(async () => {
        order.push("handler");
        return {
          statusCode: 200,
          headers: {},
          body: "",
        };
      });

      mockSentryStartSpan.mockImplementation(async (_config, callback) => {
        order.push("startSpan");
        const result = await callback();
        order.push("endSpan");
        return result;
      });

      vi.mocked(flushSentry).mockImplementation(async () => {
        order.push("flushSentry");
      });
      vi.mocked(flushPostHog).mockImplementation(async () => {
        order.push("flushPostHog");
      });

      const wrappedHandler = handlingErrors(mockHandler);
      await wrappedHandler(mockEvent, mockContext, vi.fn());

      expect(order).toContain("handler");
      expect(order.indexOf("flushSentry")).toBeGreaterThan(
        order.indexOf("handler")
      );
      expect(order.indexOf("flushPostHog")).toBeGreaterThan(
        order.indexOf("handler")
      );
    });

    it("should handle PostHog flush errors gracefully", async () => {
      const mockHandler = vi.fn().mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: "",
      });

      const flushError = new Error("PostHog flush failed");
      vi.mocked(flushPostHog).mockRejectedValue(flushError);
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const wrappedHandler = handlingErrors(mockHandler);
      const result = (await wrappedHandler(
        mockEvent,
        mockContext,
        vi.fn()
      )) as {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      };

      expect(result.statusCode).toBe(200);
      // Error is caught in Promise.all().catch(), so it logs with the new format
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[PostHog/Sentry] Error flushing events:",
        expect.anything()
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("error handling", () => {
    it("should handle handler errors and return error response", async () => {
      const handlerError = new Error("Handler failed");
      const mockHandler = vi.fn().mockRejectedValue(handlerError);

      const wrappedHandler = handlingErrors(mockHandler);
      const result = (await wrappedHandler(
        mockEvent,
        mockContext,
        vi.fn()
      )) as {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      };

      expect(result.statusCode).toBe(500);
      expect(mockSentryCaptureException).toHaveBeenCalled();
      expect(flushSentry).toHaveBeenCalled();
      expect(flushPostHog).toHaveBeenCalled();
    });

    it("should not report credit user errors to Sentry", async () => {
      const handlerError = new SpendingLimitExceededError("workspace-1", [
        {
          scope: "workspace",
          timeFrame: "daily",
          limit: 1000,
          current: 1500,
        },
      ]);
      const mockHandler = vi.fn().mockRejectedValue(handlerError);

      const wrappedHandler = handlingErrors(mockHandler);
      const result = (await wrappedHandler(
        mockEvent,
        mockContext,
        vi.fn()
      )) as {
        statusCode: number;
      };

      expect(result.statusCode).toBe(402);
      expect(mockSentryCaptureException).not.toHaveBeenCalled();
    });

    it("should handle Sentry flush errors gracefully without causing recursion", async () => {
      const handlerError = new Error("Handler failed");
      const mockHandler = vi.fn().mockRejectedValue(handlerError);

      const sentryFlushError = new Error("Sentry flush failed");
      vi.mocked(flushSentry).mockRejectedValue(sentryFlushError);
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const wrappedHandler = handlingErrors(mockHandler);
      const result = (await wrappedHandler(
        mockEvent,
        mockContext,
        vi.fn()
      )) as {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      };

      // Should still return error response even if Sentry flush fails
      expect(result.statusCode).toBe(500);
      // Error is caught in Promise.all().catch() in finally block
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[PostHog/Sentry] Error flushing events:",
        expect.anything()
      );
      // Should not cause recursion - only called once in finally block
      expect(flushSentry).toHaveBeenCalledTimes(1);
      expect(flushPostHog).toHaveBeenCalledTimes(1);

      consoleErrorSpy.mockRestore();
    });

    it("should handle PostHog flush errors in error handler gracefully", async () => {
      const handlerError = new Error("Handler failed");
      const mockHandler = vi.fn().mockRejectedValue(handlerError);

      const posthogFlushError = new Error("PostHog flush failed");
      vi.mocked(flushPostHog).mockRejectedValue(posthogFlushError);
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const wrappedHandler = handlingErrors(mockHandler);
      const result = (await wrappedHandler(
        mockEvent,
        mockContext,
        vi.fn()
      )) as {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      };

      // Should still return error response even if PostHog flush fails
      expect(result.statusCode).toBe(500);
      // Error is caught in Promise.all().catch() in finally block
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[PostHog/Sentry] Error flushing events:",
        expect.anything()
      );
      // Should not cause recursion - only called once in finally block
      expect(flushPostHog).toHaveBeenCalledTimes(1);
      expect(flushSentry).toHaveBeenCalledTimes(1);

      consoleErrorSpy.mockRestore();
    });

    it("should handle both Sentry and PostHog flush errors without recursion", async () => {
      const handlerError = new Error("Handler failed");
      const mockHandler = vi.fn().mockRejectedValue(handlerError);

      const sentryFlushError = new Error("Sentry flush failed");
      const posthogFlushError = new Error("PostHog flush failed");
      vi.mocked(flushSentry).mockRejectedValue(sentryFlushError);
      vi.mocked(flushPostHog).mockRejectedValue(posthogFlushError);
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const wrappedHandler = handlingErrors(mockHandler);
      const result = (await wrappedHandler(
        mockEvent,
        mockContext,
        vi.fn()
      )) as {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      };

      // Should still return error response
      expect(result.statusCode).toBe(500);
      // Both flush errors are caught together in Promise.all().catch() in finally block
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[PostHog/Sentry] Error flushing events:",
        expect.anything()
      );
      // Should not cause recursion - each flush called only once in finally block
      expect(flushSentry).toHaveBeenCalledTimes(1);
      expect(flushPostHog).toHaveBeenCalledTimes(1);

      consoleErrorSpy.mockRestore();
    });

    it("should throw error if handler returns undefined", async () => {
      const mockHandler = vi.fn().mockResolvedValue(undefined);

      const wrappedHandler = handlingErrors(mockHandler);
      const result = (await wrappedHandler(
        mockEvent,
        mockContext,
        vi.fn()
      )) as {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      };

      // Handler returning undefined should result in a 500 error
      expect(result.statusCode).toBe(500);
      // The error is wrapped by boom, which converts it to a standard error response
      const body = JSON.parse(result.body);
      expect(body.statusCode).toBe(500);
    });
  });
});

describe("handlingHttpErrors", () => {
  const mockReq = {
    method: "GET",
    path: "/test",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(flushSentry).mockResolvedValue(undefined);
    vi.mocked(flushPostHog).mockResolvedValue(undefined);
    mockSentryStartSpan.mockImplementation(async (_config, callback) => {
      if (typeof callback === "function") {
        return callback();
      }
      return undefined;
    });
  });

  it("flushes PostHog and Sentry before responding on success", async () => {
    const order: string[] = [];
    vi.mocked(flushSentry).mockImplementation(async () => {
      order.push("flushSentry");
    });
    vi.mocked(flushPostHog).mockImplementation(async () => {
      order.push("flushPostHog");
    });

    const res = vi.fn(() => {
      order.push("res");
    });

    const wrappedHandler = handlingHttpErrors((req, respond) => {
      respond({
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: true }),
      });
    });

    wrappedHandler(mockReq as never, res, vi.fn());

    await new Promise((resolve) => setImmediate(resolve));

    expect(flushSentry).toHaveBeenCalledTimes(1);
    expect(flushPostHog).toHaveBeenCalledTimes(1);
    expect(res).toHaveBeenCalledTimes(1);
    expect(order.indexOf("res")).toBeGreaterThan(order.indexOf("flushSentry"));
    expect(order.indexOf("res")).toBeGreaterThan(order.indexOf("flushPostHog"));
  });

  it("flushes PostHog and Sentry before responding on error", async () => {
    const order: string[] = [];
    vi.mocked(flushSentry).mockImplementation(async () => {
      order.push("flushSentry");
    });
    vi.mocked(flushPostHog).mockImplementation(async () => {
      order.push("flushPostHog");
    });

    const res = vi.fn(() => {
      order.push("res");
    });

    const wrappedHandler = handlingHttpErrors(() => {
      throw new Error("Boom");
    });

    wrappedHandler(mockReq as never, res, vi.fn());

    await new Promise((resolve) => setImmediate(resolve));

    expect(flushSentry).toHaveBeenCalledTimes(1);
    expect(flushPostHog).toHaveBeenCalledTimes(1);
    expect(res).toHaveBeenCalledTimes(1);
    expect(order.indexOf("res")).toBeGreaterThan(order.indexOf("flushSentry"));
    expect(order.indexOf("res")).toBeGreaterThan(order.indexOf("flushPostHog"));
  });
});

describe("handlingScheduledErrors", () => {
  const mockEvent = {
    "detail-type": "Scheduled event",
    source: "test.source",
    time: "2024-01-01T00:00:00Z",
    region: "us-east-1",
    account: "123456789012",
    detail: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(flushSentry).mockResolvedValue(undefined);
    vi.mocked(flushPostHog).mockResolvedValue(undefined);
    mockSentryStartSpan.mockImplementation(async (_config, callback) => {
      if (typeof callback === "function") {
        return callback();
      }
      return undefined;
    });
  });

  it("does not report credit user errors to Sentry", async () => {
    const handlerError = new SpendingLimitExceededError("workspace-1", [
      {
        scope: "workspace",
        timeFrame: "daily",
        limit: 1000,
        current: 1500,
      },
    ]);
    const mockHandler = vi.fn().mockRejectedValue(handlerError);
    const wrappedHandler = handlingScheduledErrors(mockHandler);

    await expect(wrappedHandler(mockEvent as never)).rejects.toBe(handlerError);
    expect(mockSentryCaptureException).not.toHaveBeenCalled();
  });
});
