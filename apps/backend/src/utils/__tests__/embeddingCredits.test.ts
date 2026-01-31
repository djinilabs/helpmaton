import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockReserveCredits, mockCalculateTokenCost } = vi.hoisted(() => ({
  mockReserveCredits: vi.fn(),
  mockCalculateTokenCost: vi.fn(),
}));

vi.mock("../creditManagement", () => ({
  reserveCredits: mockReserveCredits,
}));

vi.mock("../pricing", () => ({
  calculateTokenCost: mockCalculateTokenCost,
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
      db: {} as never,
      workspaceId: "workspace-123",
      text: "hello",
    });

    expect(mockReserveCredits).toHaveBeenCalledWith(
      {} as never,
      "workspace-123",
      1000,
      3,
      false,
      undefined,
      "openrouter",
      "thenlper/gte-base",
      undefined,
      undefined,
    );
    expect(result.reservationId).toBe("res-1");
    expect(result.estimatedTokens).toBe(2);
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
