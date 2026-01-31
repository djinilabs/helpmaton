import { describe, it, expect, vi, beforeEach } from "vitest";

import type { AugmentedContext } from "../../workspaceCreditContext";
import { extractEntitiesFromPrompt } from "../entityExtraction";

const mockGenerateText = vi.fn();
const mockCreateModel = vi.fn();
const mockGetDefaultModel = vi.fn();
const mockGetWorkspaceApiKey = vi.fn();
const mockValidateCreditsAndLimitsAndReserve = vi.fn();
const mockCreateRequestTimeout = vi.fn();
const mockCleanupRequestTimeout = vi.fn();
const mockExtractTokenUsageAndCosts = vi.fn();
const mockAdjustCreditsAfterLLMCall = vi.fn();
const mockCleanupReservationWithoutTokenUsage = vi.fn();
const mockCleanupReservationOnError = vi.fn();
const mockEnqueueCostVerificationIfNeeded = vi.fn();

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

vi.mock("../../../http/utils/modelFactory", () => ({
  createModel: (...args: unknown[]) => mockCreateModel(...args),
  getDefaultModel: () => mockGetDefaultModel(),
}));

vi.mock("../../../http/utils/agent-keys", () => ({
  getWorkspaceApiKey: (...args: unknown[]) => mockGetWorkspaceApiKey(...args),
}));

vi.mock("../../../http/utils/requestTimeout", () => ({
  createRequestTimeout: () => mockCreateRequestTimeout(),
  cleanupRequestTimeout: (...args: unknown[]) =>
    mockCleanupRequestTimeout(...args),
}));

vi.mock("../../../http/utils/generationTokenExtraction", () => ({
  extractTokenUsageAndCosts: (...args: unknown[]) =>
    mockExtractTokenUsageAndCosts(...args),
}));

vi.mock("../../../http/utils/generationCreditManagement", () => ({
  adjustCreditsAfterLLMCall: (...args: unknown[]) =>
    mockAdjustCreditsAfterLLMCall(...args),
  cleanupReservationWithoutTokenUsage: (...args: unknown[]) =>
    mockCleanupReservationWithoutTokenUsage(...args),
  cleanupReservationOnError: (...args: unknown[]) =>
    mockCleanupReservationOnError(...args),
  enqueueCostVerificationIfNeeded: (...args: unknown[]) =>
    mockEnqueueCostVerificationIfNeeded(...args),
}));

vi.mock("../../../tables", () => ({
  database: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../creditValidation", () => ({
  validateCreditsAndLimitsAndReserve: (...args: unknown[]) =>
    mockValidateCreditsAndLimitsAndReserve(...args),
}));

describe("extractEntitiesFromPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDefaultModel.mockReturnValue("gpt-4o-mini");
    mockCreateRequestTimeout.mockReturnValue({ signal: {} });
    mockGetWorkspaceApiKey.mockResolvedValue(null);
    mockValidateCreditsAndLimitsAndReserve.mockResolvedValue({
      reservationId: "res-1",
      reservedAmount: 123,
      workspace: {},
    });
    mockExtractTokenUsageAndCosts.mockReturnValue({
      tokenUsage: {
        promptTokens: 1,
        completionTokens: 2,
        totalTokens: 3,
      },
      openrouterGenerationId: "gen-1",
      openrouterGenerationIds: ["gen-1"],
      provisionalCostUsd: 123,
    });
  });

  it("returns empty array when prompt is empty", async () => {
    const result = await extractEntitiesFromPrompt({
      workspaceId: "workspace-1",
      agentId: "agent-1",
      prompt: "   ",
    });

    expect(result).toEqual([]);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("returns parsed entities from response and manages credits", async () => {
    mockCreateModel.mockResolvedValue({});
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({ entities: ["User", "TypeScript"] }),
    });

    const context = {
      addWorkspaceCreditTransaction: vi.fn(),
    } as unknown as AugmentedContext;

    const result = await extractEntitiesFromPrompt({
      workspaceId: "workspace-1",
      agentId: "agent-1",
      prompt: "User prefers TypeScript",
      context,
      conversationId: "conversation-1",
    });

    expect(result).toEqual(["User", "TypeScript"]);
    expect(mockValidateCreditsAndLimitsAndReserve).toHaveBeenCalled();
    expect(mockExtractTokenUsageAndCosts).toHaveBeenCalled();
    expect(mockAdjustCreditsAfterLLMCall).toHaveBeenCalled();
    expect(mockEnqueueCostVerificationIfNeeded).toHaveBeenCalled();
    expect(mockCleanupReservationWithoutTokenUsage).not.toHaveBeenCalled();
    expect(mockCleanupReservationOnError).not.toHaveBeenCalled();
    expect(mockGenerateText).toHaveBeenCalled();
  });
});
