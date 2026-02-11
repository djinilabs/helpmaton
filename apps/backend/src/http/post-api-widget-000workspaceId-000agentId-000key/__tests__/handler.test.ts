import { unauthorized } from "@hapi/boom";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createAPIGatewayEventV2,
  createMockDatabase,
} from "../../utils/__tests__/test-helpers";
// eslint-disable-next-line import/order
import { createMockResponseStream } from "../../utils/streamResponseStream";

// Mock dependencies using vi.hoisted
const {
  mockDatabase,
  mockValidateWidgetKey,
  mockBuildStreamRequestContext,
  mockExecuteStream,
} = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockValidateWidgetKey: vi.fn(),
    mockBuildStreamRequestContext: vi.fn(),
    mockExecuteStream: vi.fn(),
  };
});

vi.mock("../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../utils/requestValidation", () => ({
  validateWidgetKey: mockValidateWidgetKey,
}));

vi.mock("../../utils/streamRequestContext", () => ({
  buildStreamRequestContext: mockBuildStreamRequestContext,
}));

vi.mock("../../utils/streamExecution", () => ({
  executeStream: mockExecuteStream,
}));

vi.mock("../../utils/streamEventNormalization", () => ({
  normalizeEventToHttpV2: vi.fn((event) => event),
  ensureRequestContextHttp: vi.fn((event) => event),
  setupWorkspaceCreditContext: vi.fn(),
}));

vi.mock("../../utils/streamCorsHeaders", () => ({
  computeCorsHeaders: vi.fn(() => ({ "Access-Control-Allow-Origin": "*" })),
  mergeCorsHeaders: vi.fn((_, __, ___, headers) => headers),
  handleOptionsRequest: vi.fn(() => ({
    statusCode: 200,
    headers: {},
    body: "",
  })),
}));

vi.mock("../../utils/streamErrorHandling", () => ({
  writeErrorResponse: vi.fn().mockResolvedValue(undefined),
  persistConversationError: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../utils/streamPostProcessing", () => ({
  performPostProcessing: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../utils/generationErrorHandling", () => ({
  handleCreditErrors: vi.fn().mockResolvedValue({ handled: false }),
}));

vi.mock("../../../utils/workspaceCreditContext", () => ({
  setupWorkspaceCreditContext: vi.fn(),
  clearCurrentHTTPContext: vi.fn(),
}));

vi.mock("../../../utils/sentry", () => ({
  initSentry: vi.fn(),
  Sentry: {
    captureException: vi.fn(),
  },
  ensureError: vi.fn((error) => error),
  flushSentry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../utils/posthog", () => ({
  initPostHog: vi.fn(),
  flushPostHog: vi.fn().mockResolvedValue(undefined),
  resetPostHogRequestContext: vi.fn(),
}));

vi.mock("../../../utils/tracking", () => ({
  trackBusinessEvent: vi.fn(),
}));

// Mock lambda-stream
vi.mock("lambda-stream", () => ({
  streamifyResponse: vi.fn((handler) => handler),
}));

// Mock awslambda global
vi.mock("@/utils", () => ({
  getDefined: vi.fn((value) => value),
}));

// Import handler after mocks
import { handler } from "../index";

describe("post-api-widget-000workspaceId-000agentId-000key handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should handle OPTIONS request for CORS preflight without database query", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const key = "widget-key-789";

    const event = createAPIGatewayEventV2({
      routeKey: "OPTIONS /api/widget/workspace-123/agent-456/widget-key-789",
      rawPath: "/api/widget/workspace-123/agent-456/widget-key-789",
      requestContext: {
        ...createAPIGatewayEventV2().requestContext,
        http: {
          ...createAPIGatewayEventV2().requestContext.http,
          method: "OPTIONS",
        },
      },
      pathParameters: {
        workspaceId,
        agentId,
        key,
      },
      headers: {
        origin: "https://example.com",
      },
    });

    const { stream } = createMockResponseStream();

    // Handler signature for streamifyResponse is (event, stream) => Promise<void>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (handler as any)(event, stream);

    // OPTIONS requests should NOT query the database - CORS headers must be returned unconditionally
    expect(mockDatabase).not.toHaveBeenCalled();

    // Verify computeCorsHeaders was called with null for allowedOrigins (unconditional CORS)
    const { computeCorsHeaders } = await import("../../utils/streamCorsHeaders");
    expect(vi.mocked(computeCorsHeaders)).toHaveBeenCalledWith(
      "stream",
      "https://example.com",
      null // allowedOrigins should be null for unconditional CORS
    );
  });

  it("should reject request with invalid widget key", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const key = "invalid-key";

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      widgetConfig: {
        enabled: true,
        allowedOrigins: ["https://example.com"],
      },
    };

    const mockDb = createMockDatabase();
    mockDb.agent.get = vi.fn().mockResolvedValue(mockAgent);
    mockDatabase.mockResolvedValue(mockDb);

    mockValidateWidgetKey.mockRejectedValue(unauthorized("Invalid widget key"));

    const event = createAPIGatewayEventV2({
      routeKey: "POST /api/widget/workspace-123/agent-456/invalid-key",
      rawPath: "/api/widget/workspace-123/agent-456/invalid-key",
      requestContext: {
        ...createAPIGatewayEventV2().requestContext,
        http: {
          ...createAPIGatewayEventV2().requestContext.http,
          method: "POST",
          path: "/api/widget/workspace-123/agent-456/invalid-key",
        },
      },
      pathParameters: {
        workspaceId,
        agentId,
        key,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hello" }],
      }),
    });

    const { stream } = createMockResponseStream();

    // Handler signature for streamifyResponse is (event, stream) => Promise<void>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (handler as any)(event, stream);

    expect(mockDb.agent.get).toHaveBeenCalledWith(
      `agents/${workspaceId}/${agentId}`,
      "agent"
    );
    expect(mockValidateWidgetKey).toHaveBeenCalledWith(
      workspaceId,
      agentId,
      key
    );
  });

  it("should reject request with missing path parameters", async () => {
    const event = createAPIGatewayEventV2({
      routeKey: "POST /api/widget",
      rawPath: "/api/widget",
      requestContext: {
        accountId: "123456789012",
        apiId: "test-api-id",
        domainName: "test.execute-api.us-east-1.amazonaws.com",
        domainPrefix: "test",
        http: {
          method: "POST",
          path: "/api/widget",
          protocol: "HTTP/1.1",
          sourceIp: "127.0.0.1",
          userAgent: "test-agent",
        },
        requestId: "test-request-id",
        routeKey: "POST /api/widget",
        stage: "$default",
        time: "12/Mar/2020:19:03:58 +0000",
        timeEpoch: 1583348638390,
      },
      pathParameters: {},
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hello" }],
      }),
    });

    const { stream } = createMockResponseStream();

    // Handler signature for streamifyResponse is (event, stream) => Promise<void>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (handler as any)(event, stream);

    // Should not call validateWidgetKey when path parameters are missing
    expect(mockValidateWidgetKey).not.toHaveBeenCalled();
  });

  it("should handle CORS with allowed origins from agent config", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const key = "widget-key-789";

    // Use variables to avoid unused variable errors
    void workspaceId;
    void agentId;
    void key;

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      widgetConfig: {
        enabled: true,
        allowedOrigins: ["https://example.com", "https://app.example.com"],
      },
    };

    const mockDb = createMockDatabase();
    mockDb.agent.get = vi.fn().mockResolvedValue(mockAgent);
    mockDatabase.mockResolvedValue(mockDb);

    mockValidateWidgetKey.mockResolvedValue(undefined);

    const mockStreamContext = {
      workspaceId,
      agentId,
      allowedOrigins: ["https://example.com", "https://app.example.com"],
    };

    mockBuildStreamRequestContext.mockResolvedValue(mockStreamContext);
    mockExecuteStream.mockResolvedValue({
      finalResponseText: "Response",
      tokenUsage: { promptTokens: 10, completionTokens: 5 },
      streamResult: {},
      generationTimeMs: 100,
    });

    const event = createAPIGatewayEventV2({
      routeKey: "POST /api/widget/workspace-123/agent-456/widget-key-789",
      rawPath: "/api/widget/workspace-123/agent-456/widget-key-789",
      requestContext: {
        accountId: "123456789012",
        apiId: "test-api-id",
        domainName: "test.execute-api.us-east-1.amazonaws.com",
        domainPrefix: "test",
        http: {
          method: "POST",
          path: "/api/widget/workspace-123/agent-456/widget-key-789",
          protocol: "HTTP/1.1",
          sourceIp: "127.0.0.1",
          userAgent: "test-agent",
        },
        requestId: "test-request-id",
        routeKey: "POST /api/widget/workspace-123/agent-456/widget-key-789",
        stage: "$default",
        time: "12/Mar/2020:19:03:58 +0000",
        timeEpoch: 1583348638390,
      },
      pathParameters: {
        workspaceId,
        agentId,
        key,
      },
      headers: {
        origin: "https://example.com",
        "x-conversation-id": "conversation-123",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hello" }],
      }),
    });

    const { stream } = createMockResponseStream();

    // Handler signature for streamifyResponse is (event, stream) => Promise<void>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (handler as any)(event, stream);

    expect(mockDb.agent.get).toHaveBeenCalledWith(
      `agents/${workspaceId}/${agentId}`,
      "agent"
    );
    expect(mockValidateWidgetKey).toHaveBeenCalledWith(
      workspaceId,
      agentId,
      key
    );
  });
});
