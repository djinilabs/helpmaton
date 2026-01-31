import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDatabase,
  mockValidateCreditsAndLimitsAndReserve,
  mockGetWorkspaceApiKey,
  mockCreateAgentModel,
  mockGenerateText,
  mockExtractTokenUsageAndCosts,
  mockUpdateConversation,
  mockCreateLlmObserver,
  mockBuildObserverInputMessages,
  mockBuildConversationMessagesFromObserver,
  mockGetGenerationTimingFromObserver,
  mockResolveModelCapabilities,
  mockSupportsToolCalling,
  mockResolveToolsForCapabilities,
  mockFilterGenerateTextOptionsForCapabilities,
  mockBuildGenerateTextOptions,
  mockGetDefaultModel,
  mockInjectKnowledgeIntoMessages,
} = vi.hoisted(() => ({
  mockDatabase: vi.fn(),
  mockValidateCreditsAndLimitsAndReserve: vi.fn(),
  mockGetWorkspaceApiKey: vi.fn(),
  mockCreateAgentModel: vi.fn(),
  mockGenerateText: vi.fn(),
  mockExtractTokenUsageAndCosts: vi.fn(),
  mockUpdateConversation: vi.fn(),
  mockCreateLlmObserver: vi.fn(),
  mockBuildObserverInputMessages: vi.fn(),
  mockBuildConversationMessagesFromObserver: vi.fn(),
  mockGetGenerationTimingFromObserver: vi.fn(),
  mockResolveModelCapabilities: vi.fn(),
  mockSupportsToolCalling: vi.fn(),
  mockResolveToolsForCapabilities: vi.fn(),
  mockFilterGenerateTextOptionsForCapabilities: vi.fn(),
  mockBuildGenerateTextOptions: vi.fn(),
  mockGetDefaultModel: vi.fn(),
  mockInjectKnowledgeIntoMessages: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText: mockGenerateText,
}));

vi.mock("../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../utils/conversationLogger", () => ({
  extractTokenUsage: vi.fn(),
  updateConversation: mockUpdateConversation,
}));

vi.mock("../../../utils/creditManagement", () => ({
  adjustCreditReservation: vi.fn(),
  refundReservation: vi.fn(),
}));

vi.mock("../../../utils/creditValidation", () => ({
  validateCreditsAndLimitsAndReserve: mockValidateCreditsAndLimitsAndReserve,
}));

vi.mock("../../../utils/featureFlags", () => ({
  isCreditDeductionEnabled: () => false,
}));

vi.mock("../../../utils/sentry", () => ({
  Sentry: {
    addBreadcrumb: vi.fn(),
    captureException: vi.fn(),
  },
  ensureError: (error: unknown) => error,
  initSentry: vi.fn(),
}));

vi.mock("../generationTokenExtraction", () => ({
  extractTokenUsageAndCosts: mockExtractTokenUsageAndCosts,
}));

vi.mock("../agent-keys", () => ({
  getWorkspaceApiKey: mockGetWorkspaceApiKey,
}));

vi.mock("../agent-model", () => ({
  buildGenerateTextOptions: mockBuildGenerateTextOptions,
  createAgentModel: mockCreateAgentModel,
}));

vi.mock("../llmObserver", () => ({
  createLlmObserver: mockCreateLlmObserver,
  buildObserverInputMessages: mockBuildObserverInputMessages,
  buildConversationMessagesFromObserver: mockBuildConversationMessagesFromObserver,
  getGenerationTimingFromObserver: mockGetGenerationTimingFromObserver,
  wrapToolsWithObserver: (tools: unknown) => tools,
}));

vi.mock("../modelCapabilities", () => ({
  resolveModelCapabilities: mockResolveModelCapabilities,
  supportsToolCalling: mockSupportsToolCalling,
  resolveToolsForCapabilities: mockResolveToolsForCapabilities,
  filterGenerateTextOptionsForCapabilities:
    mockFilterGenerateTextOptionsForCapabilities,
}));

vi.mock("../modelFactory", () => ({
  getDefaultModel: mockGetDefaultModel,
}));

vi.mock("../requestTimeout", () => ({
  isTimeoutError: () => false,
}));

vi.mock("../../../utils/knowledgeInjection", () => ({
  injectKnowledgeIntoMessages: mockInjectKnowledgeIntoMessages,
}));

import type { DatabaseSchema } from "../../../tables/schema";
import { callAgentInternal } from "../call-agent-internal";

describe("callAgentInternal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    const mockDb = {
      agent: {
        get: vi.fn().mockResolvedValue({
          pk: "agents/workspace-1/agent-1",
          workspaceId: "workspace-1",
          systemPrompt: "You are helpful",
        }),
      },
    } as unknown as DatabaseSchema;

    mockDatabase.mockResolvedValue(mockDb);
    mockGetWorkspaceApiKey.mockResolvedValue("byok-key");
    mockCreateAgentModel.mockResolvedValue({});
    mockGenerateText.mockResolvedValue({
      text: "Delegated response",
    });
    mockBuildGenerateTextOptions.mockReturnValue({});
    mockResolveModelCapabilities.mockReturnValue({});
    mockSupportsToolCalling.mockReturnValue(false);
    mockResolveToolsForCapabilities.mockReturnValue(undefined);
    mockFilterGenerateTextOptionsForCapabilities.mockReturnValue({});
    mockGetDefaultModel.mockReturnValue("default-model");
    mockBuildObserverInputMessages.mockReturnValue([]);
    mockCreateLlmObserver.mockReturnValue({
      recordInputMessages: vi.fn(),
      recordFromResult: vi.fn(),
      getEvents: vi.fn(() => []),
    });
    mockBuildConversationMessagesFromObserver.mockReturnValue([
      { role: "assistant", content: "Delegated response" },
    ]);
    mockGetGenerationTimingFromObserver.mockReturnValue({});
    mockExtractTokenUsageAndCosts.mockReturnValue({
      tokenUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      openrouterGenerationId: undefined,
      openrouterGenerationIds: undefined,
      provisionalCostUsd: 0,
    });
    mockInjectKnowledgeIntoMessages.mockResolvedValue({
      modelMessages: [{ role: "user", content: "Hello" }],
      knowledgeInjectionMessage: undefined,
      rerankingRequestMessage: undefined,
      rerankingResultMessage: undefined,
    });
    mockValidateCreditsAndLimitsAndReserve.mockResolvedValue(null);
  });

  it("returns early when max delegation depth is reached", async () => {
    const result = await callAgentInternal(
      "workspace-1",
      "agent-1",
      "Hello",
      2,
      2
    );

    expect(result.response).toContain("Maximum delegation depth");
    expect(result.shouldTrackRequest).toBe(false);
    expect(result.targetAgentConversationId).toBeTruthy();
  });

  it("passes BYOK into delegation credit reservation", async () => {
    const result = await callAgentInternal(
      "workspace-1",
      "agent-1",
      "Hello",
      0,
      2
    );

    expect(result.response).toBe("Delegated response");
    expect(mockValidateCreditsAndLimitsAndReserve).toHaveBeenCalledWith(
      expect.any(Object),
      "workspace-1",
      "agent-1",
      "openrouter",
      "default-model",
      expect.any(Array),
      "You are helpful",
      undefined,
      true
    );
  });
});
