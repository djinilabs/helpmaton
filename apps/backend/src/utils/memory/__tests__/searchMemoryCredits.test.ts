import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGenerateEmbeddingWithUsage,
  mockResolveEmbeddingApiKey,
  mockReserveEmbeddingCredits,
  mockAdjustEmbeddingCreditReservation,
  mockRefundEmbeddingCredits,
  mockQuery,
} = vi.hoisted(() => ({
  mockGenerateEmbeddingWithUsage: vi.fn(),
  mockResolveEmbeddingApiKey: vi.fn(),
  mockReserveEmbeddingCredits: vi.fn(),
  mockAdjustEmbeddingCreditReservation: vi.fn(),
  mockRefundEmbeddingCredits: vi.fn(),
  mockQuery: vi.fn(),
}));

vi.mock("../../embedding", () => ({
  generateEmbeddingWithUsage: mockGenerateEmbeddingWithUsage,
  resolveEmbeddingApiKey: mockResolveEmbeddingApiKey,
}));

vi.mock("../../embeddingCredits", () => ({
  reserveEmbeddingCredits: mockReserveEmbeddingCredits,
  adjustEmbeddingCreditReservation: mockAdjustEmbeddingCreditReservation,
  refundEmbeddingCredits: mockRefundEmbeddingCredits,
  EMBEDDING_TOOL_CALLS: {
    memorySearch: "memory-search-embedding",
  },
}));

vi.mock("../../vectordb/readClient", () => ({
  query: mockQuery,
}));

import { searchMemory } from "../searchMemory";

describe("searchMemory credit charging", () => {
  const agentId = "agent-123";
  const workspaceId = "workspace-456";
  const context = {
    addWorkspaceCreditTransaction: vi.fn(),
  };
  const db = {} as never;

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveEmbeddingApiKey.mockResolvedValue({
      apiKey: "test-key",
      usesByok: false,
    });
    mockReserveEmbeddingCredits.mockResolvedValue({
      reservationId: "res-1",
      reservedAmount: 1000,
      workspace: { creditBalance: 5000 },
      estimatedTokens: 5,
    });
    mockGenerateEmbeddingWithUsage.mockResolvedValue({
      embedding: [0.1, 0.2],
      usage: { promptTokens: 10, totalTokens: 10 },
      id: "gen-1",
      fromCache: false,
    });
    mockQuery.mockResolvedValue([
      {
        id: "record-1",
        content: "Test memory",
        timestamp: new Date().toISOString(),
        metadata: {},
        distance: 0.1,
      },
    ]);
  });

  it("reserves and adjusts credits for semantic memory search", async () => {
    const results = await searchMemory({
      agentId,
      workspaceId,
      grain: "working",
      queryText: "find this memory",
      context: context as never,
      db,
    });

    expect(results.length).toBe(1);
    expect(mockReserveEmbeddingCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        text: "find this memory",
        usesByok: false,
        agentId,
      }),
    );
    expect(mockAdjustEmbeddingCreditReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: "res-1",
        workspaceId,
        generationId: "gen-1",
        toolCall: "memory-search-embedding",
      }),
    );
  });

  it("refunds credits when embedding generation fails", async () => {
    mockGenerateEmbeddingWithUsage.mockRejectedValueOnce(
      new Error("embedding error"),
    );

    await searchMemory({
      agentId,
      workspaceId,
      grain: "working",
      queryText: "find this memory",
      context: context as never,
      db,
    });

    expect(mockRefundEmbeddingCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: "res-1",
        workspaceId,
        toolCall: "memory-search-embedding",
      }),
    );
  });
});
