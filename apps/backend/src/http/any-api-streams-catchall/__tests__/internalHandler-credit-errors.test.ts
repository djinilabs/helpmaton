import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InsufficientCreditsError } from "../../../utils/creditErrors";
import { createMockResponseStream } from "../../utils/streamResponseStream";

const {
  mockBuildStreamRequestContext,
  mockHandleCreditErrors,
  mockSentryCaptureException,
  mockWriteErrorResponse,
} = vi.hoisted(() => {
  return {
    mockBuildStreamRequestContext: vi.fn(),
    mockHandleCreditErrors: vi.fn(),
    mockSentryCaptureException: vi.fn(),
    mockWriteErrorResponse: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../../utils/streamAuthentication", () => ({
  authenticateStreamRequest: vi.fn().mockResolvedValue({ authenticated: true }),
}));

vi.mock("../../utils/streamRequestContext", () => ({
  buildStreamRequestContext: mockBuildStreamRequestContext,
}));

vi.mock("../../utils/streamEventNormalization", () => ({
  ensureRequestContextHttp: (event: APIGatewayProxyEventV2) => event,
  setupWorkspaceCreditContext: vi.fn(),
}));

vi.mock("../../utils/streamPathExtraction", () => ({
  extractStreamPathParameters: vi.fn(() => ({
    workspaceId: "workspace-1",
    agentId: "agent-1",
    secret: undefined,
    endpointType: "stream",
  })),
}));

vi.mock("../../utils/streamCorsHeaders", () => ({
  computeCorsHeaders: vi.fn(() => ({})),
  mergeCorsHeaders: vi.fn((_endpoint, _origin, _allowedOrigins, extra) => ({
    ...(extra ?? {}),
  })),
}));

vi.mock("../../utils/streamErrorHandling", () => ({
  writeErrorResponse: mockWriteErrorResponse,
  persistConversationError: vi.fn(),
}));

vi.mock("../../utils/requestTimeout", () => ({
  createRequestTimeout: vi.fn(() => ({
    signal: new AbortController().signal,
  })),
  cleanupRequestTimeout: vi.fn(),
  isTimeoutError: vi.fn(() => false),
  createTimeoutError: vi.fn(() => new Error("timeout")),
}));

vi.mock("../../utils/streamExecution", () => ({
  executeStream: vi.fn(),
}));

vi.mock("../../utils/streamPostProcessing", () => ({
  performPostProcessing: vi.fn(),
}));

vi.mock("../../utils/generationErrorHandling", () => ({
  handleCreditErrors: mockHandleCreditErrors,
}));

vi.mock("../../../utils/posthog", () => ({
  flushPostHog: vi.fn().mockResolvedValue(undefined),
  resetPostHogRequestContext: vi.fn(),
}));

vi.mock("../../../utils/sentry", () => ({
  Sentry: {
    captureException: mockSentryCaptureException,
  },
  flushSentry: vi.fn().mockResolvedValue(undefined),
  ensureError: (error: unknown) =>
    error instanceof Error ? error : new Error(String(error)),
}));

vi.mock("../../../utils/tracking", () => ({
  trackBusinessEvent: vi.fn(),
}));

vi.mock("../../../utils/streamServerUtils", () => ({
  getAllowedOrigins: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../../utils/workspaceCreditContext", () => ({
  clearCurrentHTTPContext: vi.fn(),
}));

describe("internalHandler credit errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  let internalHandler: typeof import("../internalHandler")["internalHandler"];

  beforeEach(async () => {
    vi.resetModules();
    ({ internalHandler } = await import("../internalHandler"));
  });

  const baseEvent = (): APIGatewayProxyEventV2 =>
    ({
      version: "2.0",
      routeKey: "$default",
      rawPath: "/api/streams/workspace-1/agent-1",
      rawQueryString: "",
      headers: {
        "x-conversation-id": "conversation-1",
      },
      requestContext: {
        accountId: "123",
        apiId: "api",
        domainName: "example.com",
        domainPrefix: "example",
        http: {
          method: "POST",
          path: "/api/streams/workspace-1/agent-1",
          protocol: "HTTP/1.1",
          sourceIp: "127.0.0.1",
          userAgent: "test",
        },
        requestId: "req-1",
        routeKey: "$default",
        stage: "test",
        time: "01/Jan/2024:00:00:00 +0000",
        timeEpoch: 1704067200000,
      },
      isBase64Encoded: false,
      body: "{}",
    }) satisfies APIGatewayProxyEventV2;

  it("skips Sentry capture for InsufficientCreditsError before streaming starts", async () => {
    const error = new InsufficientCreditsError("workspace-1", 1_000, 0, "usd");
    mockBuildStreamRequestContext.mockRejectedValue(error);
    mockHandleCreditErrors.mockResolvedValue({
      handled: true,
      response: {
        statusCode: 402,
        body: JSON.stringify({
          error: "Request could not be completed due to service limits",
        }),
      },
    });

    const { stream } = createMockResponseStream();

    await internalHandler(baseEvent(), stream);

    expect(mockSentryCaptureException).not.toHaveBeenCalled();
    expect(mockHandleCreditErrors).toHaveBeenCalledWith(
      error,
      "workspace-1",
      "stream",
    );
    expect(mockWriteErrorResponse).toHaveBeenCalledTimes(1);
  });
});
