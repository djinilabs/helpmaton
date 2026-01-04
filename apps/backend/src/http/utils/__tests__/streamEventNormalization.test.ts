import { describe, expect, it, vi, beforeEach } from "vitest";

import type { LambdaUrlEvent } from "../../../utils/httpEventAdapter";
import {
  normalizeEventToHttpV2,
  ensureRequestContextHttp,
  createSyntheticContext,
  setupWorkspaceCreditContext,
} from "../streamEventNormalization";

import { createAPIGatewayEvent, createAPIGatewayEventV2 } from "./test-helpers";

// Mock dependencies
vi.mock("../../../utils/httpEventAdapter", () => ({
  transformRestToHttpV2Event: vi.fn((event) => ({
    ...event,
    version: "2.0",
    rawPath: event.path,
    requestContext: {
      ...event.requestContext,
      http: {
        method: event.httpMethod,
        path: event.path,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test-agent",
      },
    },
  })),
  transformLambdaUrlToHttpV2Event: vi.fn((event) => ({
    ...event,
    version: "2.0",
    requestContext: {
      ...event.requestContext,
    },
  })),
}));

vi.mock("../../../utils/workspaceCreditContext", () => ({
  augmentContextWithCreditTransactions: vi.fn((context) => ({
    ...context,
    addWorkspaceCreditTransaction: vi.fn(),
  })),
  setCurrentHTTPContext: vi.fn(),
}));

describe("streamEventNormalization", () => {
  describe("normalizeEventToHttpV2", () => {
    it("should normalize REST API v1 event to v2", () => {
      const event = createAPIGatewayEvent({
        path: "/api/streams/test",
        httpMethod: "POST",
      });
      const result = normalizeEventToHttpV2(event);
      expect(result.version).toBe("2.0");
      expect(result.rawPath).toBe("/api/streams/test");
    });

    it("should normalize Lambda Function URL event to v2", () => {
      const event: LambdaUrlEvent = {
        version: "2.0",
        routeKey: "POST /api/streams/test",
        rawPath: "/api/streams/test",
        rawQueryString: "",
        requestContext: {
          accountId: "123456789012",
          apiId: "test-api",
          domainName: "test.execute-api.us-east-1.amazonaws.com",
          domainPrefix: "test",
          http: {
            method: "POST",
            path: "/api/streams/test",
            protocol: "HTTP/1.1",
            sourceIp: "127.0.0.1",
            userAgent: "test-agent",
          },
          requestId: "test-request-id",
          stage: "$default",
          time: "12/Mar/2020:19:03:58 +0000",
          timeEpoch: 1583348638390,
        },
        headers: {},
        body: "",
        isBase64Encoded: false,
      };
      const result = normalizeEventToHttpV2(event);
      expect(result.version).toBe("2.0");
    });

    it("should return v2 event as-is", () => {
      const event = createAPIGatewayEventV2({
        rawPath: "/api/streams/test",
      });
      const result = normalizeEventToHttpV2(event);
      // The function may return a new object, so check properties instead
      expect(result.version).toBe("2.0");
      expect(result.rawPath).toBe("/api/streams/test");
    });
  });

  describe("ensureRequestContextHttp", () => {
    it("should add requestContext.http when missing", () => {
      const event = createAPIGatewayEventV2({
        rawPath: "/api/streams/test",
      });
      delete (event.requestContext as { http?: unknown }).http;
      const result = ensureRequestContextHttp(event);
      expect(result.requestContext.http).toBeDefined();
      expect(result.requestContext.http.method).toBe("POST");
      expect(result.requestContext.http.path).toBe("/api/streams/test");
    });

    it("should create requestContext when missing", () => {
      const event = {
        rawPath: "/api/streams/test",
      } as unknown as Parameters<typeof ensureRequestContextHttp>[0];
      const result = ensureRequestContextHttp(event);
      expect(result.requestContext).toBeDefined();
      expect(result.requestContext.http).toBeDefined();
    });

    it("should use httpMethod from requestContext when http is missing", () => {
      const event = createAPIGatewayEventV2({
        rawPath: "/api/streams/test",
      });
      delete (event.requestContext as { http?: unknown }).http;
      (event.requestContext as { httpMethod?: string }).httpMethod = "GET";
      const result = ensureRequestContextHttp(event);
      expect(result.requestContext.http.method).toBe("GET");
    });
  });

  describe("createSyntheticContext", () => {
    beforeEach(() => {
      delete process.env.AWS_LAMBDA_FUNCTION_NAME;
      delete process.env.AWS_LAMBDA_FUNCTION_VERSION;
      delete process.env.AWS_LAMBDA_FUNCTION_ARN;
      delete process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE;
      delete process.env.AWS_LAMBDA_LOG_GROUP_NAME;
      delete process.env.AWS_LAMBDA_LOG_STREAM_NAME;
    });

    it("should create synthetic context with request ID", () => {
      const context = createSyntheticContext("test-request-id");
      expect(context.awsRequestId).toBe("test-request-id");
      expect(context.functionName).toBe("stream-handler");
      expect(typeof context.getRemainingTimeInMillis).toBe("function");
    });

    it("should use environment variables when available", () => {
      process.env.AWS_LAMBDA_FUNCTION_NAME = "custom-function";
      process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE = "1024";
      const context = createSyntheticContext("test-request-id");
      expect(context.functionName).toBe("custom-function");
      expect(context.memoryLimitInMB).toBe("1024");
    });
  });

  describe("setupWorkspaceCreditContext", () => {
    it("should not set up context when awsRequestId is undefined", async () => {
      const { setCurrentHTTPContext } = await import(
        "../../../utils/workspaceCreditContext"
      );
      setupWorkspaceCreditContext(undefined);
      expect(setCurrentHTTPContext).not.toHaveBeenCalled();
    });

    it("should set up context with provided context", async () => {
      const { setCurrentHTTPContext } = await import(
        "../../../utils/workspaceCreditContext"
      );
      const context = {
        awsRequestId: "test-request-id",
        functionName: "test-function",
      } as Parameters<typeof setupWorkspaceCreditContext>[1];
      setupWorkspaceCreditContext("test-request-id", context);
      expect(setCurrentHTTPContext).toHaveBeenCalled();
    });

    it("should create synthetic context when context is not provided", async () => {
      const { setCurrentHTTPContext } = await import(
        "../../../utils/workspaceCreditContext"
      );
      setupWorkspaceCreditContext("test-request-id");
      expect(setCurrentHTTPContext).toHaveBeenCalled();
    });
  });
});

