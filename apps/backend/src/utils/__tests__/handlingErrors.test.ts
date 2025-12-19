import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { handlingErrors } from "../handlingErrors";
import { flushPostHog } from "../posthog";
import { flushSentry } from "../sentry";

// Mock dependencies
const { mockSentryCaptureException } = vi.hoisted(() => ({
  mockSentryCaptureException: vi.fn(),
}));

vi.mock("../sentry", () => ({
  initSentry: vi.fn(),
  flushSentry: vi.fn(),
  ensureError: (error: unknown) =>
    error instanceof Error ? error : new Error(String(error)),
  Sentry: {
    captureException: mockSentryCaptureException,
  },
}));

vi.mock("../posthog", () => ({
  initPostHog: vi.fn(),
  flushPostHog: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  default: {
    captureException: vi.fn(),
  },
  Sentry: {
    captureException: vi.fn(),
  },
}));

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
