import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockDatabase,
  mockStartConversation,
  mockCallAgentNonStreaming,
  mockValidateSubscriptionAndLimits,
  mockTrackSuccessfulRequest,
  mockEnqueueCostVerificationIfNeeded,
  mockBuildConversationMessagesFromObserver,
  mockSetupAgentAndTools,
  mockFormatToolCallMessage,
  mockFormatToolResultMessage,
} = vi.hoisted(() => ({
  mockDatabase: vi.fn(),
  mockStartConversation: vi.fn(),
  mockCallAgentNonStreaming: vi.fn(),
  mockValidateSubscriptionAndLimits: vi.fn(),
  mockTrackSuccessfulRequest: vi.fn(),
  mockEnqueueCostVerificationIfNeeded: vi.fn(),
  mockBuildConversationMessagesFromObserver: vi.fn(),
  mockSetupAgentAndTools: vi.fn(),
  mockFormatToolCallMessage: vi.fn(),
  mockFormatToolResultMessage: vi.fn(),
}));

vi.mock("../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../http/utils/generationCreditManagement", () => ({
  enqueueCostVerificationIfNeeded: mockEnqueueCostVerificationIfNeeded,
}));

vi.mock("../../../http/utils/generationErrorHandling", () => ({
  isByokAuthenticationError: vi.fn(() => false),
  normalizeByokError: vi.fn((error) => error),
  handleCreditErrors: vi.fn(async () => ({ handled: false })),
  logErrorDetails: vi.fn(),
}));

vi.mock("../../../http/utils/generationRequestTracking", () => ({
  validateSubscriptionAndLimits: mockValidateSubscriptionAndLimits,
  trackSuccessfulRequest: mockTrackSuccessfulRequest,
}));

vi.mock("../../../http/utils/generationToolReconstruction", () => ({
  reconstructToolCallsFromResults: vi.fn((results) => results),
}));

vi.mock("../../../utils/conversationLogger", () => ({
  isMessageContentEmpty: vi.fn(() => false),
  startConversation: mockStartConversation,
  buildConversationErrorInfo: vi.fn(() => ({
    message: "error",
    name: "Error",
    code: "ERR",
    statusCode: 500,
  })),
}));

vi.mock("../../../utils/sentry", () => ({
  ensureError: vi.fn((error) => error),
  Sentry: {
    captureException: vi.fn(),
  },
}));

vi.mock("../../../utils/tracking", () => ({
  trackBusinessEvent: vi.fn(),
}));

vi.mock("../../../http/utils/agentCallNonStreaming", () => ({
  callAgentNonStreaming: mockCallAgentNonStreaming,
}));

vi.mock("../../../http/utils/llmObserver", () => ({
  buildConversationMessagesFromObserver: mockBuildConversationMessagesFromObserver,
}));

vi.mock("../../../http/utils/messageConversion", () => ({
  convertTextToUIMessage: vi.fn((text: string) => ({
    role: "user",
    content: text,
  })),
}));

vi.mock("../../../http/utils/requestTimeout", () => ({
  createRequestTimeout: vi.fn(() => ({
    controller: new AbortController(),
    signal: new AbortController().signal,
    timeoutId: null,
  })),
  cleanupRequestTimeout: vi.fn(),
  isTimeoutError: vi.fn(() => false),
  createTimeoutError: vi.fn(() => new Error("timeout")),
}));

vi.mock("../../../http/utils/toolFormatting", () => ({
  formatToolCallMessage: mockFormatToolCallMessage,
  formatToolResultMessage: mockFormatToolResultMessage,
}));

vi.mock("../../../utils/workspaceCreditContext", () => ({
  getTransactionBuffer: vi.fn(() => undefined),
}));

vi.mock("../../../utils/workspaceCreditTransactions", () => ({
  updateTransactionBufferConversationId: vi.fn(),
}));

vi.mock("../../../http/utils/agentSetup", () => ({
  setupAgentAndTools: mockSetupAgentAndTools,
}));

import type { AugmentedContext } from "../../../utils/workspaceCreditContext";
import { processWebhookTask } from "../webhookTask";

describe("processWebhookTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabase.mockResolvedValue({} as never);
    mockValidateSubscriptionAndLimits.mockResolvedValue("sub-123");
    mockTrackSuccessfulRequest.mockResolvedValue(undefined);
    mockEnqueueCostVerificationIfNeeded.mockResolvedValue(undefined);
    mockBuildConversationMessagesFromObserver.mockReturnValue(null);
    mockFormatToolCallMessage.mockReturnValue({
      role: "assistant",
      content: [],
    });
    mockFormatToolResultMessage.mockReturnValue({
      role: "assistant",
      content: [],
    });
    mockSetupAgentAndTools.mockResolvedValue({
      agent: { modelName: "openrouter/test" },
      usesByok: false,
    });
    mockCallAgentNonStreaming.mockResolvedValue({
      text: "hello",
      tokenUsage: undefined,
      rawResult: {
        toolCalls: [],
        toolResults: [],
      },
    });
    mockStartConversation.mockResolvedValue("conversation-789");
  });

  const buildContext = (awsRequestId = "msg-1") =>
    ({
      awsRequestId,
      addWorkspaceCreditTransaction: vi.fn(),
    }) as unknown as AugmentedContext;

  it("marks webhook conversations as webhook type", async () => {
    const context = {
      awsRequestId: "msg-1",
      addWorkspaceCreditTransaction: vi.fn(),
    } as unknown as AugmentedContext;

    await processWebhookTask({
      workspaceId: "workspace-123",
      agentId: "agent-456",
      bodyText: "hello",
      conversationId: "conversation-789",
      context,
      awsRequestId: "msg-1",
    });

    expect(mockStartConversation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        conversationId: "conversation-789",
        conversationType: "webhook",
      })
    );
  });

  it("records tool calls in conversation when tools are used", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const bodyText = "Search for documents about testing";

    const toolCall = {
      toolCallId: "call-123",
      toolName: "searchDocuments",
      args: { query: "testing" },
    };
    const toolResult = {
      toolCallId: "call-123",
      toolName: "searchDocuments",
      result: "Found 3 documents about testing",
    };

    mockCallAgentNonStreaming.mockResolvedValue({
      text: "I found some documents about testing.",
      tokenUsage: {
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
      },
      rawResult: {
        text: "I found some documents about testing.",
        toolCalls: [toolCall],
        toolResults: [toolResult],
        steps: [
          {
            content: [
              {
                type: "tool-call",
                toolCallId: "call-123",
                toolName: "searchDocuments",
                input: { query: "testing" },
              },
            ],
          },
          {
            content: [
              {
                type: "tool-result",
                toolCallId: "call-123",
                toolName: "searchDocuments",
                result: "Found 3 documents about testing",
              },
            ],
          },
        ],
      },
      openrouterGenerationId: "gen-123",
      openrouterGenerationIds: ["gen-123"],
      provisionalCostUsd: 0.01,
      usesByok: false,
      modelName: "google/gemini-1.5-pro",
    });

    mockFormatToolCallMessage.mockReturnValue({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "call-123",
          toolName: "searchDocuments",
          args: { query: "testing" },
        },
      ],
    });
    mockFormatToolResultMessage.mockReturnValue({
      role: "assistant",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-123",
          toolName: "searchDocuments",
          result: "Found 3 documents about testing",
        },
      ],
    });

    const context = buildContext();
    await processWebhookTask({
      workspaceId,
      agentId,
      bodyText,
      conversationId: "conversation-id-123",
      subscriptionId: "sub-123",
      context,
      awsRequestId: "msg-1",
    });

    const conversationData = mockStartConversation.mock.calls[0][1];
    const messages = conversationData.messages;
    const assistantMessage = messages.find(
      (msg: { role: string }) => msg.role === "assistant"
    );

    expect(assistantMessage?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "tool-call" }),
        expect.objectContaining({ type: "tool-result" }),
      ])
    );
  });

  it("extracts tool calls from _steps when toolCalls is empty", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const bodyText = "Search for documents about testing";

    mockCallAgentNonStreaming.mockResolvedValue({
      text: "I found some documents about testing.",
      tokenUsage: {
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
      },
      rawResult: {
        text: "I found some documents about testing.",
        toolCalls: [],
        toolResults: [],
        _steps: {
          status: {
            value: [
              {
                content: [
                  {
                    type: "tool-call",
                    toolCallId: "call-123",
                    toolName: "searchDocuments",
                    input: { query: "testing" },
                  },
                ],
              },
              {
                content: [
                  {
                    type: "tool-result",
                    toolCallId: "call-123",
                    toolName: "searchDocuments",
                    result: "Found 3 documents about testing",
                  },
                ],
              },
            ],
          },
        },
      },
      openrouterGenerationId: "gen-123",
      openrouterGenerationIds: ["gen-123"],
      provisionalCostUsd: 0.01,
      usesByok: false,
      modelName: "google/gemini-1.5-pro",
    });

    mockFormatToolCallMessage.mockReturnValue({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "call-123",
          toolName: "searchDocuments",
          args: { query: "testing" },
        },
      ],
    });
    mockFormatToolResultMessage.mockReturnValue({
      role: "assistant",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-123",
          toolName: "searchDocuments",
          result: "Found 3 documents about testing",
        },
      ],
    });

    const context = buildContext();
    await processWebhookTask({
      workspaceId,
      agentId,
      bodyText,
      conversationId: "conversation-id-456",
      subscriptionId: "sub-123",
      context,
      awsRequestId: "msg-1",
    });

    const conversationData = mockStartConversation.mock.calls[0][1];
    const assistantMessage = conversationData.messages.find(
      (msg: { role: string }) => msg.role === "assistant"
    );

    expect(assistantMessage?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "tool-call" }),
        expect.objectContaining({ type: "tool-result" }),
      ])
    );
  });

  it("logs tool error results without failing the webhook", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const bodyText = "Search for documents about testing";

    mockCallAgentNonStreaming.mockResolvedValue({
      text: "I found some documents about testing.",
      tokenUsage: {
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
      },
      rawResult: {
        text: "I found some documents about testing.",
        toolCalls: [],
        toolResults: [],
        steps: [
          {
            content: [
              {
                type: "tool-call",
                toolCallId: "call-123",
                toolName: "searchDocuments",
                input: { query: "testing" },
              },
            ],
          },
          {
            content: [
              {
                type: "tool-result",
                toolCallId: "call-123",
                toolName: "searchDocuments",
                result: { error: "Search failed" },
              },
            ],
          },
        ],
      },
      openrouterGenerationId: "gen-123",
      openrouterGenerationIds: ["gen-123"],
      provisionalCostUsd: 0.01,
      usesByok: false,
      modelName: "google/gemini-1.5-pro",
    });

    mockFormatToolCallMessage.mockReturnValue({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "call-123",
          toolName: "searchDocuments",
          args: { query: "testing" },
        },
      ],
    });
    mockFormatToolResultMessage.mockReturnValue({
      role: "assistant",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-123",
          toolName: "searchDocuments",
          result: { error: "Search failed" },
        },
      ],
    });

    const context = buildContext();
    await processWebhookTask({
      workspaceId,
      agentId,
      bodyText,
      conversationId: "conversation-id-err",
      subscriptionId: "sub-123",
      context,
      awsRequestId: "msg-1",
    });

    const conversationData = mockStartConversation.mock.calls[0][1];
    const assistantMessage = conversationData.messages.find(
      (msg: { role: string }) => msg.role === "assistant"
    );

    expect(assistantMessage?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "tool-call" }),
        expect.objectContaining({ type: "tool-result" }),
      ])
    );
  });

  it("includes assistant text when observer has only tool events", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const bodyText = "Search for documents about testing";

    mockBuildConversationMessagesFromObserver.mockReturnValue([
      { role: "assistant", content: [] },
    ]);
    mockCallAgentNonStreaming.mockResolvedValue({
      text: "I found some documents about testing.",
      tokenUsage: {
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
      },
      rawResult: {
        text: "I found some documents about testing.",
        toolCalls: [],
        toolResults: [],
        steps: [
          {
            content: [
              {
                type: "tool-call",
                toolCallId: "call-123",
                toolName: "searchDocuments",
                input: { query: "testing" },
              },
            ],
          },
        ],
      },
      observerEvents: [{ type: "tool-call" }],
      openrouterGenerationId: "gen-123",
      openrouterGenerationIds: ["gen-123"],
      provisionalCostUsd: 0.01,
      usesByok: false,
      modelName: "google/gemini-1.5-pro",
    });

    mockFormatToolCallMessage.mockReturnValue({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "call-123",
          toolName: "searchDocuments",
          args: { query: "testing" },
        },
      ],
    });

    const context = buildContext();
    await processWebhookTask({
      workspaceId,
      agentId,
      bodyText,
      conversationId: "conversation-id-obs",
      subscriptionId: "sub-123",
      context,
      awsRequestId: "msg-1",
    });

    const conversationData = mockStartConversation.mock.calls[0][1];
    const assistantMessage = conversationData.messages.find(
      (msg: { role: string }) => msg.role === "assistant"
    );

    expect(assistantMessage?.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "text" })])
    );
  });

  it("extracts tool calls, token usage, and costs from result.steps structure", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const bodyText = "Search for documents about testing";

    mockCallAgentNonStreaming.mockResolvedValue({
      text: "I found some documents about testing.",
      tokenUsage: {
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
      },
      rawResult: {
        text: "I found some documents about testing.",
        toolCalls: [],
        toolResults: [],
        steps: [
          {
            content: [
              {
                type: "tool-call",
                toolCallId: "call-123",
                toolName: "searchDocuments",
                args: { query: "testing" },
              },
            ],
          },
          {
            content: [
              {
                type: "tool-result",
                toolCallId: "call-123",
                toolName: "searchDocuments",
                result: "Found 3 documents about testing",
              },
            ],
          },
        ],
      },
      openrouterGenerationId: "gen-123",
      openrouterGenerationIds: ["gen-123"],
      provisionalCostUsd: 0.01,
      usesByok: false,
      modelName: "google/gemini-1.5-pro",
    });

    mockFormatToolCallMessage.mockReturnValue({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "call-123",
          toolName: "searchDocuments",
          args: { query: "testing" },
        },
      ],
    });
    mockFormatToolResultMessage.mockReturnValue({
      role: "assistant",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-123",
          toolName: "searchDocuments",
          result: "Found 3 documents about testing",
        },
      ],
    });

    const context = buildContext();
    await processWebhookTask({
      workspaceId,
      agentId,
      bodyText,
      conversationId: "conversation-id-steps",
      subscriptionId: "sub-123",
      context,
      awsRequestId: "msg-1",
    });

    const conversationData = mockStartConversation.mock.calls[0][1];
    const assistantMessage = conversationData.messages.find(
      (msg: { role: string }) => msg.role === "assistant"
    );

    expect(assistantMessage?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "tool-call" }),
        expect.objectContaining({ type: "tool-result" }),
      ])
    );
  });

  it("passes token usage and costs to startConversation", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const bodyText = "Search for documents about testing";

    const expectedTokenUsage = {
      promptTokens: 50,
      completionTokens: 25,
      totalTokens: 75,
    };
    const expectedCostUsd = 0.05;

    mockCallAgentNonStreaming.mockResolvedValue({
      text: "I found some documents about testing.",
      tokenUsage: expectedTokenUsage,
      rawResult: {
        text: "I found some documents about testing.",
        toolCalls: [],
        toolResults: [],
        steps: [
          {
            content: [
              {
                type: "tool-call",
                toolCallId: "call-123",
                toolName: "searchDocuments",
                args: { query: "testing" },
              },
            ],
          },
        ],
      },
      openrouterGenerationId: "gen-123",
      openrouterGenerationIds: ["gen-123"],
      provisionalCostUsd: expectedCostUsd,
      usesByok: false,
      modelName: "google/gemini-1.5-pro",
    });

    const context = buildContext();
    await processWebhookTask({
      workspaceId,
      agentId,
      bodyText,
      conversationId: "conversation-id-789",
      subscriptionId: "sub-123",
      context,
      awsRequestId: "msg-1",
    });

    const conversationData = mockStartConversation.mock.calls[0][1];

    expect(conversationData.tokenUsage).toEqual(expectedTokenUsage);

    const assistantMessage = conversationData.messages.find(
      (msg: { role: string }) => msg.role === "assistant"
    );
    expect(assistantMessage?.tokenUsage).toEqual(expectedTokenUsage);
    expect(assistantMessage?.provisionalCostUsd).toBe(expectedCostUsd);

    expect(mockEnqueueCostVerificationIfNeeded).toHaveBeenCalledWith(
      "gen-123",
      ["gen-123"],
      workspaceId,
      undefined,
      "conversation-id-789",
      agentId,
      "webhook"
    );
  });
});
