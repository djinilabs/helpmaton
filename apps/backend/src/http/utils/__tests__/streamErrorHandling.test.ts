import { beforeEach, describe, expect, it, vi } from "vitest";

import { InsufficientCreditsError } from "../../../utils/creditErrors";
import {
  handleResultExtractionError,
  handleStreamingError,
  handleStreamingErrorForApiGateway,
} from "../streamErrorHandling";
import type { StreamRequestContext } from "../streamRequestContext";
import { createMockResponseStream } from "../streamResponseStream";

const { mockUpdateConversation, mockSentryCaptureException } = vi.hoisted(
  () => {
    return {
      mockUpdateConversation: vi.fn(),
      mockSentryCaptureException: vi.fn(),
    };
  },
);

vi.mock("../../../utils/conversationLogger", async () => {
  const actual = await vi.importActual<
    typeof import("../../../utils/conversationLogger")
  >("../../../utils/conversationLogger");
  return {
    ...actual,
    updateConversation: mockUpdateConversation,
  };
});

vi.mock("../../../utils/sentry", () => ({
  initSentry: vi.fn(),
  flushSentry: vi.fn().mockResolvedValue(undefined),
  ensureError: (error: unknown) =>
    error instanceof Error ? error : new Error(String(error)),
  Sentry: {
    captureException: mockSentryCaptureException,
    startSpan: async (_config: unknown, callback: () => unknown) => callback(),
    setTag: vi.fn(),
    setContext: vi.fn(),
    withScope: (callback: (scope: unknown) => unknown) =>
      callback({
        setTag: vi.fn(),
        setContext: vi.fn(),
      }),
    flush: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../../utils/agentErrorNotifications", () => ({
  sendAgentErrorNotification: vi.fn().mockResolvedValue(undefined),
}));

describe("streamErrorHandling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createContext = (): StreamRequestContext =>
    ({
      workspaceId: "workspace-1",
      agentId: "agent-1",
      conversationId: "conversation-1",
      endpointType: "stream",
      origin: undefined,
      allowedOrigins: null,
      subscriptionId: undefined,
      db: {} as StreamRequestContext["db"],
      uiMessage: { role: "user", content: "hi" },
      convertedMessages: [],
      modelMessages: [],
      agent: {} as StreamRequestContext["agent"],
      model: {} as StreamRequestContext["model"],
      tools: {} as StreamRequestContext["tools"],
      llmObserver: {} as StreamRequestContext["llmObserver"],
      usesByok: false,
      reservationId: undefined,
      finalModelName: "openrouter/test",
      awsRequestId: "req-1",
      userId: "user-1",
    }) as StreamRequestContext;

  it("returns AI error details for wrapped NoOutputGeneratedError", async () => {
    const apiError = new Error("API call failed");
    apiError.name = "AI_APICallError";
    (apiError as { statusCode?: number }).statusCode = 400;
    (
      apiError as {
        data?: { error?: { message?: string } };
      }
    ).data = {
      error: { message: "cohere/rerank-v3 is not a valid model ID" },
    };

    const wrapper = new Error("No output generated");
    wrapper.name = "AI_NoOutputGeneratedError";
    (wrapper as { cause?: unknown }).cause = apiError;

    const context = {
      workspaceId: "workspace-1",
      agentId: "agent-1",
      conversationId: "conversation-1",
      endpointType: "test",
      origin: undefined,
      allowedOrigins: null,
      subscriptionId: undefined,
      db: {} as StreamRequestContext["db"],
      uiMessage: { role: "user", content: "hi" },
      convertedMessages: [],
      modelMessages: [],
      agent: {} as StreamRequestContext["agent"],
      model: {} as StreamRequestContext["model"],
      tools: {} as StreamRequestContext["tools"],
      llmObserver: {} as StreamRequestContext["llmObserver"],
      usesByok: false,
      reservationId: undefined,
      finalModelName: "openrouter/test",
      awsRequestId: "req-1",
      userId: "user-1",
    } as StreamRequestContext;

    const response = await handleStreamingErrorForApiGateway(
      wrapper,
      context,
      { "Content-Type": "application/json" },
      true,
    );

    expect(response).not.toBeNull();
    expect(typeof response).toBe("object");

    if (!response || typeof response !== "object") {
      throw new Error("Expected API Gateway structured response");
    }

    const statusCode =
      "statusCode" in response ? response.statusCode : undefined;
    const body =
      "body" in response && typeof response.body === "string"
        ? response.body
        : undefined;

    expect(statusCode).toBe(400);
    expect(body).toBe("cohere/rerank-v3 is not a valid model ID");
  });

  it("does not report InsufficientCreditsError to Sentry during streaming", async () => {
    const context = createContext();
    const { stream, getBody } = createMockResponseStream();
    const consoleInfoSpy = vi
      .spyOn(console, "info")
      .mockImplementation(() => {});
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const err = new InsufficientCreditsError("workspace-1", 1_000, 0, "usd");

    const handled = await handleStreamingError(err, context, stream, false);

    expect(handled).toBe(true);
    expect(mockSentryCaptureException).not.toHaveBeenCalled();
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining("Credit user error (not reported to Sentry)"),
      expect.objectContaining({
        workspaceId: "workspace-1",
        agentId: "agent-1",
        conversationId: "conversation-1",
        endpoint: "stream",
      }),
    );
    expect(mockUpdateConversation).toHaveBeenCalledTimes(1);
    expect(getBody()).toContain(
      "Request could not be completed due to service limits",
    );

    consoleInfoSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("still reports BYOK authentication errors to Sentry", async () => {
    const context = createContext();
    context.usesByok = true;
    const { stream, getBody } = createMockResponseStream();
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const wrapper = new Error("No output generated");
    wrapper.name = "AI_NoOutputGeneratedError";

    const handled = await handleStreamingError(wrapper, context, stream, false);

    expect(handled).toBe(true);
    expect(mockSentryCaptureException).toHaveBeenCalledTimes(1);
    expect(getBody()).toContain(
      "There is a configuration issue with your OpenRouter API key",
    );

    consoleErrorSpy.mockRestore();
  });

  it("does not report InsufficientCreditsError to Sentry during result extraction", async () => {
    const context = createContext();
    const { stream, getBody } = createMockResponseStream();
    const consoleInfoSpy = vi
      .spyOn(console, "info")
      .mockImplementation(() => {});
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const err = new InsufficientCreditsError("workspace-1", 1_000, 0, "usd");

    const handled = await handleResultExtractionError(err, context, stream);

    expect(handled).toBe(true);
    expect(mockSentryCaptureException).not.toHaveBeenCalled();
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "Credit user error during result extraction (not reported to Sentry)",
      ),
      expect.objectContaining({
        workspaceId: "workspace-1",
        agentId: "agent-1",
        conversationId: "conversation-1",
        endpoint: "stream",
      }),
    );
    expect(mockUpdateConversation).toHaveBeenCalledTimes(1);
    expect(getBody()).toContain("Insufficient credits");

    consoleInfoSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
});
