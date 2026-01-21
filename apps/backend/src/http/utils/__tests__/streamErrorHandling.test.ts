import { describe, expect, it, vi } from "vitest";

import { handleStreamingErrorForApiGateway } from "../streamErrorHandling";
import type { StreamRequestContext } from "../streamRequestContext";

const { mockUpdateConversation } = vi.hoisted(() => {
  return {
    mockUpdateConversation: vi.fn(),
  };
});

vi.mock("../../../utils/conversationLogger", async () => {
  const actual = await vi.importActual<
    typeof import("../../../utils/conversationLogger")
  >("../../../utils/conversationLogger");
  return {
    ...actual,
    updateConversation: mockUpdateConversation,
  };
});

describe("streamErrorHandling", () => {
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
      true
    );

    expect(response).not.toBeNull();
    expect(typeof response).toBe("object");

    if (!response || typeof response !== "object") {
      throw new Error("Expected API Gateway structured response");
    }

    const statusCode = "statusCode" in response ? response.statusCode : undefined;
    const body =
      "body" in response && typeof response.body === "string"
        ? response.body
        : undefined;

    expect(statusCode).toBe(400);
    expect(body).toBe("cohere/rerank-v3 is not a valid model ID");
  });
});
