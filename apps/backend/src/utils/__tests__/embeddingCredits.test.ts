import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockReserveCredits,
  mockEnqueueCostVerification,
  mockCalculateTokenCost,
  mockIsSpendingLimitChecksEnabled,
  mockCheckSpendingLimits,
} = vi.hoisted(() => ({
  mockReserveCredits: vi.fn(),
  mockEnqueueCostVerification: vi.fn(),
  mockCalculateTokenCost: vi.fn(),
  mockIsSpendingLimitChecksEnabled: vi.fn(),
  mockCheckSpendingLimits: vi.fn(),
}));

vi.mock("../creditManagement", () => ({
  reserveCredits: mockReserveCredits,
  enqueueCostVerification: mockEnqueueCostVerification,
}));

vi.mock("../pricing", () => ({
  calculateTokenCost: mockCalculateTokenCost,
}));

vi.mock("../featureFlags", () => ({
  isSpendingLimitChecksEnabled: mockIsSpendingLimitChecksEnabled,
}));

vi.mock("../spendingLimits", () => ({
  checkSpendingLimits: mockCheckSpendingLimits,
}));

import {
  adjustEmbeddingCreditReservation,
  calculateEmbeddingCostNanoFromUsage,
  estimateEmbeddingTokens,
  refundEmbeddingCredits,
  reserveEmbeddingCredits,
} from "../embeddingCredits";

describe("embeddingCredits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsSpendingLimitChecksEnabled.mockReturnValue(false);
  });

  it("estimates embedding tokens from text length", () => {
    expect(estimateEmbeddingTokens("abcd")).toBe(1);
    expect(estimateEmbeddingTokens("abcdefgh")).toBe(2);
  });

  it("calculates cost from usage tokens when cost is missing", () => {
    mockCalculateTokenCost.mockReturnValueOnce(456);
    const cost = calculateEmbeddingCostNanoFromUsage({
      promptTokens: 10,
      totalTokens: 10,
    });
    expect(cost).toBe(456);
    expect(mockCalculateTokenCost).toHaveBeenCalled();
  });

  it("reserves credits using estimated token cost", async () => {
    mockCalculateTokenCost.mockReturnValueOnce(1000);
    mockReserveCredits.mockResolvedValueOnce({
      reservationId: "res-1",
      reservedAmount: 1000,
      workspace: { creditBalance: 5000 },
    });

    const result = await reserveEmbeddingCredits({
      db: { workspace: { get: vi.fn() }, agent: { get: vi.fn() } } as never,
      workspaceId: "workspace-123",
      text: "hello",
    });

    expect(mockReserveCredits).toHaveBeenCalledWith(
      expect.anything(),
      "workspace-123",
      1000,
      3,
      undefined,
      undefined,
      "openrouter",
      "thenlper/gte-base",
      undefined,
      undefined,
    );
    expect(result.reservationId).toBe("res-1");
    expect(result.estimatedTokens).toBe(2);
  });

  it("passes BYOK flag to credit reservation", async () => {
    mockCalculateTokenCost.mockReturnValueOnce(2000);
    mockReserveCredits.mockResolvedValueOnce({
      reservationId: "byok",
      reservedAmount: 0,
      workspace: { creditBalance: 5000 },
    });

    await reserveEmbeddingCredits({
      db: { workspace: { get: vi.fn() }, agent: { get: vi.fn() } } as never,
      workspaceId: "workspace-123",
      text: "hello",
      usesByok: true,
    });

    expect(mockReserveCredits).toHaveBeenCalledWith(
      expect.anything(),
      "workspace-123",
      2000,
      3,
      true,
      undefined,
      "openrouter",
      "thenlper/gte-base",
      undefined,
      undefined,
    );
  });

  it("checks spending limits before reserving", async () => {
    mockIsSpendingLimitChecksEnabled.mockReturnValue(true);
    mockCalculateTokenCost.mockReturnValueOnce(1000);
    mockCheckSpendingLimits.mockResolvedValueOnce({
      passed: true,
      failedLimits: [],
    });
    mockReserveCredits.mockResolvedValueOnce({
      reservationId: "res-2",
      reservedAmount: 1000,
      workspace: { creditBalance: 5000 },
    });

    const mockDb = {
      workspace: { get: vi.fn().mockResolvedValue({ pk: "workspaces/ws-1" }) },
      agent: { get: vi.fn().mockResolvedValue({ pk: "agents/ws-1/agent-1" }) },
    };

    await reserveEmbeddingCredits({
      db: mockDb as never,
      workspaceId: "ws-1",
      text: "hello",
      agentId: "agent-1",
    });

    expect(mockCheckSpendingLimits).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({ pk: "workspaces/ws-1" }),
      expect.objectContaining({ pk: "agents/ws-1/agent-1" }),
      0.000001,
    );
  });

  it("adjusts reservation based on usage cost", async () => {
    const mockDb = {
      "credit-reservations": {
        get: vi.fn().mockResolvedValue({ reservedAmount: 1000 }),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    };
    const mockContext = {
      addWorkspaceCreditTransaction: vi.fn(),
    };

    await adjustEmbeddingCreditReservation({
      db: mockDb as never,
      reservationId: "res-1",
      workspaceId: "workspace-123",
      usage: { cost: 0.000002 },
      context: mockContext as never,
      agentId: "agent-123",
      conversationId: "conv-123",
    });

    expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        amountNanoUsd: -1110,
        supplier: "openrouter",
        tool_call: "document-search-embedding",
      }),
    );
    expect(mockDb["credit-reservations"].delete).toHaveBeenCalledWith(
      "credit-reservations/res-1",
    );
    expect(mockCalculateTokenCost).not.toHaveBeenCalled();
  });

  it("queues cost verification when generation id is available", async () => {
    const mockDb = {
      "credit-reservations": {
        get: vi.fn().mockResolvedValue({
          reservedAmount: 1000,
          conversationId: "conv-123",
          agentId: "agent-123",
        }),
        update: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    };
    const mockContext = {
      addWorkspaceCreditTransaction: vi.fn(),
    };

    await adjustEmbeddingCreditReservation({
      db: mockDb as never,
      reservationId: "res-2",
      workspaceId: "workspace-123",
      usage: { cost: 0.000002 },
      generationId: "gen-123",
      context: mockContext as never,
    });

    expect(mockDb["credit-reservations"].update).toHaveBeenCalledWith(
      expect.objectContaining({
        pk: "credit-reservations/res-2",
        openrouterGenerationId: "gen-123",
      }),
    );
    expect(mockEnqueueCostVerification).toHaveBeenCalledWith(
      "gen-123",
      "workspace-123",
      "res-2",
      "conv-123",
      "agent-123",
    );
    expect(mockDb["credit-reservations"].delete).not.toHaveBeenCalled();
  });

  it("refunds reservation on error", async () => {
    const mockDb = {
      "credit-reservations": {
        get: vi.fn().mockResolvedValue({ reservedAmount: 500 }),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    };
    const mockContext = {
      addWorkspaceCreditTransaction: vi.fn(),
    };

    await refundEmbeddingCredits({
      db: mockDb as never,
      reservationId: "res-2",
      workspaceId: "workspace-123",
      context: mockContext as never,
      agentId: "agent-123",
    });

    expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        amountNanoUsd: 500,
        supplier: "openrouter",
        tool_call: "document-search-embedding",
      }),
    );
    expect(mockDb["credit-reservations"].delete).toHaveBeenCalledWith(
      "credit-reservations/res-2",
    );
  });
});
