import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
} from "../../../utils/__tests__/test-helpers";
import { registerPostTestAgent } from "../post-test-agent";

const {
  mockBuildStreamRequestContext,
  mockExecuteStreamForApiGateway,
  mockPerformPostProcessing,
  mockComputeCorsHeaders,
  mockCreateMockResponseStream,
  mockHandleStreamingErrorForApiGateway,
  mockPersistConversationError,
  mockTrackBusinessEvent,
} = vi.hoisted(() => ({
  mockBuildStreamRequestContext: vi.fn(),
  mockExecuteStreamForApiGateway: vi.fn(),
  mockPerformPostProcessing: vi.fn(),
  mockComputeCorsHeaders: vi.fn(),
  mockCreateMockResponseStream: vi.fn(),
  mockHandleStreamingErrorForApiGateway: vi.fn(),
  mockPersistConversationError: vi.fn(),
  mockTrackBusinessEvent: vi.fn(),
}));

const flushPromises = () => new Promise<void>((resolve) => setImmediate(resolve));

vi.mock("../../../utils/streamRequestContext", () => ({
  buildStreamRequestContext: mockBuildStreamRequestContext,
}));

vi.mock("../../../utils/streamExecution", () => ({
  executeStreamForApiGateway: mockExecuteStreamForApiGateway,
}));

vi.mock("../../../utils/streamPostProcessing", () => ({
  performPostProcessing: mockPerformPostProcessing,
}));

vi.mock("../../../utils/streamCorsHeaders", () => ({
  computeCorsHeaders: mockComputeCorsHeaders,
}));

vi.mock("../../../utils/streamResponseStream", () => ({
  createMockResponseStream: mockCreateMockResponseStream,
}));

vi.mock("../../../utils/streamErrorHandling", () => ({
  handleStreamingErrorForApiGateway: mockHandleStreamingErrorForApiGateway,
  persistConversationError: mockPersistConversationError,
}));

vi.mock("../../../../utils/tracking", () => ({
  trackBusinessEvent: mockTrackBusinessEvent,
}));

function getPostHandler() {
  const app = express();
  registerPostTestAgent(app);
  const router =
    (app as unknown as { _router?: { stack: unknown[] } })._router ??
    (app as unknown as { router?: { stack: unknown[] } }).router;
  const stack = (router?.stack ?? []) as Array<{
    route?: { path?: string; methods?: Record<string, boolean> };
  }>;
  const layer = stack.find((stackLayer) => {
    const route = stackLayer.route;
    return (
      route?.path === "/api/workspaces/:workspaceId/agents/:agentId/test" &&
      route.methods?.post
    );
  });
  if (!layer || !layer.route) {
    throw new Error("Post test agent route not registered");
  }
  const route = layer.route as unknown as {
    stack: Array<{ handle: unknown }>;
  };
  const handlerLayer = route.stack[route.stack.length - 1];
  return handlerLayer.handle as (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => Promise<void>;
}

describe("POST /api/workspaces/:workspaceId/agents/:agentId/test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComputeCorsHeaders.mockReturnValue({
      "Content-Type": "text/event-stream; charset=utf-8",
    });
    mockCreateMockResponseStream.mockReturnValue({
      stream: {},
      getBody: () => "data: test\n\n",
    });
  });

  it("should throw badRequest when workspaceId is missing", async () => {
    const handler = getPostHandler();
    const req = createMockRequest({
      params: { agentId: "agent-123" },
      body: { messages: [{ role: "user", content: "Hello" }] },
      headers: { "x-conversation-id": "conv-123" },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await handler(req as express.Request, res as express.Response, next);
    await flushPromises();

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
        }),
      })
    );
  });

  it("should throw badRequest when conversationId header is missing", async () => {
    const handler = getPostHandler();
    const req = createMockRequest({
      params: { workspaceId: "workspace-123", agentId: "agent-123" },
      body: { messages: [{ role: "user", content: "Hello" }] },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await handler(req as express.Request, res as express.Response, next);
    await flushPromises();

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
        }),
      })
    );
  });

  it("should stream response using shared pipeline", async () => {
    const handler = getPostHandler();
    const req = createMockRequest({
      method: "POST",
      path: "/api/workspaces/workspace-123/agents/agent-123/test",
      originalUrl: "/api/workspaces/workspace-123/agents/agent-123/test",
      params: { workspaceId: "workspace-123", agentId: "agent-123" },
      body: { messages: [{ role: "user", content: "Hello" }] },
      headers: {
        "x-conversation-id": "conv-123",
        "x-request-id": "req-123",
        origin: "https://app.example.com",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    mockBuildStreamRequestContext.mockResolvedValue({
      workspaceId: "workspace-123",
      agentId: "agent-123",
    });
    mockExecuteStreamForApiGateway.mockResolvedValue({
      streamResult: {},
      tokenUsage: undefined,
      generationTimeMs: 12,
    });

    await handler(req as express.Request, res as express.Response, next);
    await flushPromises();

    expect(mockBuildStreamRequestContext).toHaveBeenCalled();
    expect(mockExecuteStreamForApiGateway).toHaveBeenCalled();
    expect(mockPerformPostProcessing).toHaveBeenCalled();
    expect(mockTrackBusinessEvent).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith("data: test\n\n");
    expect(next).not.toHaveBeenCalled();
  });

  it("should handle timeout errors with 504", async () => {
    const handler = getPostHandler();
    const req = createMockRequest({
      method: "POST",
      path: "/api/workspaces/workspace-123/agents/agent-123/test",
      originalUrl: "/api/workspaces/workspace-123/agents/agent-123/test",
      params: { workspaceId: "workspace-123", agentId: "agent-123" },
      body: { messages: [{ role: "user", content: "Hello" }] },
      headers: {
        "x-conversation-id": "conv-123",
        "x-request-id": "req-123",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    mockBuildStreamRequestContext.mockResolvedValue({
      workspaceId: "workspace-123",
      agentId: "agent-123",
    });
    mockExecuteStreamForApiGateway.mockRejectedValue(
      new Error("Request timeout")
    );

    await handler(req as express.Request, res as express.Response, next);
    await flushPromises();

    expect(mockPersistConversationError).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(504);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining("Request timeout"),
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("should return streaming error response when handled", async () => {
    const handler = getPostHandler();
    const req = createMockRequest({
      method: "POST",
      path: "/api/workspaces/workspace-123/agents/agent-123/test",
      originalUrl: "/api/workspaces/workspace-123/agents/agent-123/test",
      params: { workspaceId: "workspace-123", agentId: "agent-123" },
      body: { messages: [{ role: "user", content: "Hello" }] },
      headers: {
        "x-conversation-id": "conv-123",
        "x-request-id": "req-123",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    mockBuildStreamRequestContext.mockResolvedValue({
      workspaceId: "workspace-123",
      agentId: "agent-123",
    });
    mockExecuteStreamForApiGateway.mockRejectedValue(
      new Error("Credit error")
    );
    mockHandleStreamingErrorForApiGateway.mockResolvedValue({
      statusCode: 402,
      body: JSON.stringify({ error: "Not enough credits" }),
    });

    await handler(req as express.Request, res as express.Response, next);
    await flushPromises();

    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.send).toHaveBeenCalledWith(
      JSON.stringify({ error: "Not enough credits" })
    );
    expect(next).not.toHaveBeenCalled();
  });
});
