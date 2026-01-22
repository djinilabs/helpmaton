import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGenerateText,
  mockSetupAgentAndTools,
  mockValidateAndReserveCredits,
  mockAdjustCreditsAfterLLMCall,
  mockCleanupReservationOnError,
  mockPrepareLLMCall,
  mockExtractTokenUsageAndCosts,
  mockProcessNonStreamingResponse,
  mockResolveModelCapabilities,
  mockResolveToolsForCapabilities,
  mockInjectKnowledgeIntoMessages,
  mockDatabase,
} = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  mockSetupAgentAndTools: vi.fn(),
  mockValidateAndReserveCredits: vi.fn(),
  mockAdjustCreditsAfterLLMCall: vi.fn(),
  mockCleanupReservationOnError: vi.fn(),
  mockPrepareLLMCall: vi.fn(),
  mockExtractTokenUsageAndCosts: vi.fn(),
  mockProcessNonStreamingResponse: vi.fn(),
  mockResolveModelCapabilities: vi.fn(),
  mockResolveToolsForCapabilities: vi.fn(),
  mockInjectKnowledgeIntoMessages: vi.fn(),
  mockDatabase: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText: mockGenerateText,
}));

vi.mock("../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../agentSetup", () => ({
  setupAgentAndTools: mockSetupAgentAndTools,
}));

vi.mock("../generationCreditManagement", () => ({
  validateAndReserveCredits: mockValidateAndReserveCredits,
  adjustCreditsAfterLLMCall: mockAdjustCreditsAfterLLMCall,
  cleanupReservationOnError: mockCleanupReservationOnError,
}));

vi.mock("../generationLLMSetup", () => ({
  prepareLLMCall: mockPrepareLLMCall,
}));

vi.mock("../generationTokenExtraction", () => ({
  extractTokenUsageAndCosts: mockExtractTokenUsageAndCosts,
}));

vi.mock("../modelCapabilities", () => ({
  resolveModelCapabilities: mockResolveModelCapabilities,
  resolveToolsForCapabilities: mockResolveToolsForCapabilities,
}));

vi.mock("../streaming", () => ({
  processNonStreamingResponse: mockProcessNonStreamingResponse,
}));

vi.mock("../../../utils/knowledgeInjection", () => ({
  injectKnowledgeIntoMessages: mockInjectKnowledgeIntoMessages,
}));

import {
  buildNonStreamingSetupOptions,
  callAgentNonStreaming,
  type AgentCallNonStreamingOptions,
} from "../agentCallNonStreaming";
import { createLlmObserver } from "../llmObserver";

describe("buildNonStreamingSetupOptions", () => {
  it("uses defaults and agentId for conversationOwnerAgentId", () => {
    const options: AgentCallNonStreamingOptions = {};
    const setupOptions = buildNonStreamingSetupOptions(
      "agent-123",
      options,
      createLlmObserver()
    );

    expect(setupOptions.modelReferer).toBe("http://localhost:3000/api/bridge");
    expect(setupOptions.conversationOwnerAgentId).toBe("agent-123");
    expect(setupOptions.callDepth).toBe(0);
    expect(setupOptions.maxDelegationDepth).toBe(3);
  });

  it("honors provided modelReferer and owner overrides", () => {
    const options: AgentCallNonStreamingOptions = {
      modelReferer: "https://example.com/bridge",
      conversationOwnerAgentId: "owner-456",
    };

    const setupOptions = buildNonStreamingSetupOptions(
      "agent-123",
      options,
      createLlmObserver()
    );

    expect(setupOptions.modelReferer).toBe("https://example.com/bridge");
    expect(setupOptions.conversationOwnerAgentId).toBe("owner-456");
  });
});

describe("callAgentNonStreaming", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const mockDb = {
      "agent-conversations": {
        get: vi.fn().mockResolvedValue(undefined),
      },
    };
    mockDatabase.mockResolvedValue(mockDb);
    mockSetupAgentAndTools.mockResolvedValue({
      agent: {
        systemPrompt: "system",
        modelName: "test-model",
      },
      model: {},
      tools: {},
      usesByok: false,
    });
    mockInjectKnowledgeIntoMessages.mockResolvedValue({
      modelMessages: [{ role: "user", content: "hello" }],
      knowledgeInjectionMessage: undefined,
      rerankingRequestMessage: undefined,
      rerankingResultMessage: undefined,
    });
    mockValidateAndReserveCredits.mockResolvedValue("reservation-id");
    mockGenerateText.mockResolvedValue({
      text: "ok",
      totalUsage: {
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
      },
    });
    mockExtractTokenUsageAndCosts.mockReturnValue({
      tokenUsage: {
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
      },
      openrouterGenerationId: undefined,
      openrouterGenerationIds: undefined,
      provisionalCostUsd: 0,
    });
    mockProcessNonStreamingResponse.mockResolvedValue({
      text: "ok",
      tokenUsage: {
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
      },
    });
    mockResolveModelCapabilities.mockReturnValue({});
    mockResolveToolsForCapabilities.mockReturnValue({});
    mockPrepareLLMCall.mockReturnValue({});
  });

  it("forwards conversationId to credit reservation", async () => {
    await callAgentNonStreaming("workspace-1", "agent-1", "hello", {
      conversationId: "conversation-123",
    });

    expect(mockValidateAndReserveCredits).toHaveBeenCalled();
    const callArgs = mockValidateAndReserveCredits.mock.calls[0];
    expect(callArgs[11]).toBe("conversation-123");
  });
});
