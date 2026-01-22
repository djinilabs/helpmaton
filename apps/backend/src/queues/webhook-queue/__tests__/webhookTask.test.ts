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
} = vi.hoisted(() => ({
  mockDatabase: vi.fn(),
  mockStartConversation: vi.fn(),
  mockCallAgentNonStreaming: vi.fn(),
  mockValidateSubscriptionAndLimits: vi.fn(),
  mockTrackSuccessfulRequest: vi.fn(),
  mockEnqueueCostVerificationIfNeeded: vi.fn(),
  mockBuildConversationMessagesFromObserver: vi.fn(),
  mockSetupAgentAndTools: vi.fn(),
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
  formatToolCallMessage: vi.fn(() => ({ content: [] })),
  formatToolResultMessage: vi.fn(() => ({ content: [] })),
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
});
