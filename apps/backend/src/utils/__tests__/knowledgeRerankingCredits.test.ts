import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const {
  mockReserveCredits,
  mockEnqueueCostVerification,
} = vi.hoisted(() => ({
  mockReserveCredits: vi.fn(),
  mockEnqueueCostVerification: vi.fn(),
}));

// Mock credit management
vi.mock("../creditManagement", () => ({
  reserveCredits: mockReserveCredits,
  enqueueCostVerification: mockEnqueueCostVerification,
}));

// Mock pricing
const { mockGetModelPricing } = vi.hoisted(() => ({
  mockGetModelPricing: vi.fn(),
}));

vi.mock("../pricing", () => ({
  getModelPricing: mockGetModelPricing,
}));

// Mock Sentry
vi.mock("../sentry", () => ({
  Sentry: {
    captureException: vi.fn(),
  },
  ensureError: (error: unknown) =>
    error instanceof Error ? error : new Error(String(error)),
}));

// Import after mocks are set up
import type {
  CreditReservationRecord,
  DatabaseSchema,
  WorkspaceRecord,
} from "../../tables/schema";
import {
  reserveRerankingCredits,
  adjustRerankingCreditReservation,
  queueRerankingCostVerification,
  refundRerankingCredits,
} from "../knowledgeRerankingCredits";
import type { AugmentedContext } from "../workspaceCreditContext";

describe("knowledgeRerankingCredits", () => {
  let mockDb: DatabaseSchema;
  let mockWorkspace: WorkspaceRecord;
  let mockGet: ReturnType<typeof vi.fn>;
  let mockDelete: ReturnType<typeof vi.fn>;
  let mockReservationGet: ReturnType<typeof vi.fn>;
  let mockAtomicUpdate: ReturnType<typeof vi.fn>;
  let mockContext: AugmentedContext;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    // Setup mock workspace (creditBalance in millionths)
    mockWorkspace = {
      pk: "workspaces/test-workspace",
      sk: "workspace",
      name: "Test Workspace",
      creditBalance: 100_000_000, // 100.0 USD in millionths
      currency: "usd",
      version: 1,
      createdAt: new Date().toISOString(),
    } as WorkspaceRecord;

    // Setup mock get
    mockGet = vi.fn().mockResolvedValue(mockWorkspace);

    // Setup mock delete
    mockDelete = vi.fn().mockResolvedValue({});

    // Setup mock reservation get
    mockReservationGet = vi.fn();

    // Setup mock atomic update
    mockAtomicUpdate = vi.fn().mockImplementation(async (pk, _sk, callback) => {
      const current = mockReservationGet.mock.results[0]?.value || null;
      const updated = await callback(current);
      return updated;
    });

    // Setup mock database
    mockDb = {
      workspace: {
        get: mockGet,
      },
      "credit-reservations": {
        get: mockReservationGet,
        delete: mockDelete,
        atomicUpdate: mockAtomicUpdate,
      },
    } as unknown as DatabaseSchema;

    // Setup mock context
    mockContext = {
      addWorkspaceCreditTransaction: vi.fn(),
    } as unknown as AugmentedContext;

    // Default mock: no pricing found (uses conservative estimate)
    mockGetModelPricing.mockReturnValue(undefined);
  });

  describe("reserveRerankingCredits", () => {
    it("should reserve credits with default estimate when no pricing found", async () => {
      const reservation = {
        reservationId: "test-reservation-id",
        reservedAmount: 10_550, // $0.01 * 1.055 = 10,550 millionths
        workspace: mockWorkspace,
      };

      mockReserveCredits.mockResolvedValue(reservation);

      const result = await reserveRerankingCredits(
        mockDb,
        "test-workspace",
        "cohere/rerank-v3",
        5, // documentCount
        3, // maxRetries
        mockContext,
        "agent-1",
        "conversation-1",
        false // usesByok
      );

      expect(result).toEqual(reservation);
      expect(mockReserveCredits).toHaveBeenCalledWith(
        mockDb,
        "test-workspace",
        10_550, // estimatedCost (0.01 * 1_000_000 * 1.055)
        3, // maxRetries
        false, // usesByok
        mockContext, // context
        "openrouter", // provider
        "cohere/rerank-v3", // model
        "agent-1", // agentId
        "conversation-1" // conversationId
      );
    });

    it("should use per-request pricing when available", async () => {
      mockGetModelPricing.mockReturnValue({
        usd: {
          request: 0.02, // $0.02 per request
        },
      });

      const reservation = {
        reservationId: "test-reservation-id",
        reservedAmount: 21_100, // $0.02 * 1.055 = 21,100 millionths
        workspace: mockWorkspace,
      };

      mockReserveCredits.mockResolvedValue(reservation);

      const result = await reserveRerankingCredits(
        mockDb,
        "test-workspace",
        "cohere/rerank-v3",
        5, // documentCount
        3, // maxRetries
        mockContext
      );

      expect(result).toEqual(reservation);
      expect(mockReserveCredits).toHaveBeenCalledWith(
        mockDb,
        "test-workspace",
        21_100, // estimatedCost (0.02 * 1_000_000 * 1.055)
        3, // maxRetries
        false, // usesByok
        mockContext, // context
        "openrouter", // provider
        "cohere/rerank-v3", // model
        undefined, // agentId
        undefined // conversationId
      );
    });

    it("should estimate based on document count when no per-request pricing", async () => {
      mockGetModelPricing.mockReturnValue({
        usd: {
          // No request pricing, will use document count estimate
        },
      });

      const reservation = {
        reservationId: "test-reservation-id",
        reservedAmount: 10_550, // Math.max(0.01, 10 * 0.001) * 1.055 = 10,550 millionths
        workspace: mockWorkspace,
      };

      mockReserveCredits.mockResolvedValue(reservation);

      const result = await reserveRerankingCredits(
        mockDb,
        "test-workspace",
        "cohere/rerank-v3",
        10, // documentCount
        3, // maxRetries
        mockContext
      );

      expect(result).toEqual(reservation);
      // Should use minimum of $0.01 since 10 * 0.001 = 0.01
      expect(mockReserveCredits).toHaveBeenCalledWith(
        mockDb,
        "test-workspace",
        10_550, // estimatedCost
        3, // maxRetries
        false, // usesByok
        mockContext, // context
        "openrouter", // provider
        "cohere/rerank-v3", // model
        undefined, // agentId
        undefined // conversationId
      );
    });

    it("should skip reservation when BYOK is enabled", async () => {
      const result = await reserveRerankingCredits(
        mockDb,
        "test-workspace",
        "cohere/rerank-v3",
        5, // documentCount
        3, // maxRetries
        mockContext,
        "agent-1",
        "conversation-1",
        true // usesByok
      );

      expect(result).toEqual({
        reservationId: "byok",
        reservedAmount: 0,
        workspace: mockWorkspace,
      });
      expect(mockReserveCredits).not.toHaveBeenCalled();
      expect(mockGet).toHaveBeenCalledWith(
        "workspaces/test-workspace",
        "workspace"
      );
    });

    it("should throw error when workspace not found (BYOK case)", async () => {
      mockGet.mockResolvedValue(null);

      await expect(
        reserveRerankingCredits(
          mockDb,
          "test-workspace",
          "cohere/rerank-v3",
          5,
          3,
          mockContext,
          undefined,
          undefined,
          true // usesByok
        )
      ).rejects.toThrow("Workspace test-workspace not found");
    });
  });

  describe("adjustRerankingCreditReservation", () => {
    const mockReservation: CreditReservationRecord = {
      pk: "credit-reservations/test-reservation-id",
      workspaceId: "test-workspace",
      reservedAmount: 10_550, // $0.01 * 1.055
      estimatedCost: 10_550,
      currency: "usd",
      expires: Math.floor(Date.now() / 1000) + 15 * 60,
      expiresHour: Math.floor(Date.now() / 1000 / 3600) * 3600,
      version: 1,
      createdAt: new Date().toISOString(),
    };

    beforeEach(() => {
      mockReservationGet.mockResolvedValue(mockReservation);
    });

    it("should adjust credits when provisional cost is higher than reserved", async () => {
      const provisionalCostUsd = 0.015; // $0.015
      const provisionalCost = Math.ceil(0.015 * 1_000_000 * 1.055); // 15,825 millionths
      const difference = provisionalCost - mockReservation.reservedAmount; // 5,275

      await adjustRerankingCreditReservation(
        mockDb,
        "test-reservation-id",
        "test-workspace",
        provisionalCostUsd,
        "gen-123",
        mockContext,
        3, // maxRetries
        "agent-1",
        "conversation-1"
      );

      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "test-workspace",
          agentId: "agent-1",
          conversationId: "conversation-1",
          source: "tool-execution",
          supplier: "openrouter",
          tool_call: "rerank",
          amountMillionthUsd: -difference, // Negative for additional charge
        })
      );

      expect(mockAtomicUpdate).toHaveBeenCalled();
      const updateCallback = mockAtomicUpdate.mock.calls[0][2];
      const updated = await updateCallback(mockReservation);
      expect(updated.openrouterGenerationId).toBe("gen-123");
      expect(updated.provisionalCost).toBe(provisionalCost);
    });

    it("should adjust credits when provisional cost is lower than reserved (refund)", async () => {
      const provisionalCostUsd = 0.005; // $0.005
      const provisionalCost = Math.ceil(0.005 * 1_000_000 * 1.055); // 5,275 millionths
      const difference = provisionalCost - mockReservation.reservedAmount; // -5,275

      await adjustRerankingCreditReservation(
        mockDb,
        "test-reservation-id",
        "test-workspace",
        provisionalCostUsd,
        undefined, // no generationId
        mockContext
      );

      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "test-workspace",
          amountMillionthUsd: -difference, // Positive for refund
        })
      );

      expect(mockAtomicUpdate).not.toHaveBeenCalled(); // No generationId, so no update
    });

    it("should handle no adjustment when provisional cost equals reserved", async () => {
      const provisionalCostUsd = 0.01; // Same as reserved

      await adjustRerankingCreditReservation(
        mockDb,
        "test-reservation-id",
        "test-workspace",
        provisionalCostUsd,
        "gen-123",
        mockContext
      );

      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          amountMillionthUsd: 0, // No adjustment
        })
      );
    });

    it("should skip adjustment when BYOK", async () => {
      await adjustRerankingCreditReservation(
        mockDb,
        "byok",
        "test-workspace",
        0.01,
        "gen-123",
        mockContext
      );

      expect(mockContext.addWorkspaceCreditTransaction).not.toHaveBeenCalled();
      expect(mockReservationGet).not.toHaveBeenCalled();
    });

    it("should create transaction when reservation not found", async () => {
      mockReservationGet.mockResolvedValue(null);

      await adjustRerankingCreditReservation(
        mockDb,
        "non-existent-reservation",
        "test-workspace",
        0.01,
        undefined,
        mockContext
      );

      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "test-workspace",
          amountMillionthUsd: expect.any(Number),
        })
      );
    });

    it("should use reserved amount when provisional cost not provided", async () => {
      await adjustRerankingCreditReservation(
        mockDb,
        "test-reservation-id",
        "test-workspace",
        undefined, // no provisional cost
        "gen-123",
        mockContext
      );

      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          amountMillionthUsd: 0, // No difference
        })
      );
    });

    it("should throw error when workspace not found", async () => {
      mockGet.mockResolvedValue(null);

      await expect(
        adjustRerankingCreditReservation(
          mockDb,
          "test-reservation-id",
          "test-workspace",
          0.01,
          "gen-123",
          mockContext
        )
      ).rejects.toThrow("Workspace test-workspace not found");
    });
  });

  describe("queueRerankingCostVerification", () => {
    it("should queue cost verification", async () => {
      mockEnqueueCostVerification.mockResolvedValue(undefined);

      await queueRerankingCostVerification(
        "test-reservation-id",
        "gen-123",
        "test-workspace",
        "agent-1",
        "conversation-1"
      );

      expect(mockEnqueueCostVerification).toHaveBeenCalledWith(
        "gen-123",
        "test-workspace",
        "test-reservation-id",
        "conversation-1",
        "agent-1"
      );
    });

    it("should skip when BYOK", async () => {
      await queueRerankingCostVerification(
        "byok",
        "gen-123",
        "test-workspace"
      );

      expect(mockEnqueueCostVerification).not.toHaveBeenCalled();
    });

    it("should handle errors gracefully", async () => {
      const error = new Error("Queue error");
      mockEnqueueCostVerification.mockRejectedValue(error);

      // Should not throw
      await expect(
        queueRerankingCostVerification(
          "test-reservation-id",
          "gen-123",
          "test-workspace"
        )
      ).resolves.toBeUndefined();

      expect(mockEnqueueCostVerification).toHaveBeenCalled();
    });
  });

  describe("refundRerankingCredits", () => {
    const mockReservation: CreditReservationRecord = {
      pk: "credit-reservations/test-reservation-id",
      workspaceId: "test-workspace",
      reservedAmount: 10_550,
      estimatedCost: 10_550,
      currency: "usd",
      expires: Math.floor(Date.now() / 1000) + 15 * 60,
      expiresHour: Math.floor(Date.now() / 1000 / 3600) * 3600,
      version: 1,
      createdAt: new Date().toISOString(),
    };

    beforeEach(() => {
      mockReservationGet.mockResolvedValue(mockReservation);
    });

    it("should refund reserved credits", async () => {
      await refundRerankingCredits(
        mockDb,
        "test-reservation-id",
        "test-workspace",
        mockContext,
        3, // maxRetries
        "agent-1",
        "conversation-1"
      );

      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "test-workspace",
          agentId: "agent-1",
          conversationId: "conversation-1",
          source: "tool-execution",
          supplier: "openrouter",
          tool_call: "rerank",
          description: "Re-ranking API call refund (error occurred)",
          amountMillionthUsd: 10_550, // Positive for refund
        })
      );

      expect(mockDelete).toHaveBeenCalledWith(
        "credit-reservations/test-reservation-id"
      );
    });

    it("should skip refund when BYOK", async () => {
      await refundRerankingCredits(
        mockDb,
        "byok",
        "test-workspace",
        mockContext
      );

      expect(mockContext.addWorkspaceCreditTransaction).not.toHaveBeenCalled();
      expect(mockReservationGet).not.toHaveBeenCalled();
    });

    it("should handle reservation not found gracefully", async () => {
      mockReservationGet.mockResolvedValue(null);

      await refundRerankingCredits(
        mockDb,
        "non-existent-reservation",
        "test-workspace",
        mockContext
      );

      expect(mockContext.addWorkspaceCreditTransaction).not.toHaveBeenCalled();
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it("should throw error when workspace not found", async () => {
      mockGet.mockResolvedValue(null);

      await expect(
        refundRerankingCredits(
          mockDb,
          "test-reservation-id",
          "test-workspace",
          mockContext
        )
      ).rejects.toThrow("Workspace test-workspace not found");
    });
  });
});
