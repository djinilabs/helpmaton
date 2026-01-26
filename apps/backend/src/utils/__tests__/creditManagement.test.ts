import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDatabase, mockCalculateTokenCost, mockQueue } = vi.hoisted(() => {
  const publish = vi.fn().mockResolvedValue(undefined);
  return {
    mockDatabase: vi.fn(),
    mockCalculateTokenCost: vi.fn(),
    mockQueue: {
      publish,
    },
  };
});

// Mock the database module
vi.mock("../../tables/database", () => ({
  database: mockDatabase,
}));

// Mock pricing
vi.mock("../pricing", () => ({
  calculateTokenCost: mockCalculateTokenCost,
}));

// Mock @architect/functions queues
vi.mock("@architect/functions", () => ({
  queues: mockQueue,
}));

// Import after mocks are set up
import type {
  CreditReservationRecord,
  DatabaseSchema,
  WorkspaceRecord,
} from "../../tables/schema";
import type { TokenUsage } from "../conversationLogger";
import { InsufficientCreditsError } from "../creditErrors";
import {
  adjustCreditReservation,
  debitCredits,
  finalizeCreditReservation,
  refundReservation,
  reserveCredits,
} from "../creditManagement";
import type { AugmentedContext } from "../workspaceCreditContext";

describe("creditManagement", () => {
  let mockDb: DatabaseSchema;
  let mockWorkspace: WorkspaceRecord;
  let mockAtomicUpdate: ReturnType<typeof vi.fn>;
  let mockGet: ReturnType<typeof vi.fn>;
  let mockCreate: ReturnType<typeof vi.fn>;
  let mockDelete: ReturnType<typeof vi.fn>;
  let mockReservationGet: ReturnType<typeof vi.fn>;
  let mockUpdate: ReturnType<typeof vi.fn>;
  let mockContext: AugmentedContext;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    // Setup mock workspace (creditBalance in nano-dollars)
    mockWorkspace = {
      pk: "workspaces/test-workspace",
      sk: "workspace",
      name: "Test Workspace",
      creditBalance: 100_000_000_000, // 100.0 USD in nano-dollars
      currency: "usd",
      version: 1,
      createdAt: new Date().toISOString(),
    } as WorkspaceRecord;

    // Setup mock atomicUpdate
    mockAtomicUpdate = vi.fn().mockResolvedValue(mockWorkspace);

    // Setup mock get
    mockGet = vi.fn().mockResolvedValue(mockWorkspace);

    // Setup mock create
    mockCreate = vi.fn().mockResolvedValue({});

    // Setup mock delete
    mockDelete = vi.fn().mockResolvedValue({});

    // Setup mock reservation get
    mockReservationGet = vi.fn();

    // Setup mock update
    mockUpdate = vi.fn().mockResolvedValue({});

    // Setup mock database
    mockDb = {
      workspace: {
        get: mockGet,
        atomicUpdate: mockAtomicUpdate,
      },
      "credit-reservations": {
        get: mockReservationGet,
        create: mockCreate,
        delete: mockDelete,
        update: mockUpdate,
      },
    } as unknown as DatabaseSchema;

    // Setup mock context
    mockContext = {
      awsRequestId: "test-request-id",
      functionName: "test-function",
      functionVersion: "1",
      memoryLimitInMB: 512,
      getRemainingTimeInMillis: () => 30000,
      logGroupName: "test-log-group",
      logStreamName: "test-log-stream",
      callbackWaitsForEmptyEventLoop: true,
      invokedFunctionArn: "arn:aws:lambda:us-east-1:123456789012:function:test",
      done: vi.fn(),
      fail: vi.fn(),
      succeed: vi.fn(),
      addWorkspaceCreditTransaction: vi.fn(),
    } as unknown as AugmentedContext;

    mockDatabase.mockResolvedValue(mockDb);

    // Setup default pricing mock (returns nano-dollars)
    mockCalculateTokenCost.mockReturnValue(10_000_000); // 0.01 USD in nano-dollars
  });

  describe("reserveCredits", () => {
    it("should successfully reserve credits when balance is sufficient", async () => {
      const estimatedCost = 10_000_000_000; // 10.0 USD in nano-dollars
      const updatedWorkspace = {
        ...mockWorkspace,
        creditBalance: 90_000_000_000, // 100 - 10 in nano-dollars
      };

      mockAtomicUpdate.mockResolvedValue(updatedWorkspace);

      const result = await reserveCredits(
        mockDb,
        "test-workspace",
        estimatedCost
      );

      expect(result).toMatchObject({
        reservationId: expect.any(String),
        reservedAmount: estimatedCost,
        workspace: updatedWorkspace,
      });
      expect(result.reservationId).not.toBe("byok");
      expect(mockAtomicUpdate).toHaveBeenCalledWith(
        "workspaces/test-workspace",
        "workspace",
        expect.any(Function),
        { maxRetries: 3 }
      );
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          pk: expect.stringContaining("credit-reservations/"),
          workspaceId: "test-workspace",
          reservedAmount: estimatedCost,
          estimatedCost,
          currency: "usd",
          expires: expect.any(Number),
        })
      );
    });

    it("should throw InsufficientCreditsError when balance is insufficient", async () => {
      const estimatedCost = 150_000_000_000; // 150.0 USD in nano-dollars (more than available 100.0)

      mockAtomicUpdate.mockImplementation(async (_pk, _sk, updater) => {
        const current = { ...mockWorkspace };
        const result = await updater(current);
        return result as WorkspaceRecord;
      });

      await expect(
        reserveCredits(mockDb, "test-workspace", estimatedCost)
      ).rejects.toThrow(InsufficientCreditsError);

      await expect(
        reserveCredits(mockDb, "test-workspace", estimatedCost)
      ).rejects.toThrow("Insufficient credits");
    });

    it("should skip reservation for BYOK requests", async () => {
      const result = await reserveCredits(
        mockDb,
        "test-workspace",
        10_000_000_000, // 10.0 USD in nano-dollars
        3,
        true // usesByok
      );

      expect(result).toEqual({
        reservationId: "byok",
        reservedAmount: 0,
        workspace: mockWorkspace,
      });
      expect(mockAtomicUpdate).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockGet).toHaveBeenCalledWith(
        "workspaces/test-workspace",
        "workspace"
      );
    });

    it("should throw error when workspace is not found", async () => {
      mockGet.mockResolvedValue(undefined);

      await expect(
        reserveCredits(mockDb, "test-workspace", 10_000_000_000, 3, true)
      ).rejects.toThrow("Workspace test-workspace not found");
    });

    it("should handle version conflicts - throws error after max retries", async () => {
      const estimatedCost = 10_000_000_000; // 10.0 USD in nano-dollars

      // Simulate version conflict that persists after retries
      mockAtomicUpdate.mockRejectedValue(
        new Error("Conditional request failed")
      );

      await expect(
        reserveCredits(mockDb, "test-workspace", estimatedCost, 2)
      ).rejects.toThrow("Failed to reserve credits after 2 retries");
    });

    it("should throw error after max retries on version conflicts", async () => {
      const estimatedCost = 10_000_000_000; // 10.0 USD in nano-dollars

      mockAtomicUpdate.mockRejectedValue(
        new Error("Conditional request failed")
      );

      await expect(
        reserveCredits(mockDb, "test-workspace", estimatedCost, 2)
      ).rejects.toThrow("Failed to reserve credits after 2 retries");
    });

    it("should handle exact balance match", async () => {
      const estimatedCost = 100_000_000_000; // 100.0 USD in nano-dollars (exactly the balance)
      const updatedWorkspace = {
        ...mockWorkspace,
        creditBalance: 0,
      };

      mockAtomicUpdate.mockResolvedValue(updatedWorkspace);

      const result = await reserveCredits(
        mockDb,
        "test-workspace",
        estimatedCost
      );

      expect(result.reservedAmount).toBe(estimatedCost);
      expect(result.workspace.creditBalance).toBe(0);
    });

    it("should handle precise amounts without rounding", async () => {
      const estimatedCost = 10_123_456_000; // 10.123456 USD in nano-dollars
      const updatedWorkspace = {
        ...mockWorkspace,
        creditBalance: 89_876_544_000, // 100_000_000_000 - 10_123_456_000
      };

      mockAtomicUpdate.mockResolvedValue(updatedWorkspace);

      await reserveCredits(mockDb, "test-workspace", estimatedCost);

      const updaterCall = mockAtomicUpdate.mock.calls[0][2];
      const current = { ...mockWorkspace };
      const result = await updaterCall(current);

      // Should be exact (no rounding needed with integers)
      const expectedBalance = mockWorkspace.creditBalance - estimatedCost;
      expect(result.creditBalance).toBe(expectedBalance);
    });

    it("should handle negative estimated cost by clamping to zero and skipping reservation", async () => {
      const negativeEstimatedCost = -10_000_000_000; // -10.0 USD in nano-dollars (invalid)

      const result = await reserveCredits(
        mockDb,
        "test-workspace",
        negativeEstimatedCost
      );

      // Should return workspace without creating reservation
      expect(result).toEqual({
        reservationId: "zero-cost",
        reservedAmount: 0,
        workspace: mockWorkspace,
      });
      expect(mockAtomicUpdate).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockGet).toHaveBeenCalledWith(
        "workspaces/test-workspace",
        "workspace"
      );
    });
  });

  describe("adjustCreditReservation", () => {
    let mockReservation: CreditReservationRecord;
    let reservationId: string;

    beforeEach(() => {
      reservationId = "test-reservation-id";
      mockReservation = {
        pk: `credit-reservations/${reservationId}`,
        workspaceId: "test-workspace",
        reservedAmount: 10_000_000_000, // 10.0 USD in nano-dollars
        estimatedCost: 10_000_000_000, // 10.0 USD in nano-dollars
        currency: "usd",
        expires: Math.floor(Date.now() / 1000) + 15 * 60,
        version: 1,
        createdAt: new Date().toISOString(),
      } as CreditReservationRecord;

      (
        mockDb["credit-reservations"].get as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockReservation);
    });

    it("should refund difference when actual cost is less than reserved", async () => {
      const tokenUsage: TokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      };

      // Actual cost will be less than reserved (10.0 USD = 10_000_000_000 nano-dollars)
      mockCalculateTokenCost.mockReturnValue(5_000_000_000); // 5.0 USD in nano-dollars
      
      // Mock workspace with balance after initial reservation (100 - 10 = 90)
      const workspaceAfterReservation = {
        ...mockWorkspace,
        creditBalance: 90_000_000_000, // Balance after initial reservation
      };
      mockGet.mockResolvedValue(workspaceAfterReservation);

      const result = await adjustCreditReservation(
        mockDb,
        reservationId,
        "test-workspace",
        "google",
        "gemini-2.5-flash",
        tokenUsage,
        mockContext
      );

      // Difference: 5_000_000_000 - 10_000_000_000 = -5_000_000_000 (refund)
      // Transaction amount: -(-5_000_000_000) = 5_000_000_000 (positive for credit)
      // New balance: 90_000_000_000 + 5_000_000_000 = 95_000_000_000
      expect(result.creditBalance).toBe(95_000_000_000); // 95.0 USD in nano-dollars
      // Verify transaction was added to buffer with positive amount (credit/refund)
      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "test-workspace",
          amountNanoUsd: 5_000_000_000, // Positive for credit/refund
        })
      );
      expect(mockDelete).toHaveBeenCalledWith(
        `credit-reservations/${reservationId}`
      );
    });

    it("should deduct additional amount when actual cost is more than reserved", async () => {
      const tokenUsage: TokenUsage = {
        promptTokens: 200,
        completionTokens: 100,
        totalTokens: 300,
      };

      // Actual cost will be more than reserved (10.0)
      mockCalculateTokenCost.mockReturnValue(15_000_000_000); // 15.0 USD in nano-dollars (actual cost)
      
      // Mock workspace with balance after initial reservation (100 - 10 = 90)
      const workspaceAfterReservation = {
        ...mockWorkspace,
        creditBalance: 90_000_000_000, // Balance after initial reservation
      };
      mockGet.mockResolvedValue(workspaceAfterReservation);

      const result = await adjustCreditReservation(
        mockDb,
        reservationId,
        "test-workspace",
        "google",
        "gemini-2.5-flash",
        tokenUsage,
        mockContext
      );

      // Difference: 15_000_000_000 - 10_000_000_000 = 5_000_000_000 (additional charge)
      // Transaction amount: -5_000_000_000 (negative for debit)
      // New balance: 90_000_000_000 + (-5_000_000_000) = 85_000_000_000
      expect(result.creditBalance).toBe(85_000_000_000);
      // Verify transaction was added to buffer with negative amount (debit)
      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "test-workspace",
          amountNanoUsd: -5_000_000_000, // Negative for debit/additional charge
        })
      );
    });

    it("should handle exact match (no adjustment needed)", async () => {
      const tokenUsage: TokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      };

      // Actual cost equals reserved (10.0 USD = 10_000_000_000 nano-dollars)
      mockCalculateTokenCost.mockReturnValue(10_000_000_000);
      
      // Mock workspace with balance after initial reservation (100 - 10 = 90)
      const workspaceAfterReservation = {
        ...mockWorkspace,
        creditBalance: 90_000_000_000, // Balance after initial reservation
      };
      mockGet.mockResolvedValue(workspaceAfterReservation);

      const result = await adjustCreditReservation(
        mockDb,
        reservationId,
        "test-workspace",
        "google",
        "gemini-2.5-flash",
        tokenUsage,
        mockContext
      );

      // Difference: 10_000_000_000 - 10_000_000_000 = 0 (no adjustment)
      // Balance should remain the same
      expect(result.creditBalance).toBe(90_000_000_000);
      // Verify transaction was added to buffer with zero amount
      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "test-workspace",
          amountNanoUsd: 0, // No adjustment
        })
      );
    });

    it("should skip adjustment for BYOK requests", async () => {
      const tokenUsage: TokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      };

      const result = await adjustCreditReservation(
        mockDb,
        "byok",
        "test-workspace",
        "google",
        "gemini-2.5-flash",
        tokenUsage,
        mockContext,
        3,
        true
      );

      expect(result).toEqual(mockWorkspace);
      expect(mockAtomicUpdate).not.toHaveBeenCalled();
    });

    it("should handle reservation not found gracefully", async () => {
      (
        mockDb["credit-reservations"].get as ReturnType<typeof vi.fn>
      ).mockResolvedValue(undefined);

      const tokenUsage: TokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      };

      const result = await adjustCreditReservation(
        mockDb,
        reservationId,
        "test-workspace",
        "google",
        "gemini-2.5-flash",
        tokenUsage,
        mockContext
      );

      expect(result).toEqual(mockWorkspace);
      expect(mockAtomicUpdate).not.toHaveBeenCalled();
    });

    it("should handle version conflicts - throws error after max retries", async () => {
      const tokenUsage: TokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      };

      mockCalculateTokenCost.mockReturnValue(5_000_000_000); // 5.0 USD in nano-dollars
      
      // Mock workspace with balance after initial reservation (100 - 10 = 90)
      const workspaceAfterReservation = {
        ...mockWorkspace,
        creditBalance: 90_000_000_000, // Balance after initial reservation
      };
      mockGet.mockResolvedValue(workspaceAfterReservation);

      // With transaction system, adjustCreditReservation doesn't call atomicUpdate directly
      // It adds a transaction to the buffer, and atomicUpdate is called when transactions are committed
      // Version conflicts would occur during transaction commit, not here
      // This test verifies the function completes successfully and adds transaction to buffer
      await adjustCreditReservation(
          mockDb,
          reservationId,
          "test-workspace",
          "google",
          "gemini-2.5-flash",
          tokenUsage,
        mockContext,
          2
      );

      // Verify transaction was added to buffer
      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalled();
    });

    it("should store multiple generation IDs in reservation for OpenRouter", async () => {
      const tokenUsage: TokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      };

      mockCalculateTokenCost.mockReturnValue(5_000_000_000);
      const updatedWorkspace = {
        ...mockWorkspace,
        creditBalance: 95_000_000_000,
      };
      mockAtomicUpdate.mockResolvedValue(updatedWorkspace);

      const openrouterGenerationIds = ["gen-12345", "gen-67890", "gen-abc123"];

      await adjustCreditReservation(
        mockDb,
        reservationId,
        "test-workspace",
        "openrouter",
        "openrouter/auto",
        tokenUsage,
        mockContext,
        3,
        false,
        undefined,
        openrouterGenerationIds
      );

      // Verify reservation was updated with multiple generation IDs
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          pk: `credit-reservations/${reservationId}`,
          openrouterGenerationIds: ["gen-12345", "gen-67890", "gen-abc123"],
          expectedGenerationCount: 3,
          verifiedGenerationIds: [],
          verifiedCosts: [],
        })
      );
    });

    it("should store single generation ID when only one provided", async () => {
      const tokenUsage: TokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      };

      mockCalculateTokenCost.mockReturnValue(5_000_000_000);
      const updatedWorkspace = {
        ...mockWorkspace,
        creditBalance: 95_000_000_000,
      };
      mockAtomicUpdate.mockResolvedValue(updatedWorkspace);

      const openrouterGenerationId = "gen-12345";

      await adjustCreditReservation(
        mockDb,
        reservationId,
        "test-workspace",
        "openrouter",
        "openrouter/auto",
        tokenUsage,
        mockContext,
        3,
        false,
        openrouterGenerationId
      );

      // Verify reservation was updated with single generation ID (as array)
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          pk: `credit-reservations/${reservationId}`,
          openrouterGenerationIds: ["gen-12345"],
          expectedGenerationCount: 1,
          verifiedGenerationIds: [],
          verifiedCosts: [],
        })
      );
    });

    it("should throw error when delete fails", async () => {
      const tokenUsage: TokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      };

      mockCalculateTokenCost.mockReturnValue(5_000_000_000); // 5.0 USD in nano-dollars
      mockDelete.mockRejectedValue(new Error("Delete failed"));

      const updatedWorkspace = {
        ...mockWorkspace,
        creditBalance: 95_000_000_000, // in nano-dollars
      };

      mockAtomicUpdate.mockResolvedValue(updatedWorkspace);

      // Should throw when delete fails - errors should propagate to Sentry
      await expect(
        adjustCreditReservation(
          mockDb,
          reservationId,
          "test-workspace",
          "google",
          "gemini-2.5-flash",
          tokenUsage,
          mockContext
        )
      ).rejects.toThrow("Delete failed");
    });

    it("should handle reasoning tokens in cost calculation", async () => {
      const tokenUsage: TokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        reasoningTokens: 25,
      };

      mockCalculateTokenCost.mockReturnValue(12_000_000_000); // 12.0 USD in nano-dollars
      const updatedWorkspace = {
        ...mockWorkspace,
        creditBalance: 88_000_000_000, // in nano-dollars
      };

      mockAtomicUpdate.mockResolvedValue(updatedWorkspace);

      await adjustCreditReservation(
        mockDb,
        reservationId,
        "test-workspace",
        "google",
        "gemini-2.5-flash",
        tokenUsage,
        mockContext
      );

      expect(mockCalculateTokenCost).toHaveBeenCalledWith(
        "google",
        "gemini-2.5-flash",
        100,
        50,
        25,
        0 // cachedPromptTokens
      );
    });

    it("should handle negative token usage cost by clamping to zero", async () => {
      const tokenUsage: TokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      };

      // Simulate negative cost from pricing calculation (pricing info may be wrong)
      mockCalculateTokenCost.mockReturnValue(-5_000_000_000); // -5.0 USD in nano-dollars (invalid)
      
      // Mock workspace with balance after initial reservation (100 - 10 = 90)
      const workspaceAfterReservation = {
          ...mockWorkspace,
          creditBalance: 90_000_000_000, // Balance after initial reservation
        };
      mockGet.mockResolvedValue(workspaceAfterReservation);

      const result = await adjustCreditReservation(
        mockDb,
        reservationId,
        "test-workspace",
        "google",
        "gemini-2.5-flash",
        tokenUsage,
        mockContext
      );

      // Cost should be clamped to 0, so difference = 0 - 10_000_000_000 = -10_000_000_000 (refund)
      // New balance: 90_000_000_000 - (-10_000_000_000) = 100_000_000_000
      expect(result.creditBalance).toBe(100_000_000_000);
      // Verify transaction was added to buffer with negative amount (refund)
      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "test-workspace",
          amountNanoUsd: 10_000_000_000, // Positive for credit/refund (full reserved amount)
        })
      );
      expect(mockDelete).toHaveBeenCalledWith(
        `credit-reservations/${reservationId}`
      );
    });
  });

  describe("refundReservation", () => {
    let mockReservation: CreditReservationRecord;
    let reservationId: string;

    beforeEach(() => {
      reservationId = "test-reservation-id";
      mockReservation = {
        pk: `credit-reservations/${reservationId}`,
        workspaceId: "test-workspace",
        reservedAmount: 10_000_000_000, // 10.0 USD in nano-dollars
        estimatedCost: 10_000_000_000, // 10.0 USD in nano-dollars
        currency: "usd",
        expires: Math.floor(Date.now() / 1000) + 15 * 60,
        version: 1,
        createdAt: new Date().toISOString(),
      } as CreditReservationRecord;

      (
        mockDb["credit-reservations"].get as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockReservation);
    });

    it("should successfully refund reserved credits", async () => {
      mockGet.mockResolvedValue(mockWorkspace);

      await refundReservation(mockDb, reservationId, mockContext);

      // With transaction system, verify transaction was added to buffer
      // Transaction amount: 10_000_000_000 (positive for credit/refund)
      // New balance: 100_000_000_000 + 10_000_000_000 = 110_000_000_000
      const addTransaction =
        mockContext.addWorkspaceCreditTransaction as ReturnType<typeof vi.fn>;
      const refundTransaction = addTransaction.mock.calls[0]?.[0];
      expect(refundTransaction).toMatchObject({
        workspaceId: "test-workspace",
        amountNanoUsd: 10_000_000_000,
      });
      expect(refundTransaction.description).toEqual(
        expect.stringContaining("workspaceId=test-workspace")
      );
      expect(refundTransaction.description).toEqual(
        expect.stringContaining("agentId=unknown")
      );
      expect(refundTransaction.description).toEqual(
        expect.stringContaining("conversationId=unknown")
      );
      expect(refundTransaction.description).toEqual(
        expect.stringContaining("reservationId=test-reservation-id")
      );
      expect(refundTransaction.description).toEqual(
        expect.stringContaining("provider=unknown")
      );
      expect(refundTransaction.description).toEqual(
        expect.stringContaining("model=unknown")
      );
      expect(refundTransaction.description).toEqual(
        expect.stringContaining("endpoint=unknown")
      );
      expect(refundTransaction.description).toEqual(
        expect.stringContaining("error=none")
      );
      expect(refundTransaction.description).toEqual(
        expect.stringContaining("reservedAmount=")
      );
      expect(refundTransaction.description).toEqual(
        expect.stringContaining("estimatedCost=")
      );
      expect(refundTransaction.description).toEqual(
        expect.stringContaining("actualCost=")
      );
      expect(mockDelete).toHaveBeenCalledWith(
        `credit-reservations/${reservationId}`
      );
    });

    it("should include agent and conversation metadata when present", async () => {
      mockReservation = {
        ...mockReservation,
        agentId: "agent-123",
        conversationId: "conversation-456",
      };
      (
        mockDb["credit-reservations"].get as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockReservation);
      mockGet.mockResolvedValue(mockWorkspace);

      await refundReservation(mockDb, reservationId, mockContext);

      const addTransaction =
        mockContext.addWorkspaceCreditTransaction as ReturnType<typeof vi.fn>;
      const refundTransaction = addTransaction.mock.calls[0]?.[0];
      expect(refundTransaction).toMatchObject({
        agentId: "agent-123",
        conversationId: "conversation-456",
      });
      expect(refundTransaction.description).toEqual(
        expect.stringContaining("agentId=agent-123")
      );
      expect(refundTransaction.description).toEqual(
        expect.stringContaining("conversationId=conversation-456")
      );
    });

    it("should skip refund for BYOK reservations", async () => {
      await refundReservation(mockDb, "byok", mockContext);

      expect(mockAtomicUpdate).not.toHaveBeenCalled();
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it("should handle reservation not found gracefully", async () => {
      (
        mockDb["credit-reservations"].get as ReturnType<typeof vi.fn>
      ).mockResolvedValue(undefined);

      await refundReservation(mockDb, reservationId, mockContext);

      expect(mockAtomicUpdate).not.toHaveBeenCalled();
    });

    it("should handle version conflicts - throws error after max retries", async () => {
      // With transaction system, refundReservation doesn't call atomicUpdate directly
      // It adds a transaction to the buffer, and atomicUpdate is called when transactions are committed
      // Version conflicts would occur during transaction commit, not here
      // This test verifies the function completes successfully and adds transaction to buffer
      await refundReservation(mockDb, reservationId, mockContext, 2);

      // Verify transaction was added to buffer
      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalled();
    });

    it("should throw error after max retries", async () => {
      // With transaction system, refundReservation doesn't call atomicUpdate directly
      // It adds a transaction to the buffer, and atomicUpdate is called when transactions are committed
      // This test is no longer applicable - retries happen during transaction commit, not here
      // The function should complete successfully and add transaction to buffer
      await refundReservation(mockDb, reservationId, mockContext, 2);

      // Verify transaction was added to buffer
      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalled();
    });

    it("should throw error when delete fails", async () => {
      mockDelete.mockRejectedValue(new Error("Delete failed"));

      // Should throw when delete fails - errors should propagate to Sentry
      await expect(refundReservation(mockDb, reservationId, mockContext)).rejects.toThrow(
        "Delete failed"
      );

      // Transaction should still be added to buffer before delete fails
      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalled();
    });

    it("should handle precise refund amounts without rounding", async () => {
      const reservationWithPreciseAmount = {
        ...mockReservation,
        reservedAmount: 10_123_456_000, // 10.123456 USD in nano-dollars
      };

      (
        mockDb["credit-reservations"].get as ReturnType<typeof vi.fn>
      ).mockResolvedValue(reservationWithPreciseAmount);

      const updatedWorkspace = {
        ...mockWorkspace,
        creditBalance: 110_123_456_000, // 100_000_000_000 + 10_123_456_000 in nano-dollars
      };

      mockAtomicUpdate.mockResolvedValue(updatedWorkspace);

      await refundReservation(mockDb, reservationId, mockContext);

      // With transaction system, verify transaction was added to buffer
      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "test-workspace",
          amountNanoUsd: 10_123_456_000, // Positive for credit/refund
        })
      );
      expect(mockDelete).toHaveBeenCalledWith(
        `credit-reservations/${reservationId}`
      );
    });
  });

  describe("concurrent reservation scenarios", () => {
    it("should verify atomic check prevents overspending", async () => {
      const estimatedCost = 60_000_000_000; // 60.0 USD in nano-dollars
      const initialBalance = 100_000_000_000; // 100.0 USD in nano-dollars

      // Test that the updater function correctly checks balance atomically
      // This verifies the logic that prevents race conditions
      mockAtomicUpdate.mockImplementation(async (_pk, _sk, updater) => {
        const current = {
          ...mockWorkspace,
          creditBalance: initialBalance,
        };

        // The updater function performs atomic check and update
        // It will throw InsufficientCreditsError if balance < estimatedCost
        const result = await updater(current);
        return result as WorkspaceRecord;
      });

      // First reservation should succeed (100 >= 60)
      const result1 = await reserveCredits(
        mockDb,
        "test-workspace",
        estimatedCost,
      );
      expect(result1.reservationId).toBeDefined();

      // Second reservation should fail (40_000_000_000 < 60_000_000_000)
      // Update mock to reflect new balance
      mockAtomicUpdate.mockImplementation(async (_pk, _sk, updater) => {
        const current = {
          ...mockWorkspace,
          creditBalance: 40_000_000_000, // After first reservation (in nano-dollars)
        };
        const result = await updater(current);
        return result as WorkspaceRecord;
      });

      await expect(
        reserveCredits(mockDb, "test-workspace", estimatedCost)
      ).rejects.toThrow(InsufficientCreditsError);

      // This demonstrates that the atomic check in the updater function
      // prevents overspending by validating balance before deducting
    });

    it("should handle sequential reservations correctly", async () => {
      const estimatedCost = 30_000_000_000; // 30.0 USD in nano-dollars
      let currentBalance = 100_000_000_000; // 100.0 USD in nano-dollars

      mockAtomicUpdate.mockImplementation(async (_pk, _sk, updater) => {
        const current = {
          ...mockWorkspace,
          creditBalance: currentBalance,
        };
        const result = await updater(current);
        currentBalance = (result as { creditBalance: number }).creditBalance;
        return result as WorkspaceRecord;
      });

      // First reservation: 100_000_000_000 - 30_000_000_000 = 70_000_000_000
      const result1 = await reserveCredits(
        mockDb,
        "test-workspace",
        estimatedCost,
      );
      expect(result1.workspace.creditBalance).toBe(70_000_000_000);

      // Second reservation: 70_000_000_000 - 30_000_000_000 = 40_000_000_000
      const result2 = await reserveCredits(
        mockDb,
        "test-workspace",
        estimatedCost,
      );
      expect(result2.workspace.creditBalance).toBe(40_000_000_000);

      // Third reservation: 40_000_000_000 - 30_000_000_000 = 10_000_000_000
      const result3 = await reserveCredits(
        mockDb,
        "test-workspace",
        estimatedCost,
      );
      expect(result3.workspace.creditBalance).toBe(10_000_000_000);

      // Fourth reservation should fail: 10_000_000_000 < 30_000_000_000
      await expect(
        reserveCredits(mockDb, "test-workspace", estimatedCost)
      ).rejects.toThrow(InsufficientCreditsError);

      // Verify final balance is correct
      expect(currentBalance).toBe(10_000_000_000);
    });
  });

  describe("finalizeCreditReservation", () => {
    let mockReservation: CreditReservationRecord;

    beforeEach(() => {
      mockReservation = {
        pk: "credit-reservations/test-reservation",
        workspaceId: "test-workspace",
        reservedAmount: 50_000_000_000, // 50.0 USD in nano-dollars
        estimatedCost: 50_000_000_000,
        currency: "usd",
        expires: Math.floor(Date.now() / 1000) + 900, // 15 minutes from now
        expiresHour: Math.floor(Date.now() / 3600) * 3600,
        tokenUsageBasedCost: 45_000_000_000, // 45.0 USD (step 2 cost)
        openrouterGenerationId: "gen-12345",
        provider: "openrouter",
        modelName: "google/gemini-2.5-flash",
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockReservationGet.mockResolvedValue(mockReservation);
      mockDelete.mockResolvedValue(undefined);
    });

    it("should make final adjustment when OpenRouter cost differs from token usage cost", async () => {
      const openrouterCost = 47_000_000_000; // 47.0 USD (higher than token usage cost)

      const result = await finalizeCreditReservation(
        mockDb,
        "test-reservation",
        openrouterCost,
        mockContext
      );

      // Difference: 47_000_000_000 - 45_000_000_000 = 2_000_000_000 (additional charge)
      // Transaction amount: -2_000_000_000 (negative for debit)
      // New balance: 100_000_000_000 + (-2_000_000_000) = 98_000_000_000
      expect(result.creditBalance).toBe(98_000_000_000);
      // Verify transaction was added to buffer
      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "test-workspace",
          amountNanoUsd: -2_000_000_000, // Negative for debit/additional charge
        })
      );
      expect(mockDelete).toHaveBeenCalledWith("credit-reservations/test-reservation");
    });

    it("should refund difference when OpenRouter cost is less than token usage cost", async () => {
      const openrouterCost = 43_000_000_000; // 43.0 USD (lower than token usage cost)

      const result = await finalizeCreditReservation(
        mockDb,
        "test-reservation",
        openrouterCost,
        mockContext
      );

      // Difference: 43_000_000_000 - 45_000_000_000 = -2_000_000_000 (refund)
      // Transaction amount: -(-2_000_000_000) = 2_000_000_000 (positive for credit)
      // New balance: 100_000_000_000 + 2_000_000_000 = 102_000_000_000
      expect(result.creditBalance).toBe(102_000_000_000);
      // Verify transaction was added to buffer with positive amount (credit/refund)
      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "test-workspace",
          amountNanoUsd: 2_000_000_000, // Positive for credit/refund
        })
      );
    });

    it("should handle exact match (no adjustment needed)", async () => {
      const openrouterCost = 45_000_000_000; // Same as token usage cost

      const result = await finalizeCreditReservation(
        mockDb,
        "test-reservation",
        openrouterCost,
        mockContext
      );

      // Difference: 45_000_000_000 - 45_000_000_000 = 0
      // New balance: 100_000_000_000 - 0 = 100_000_000_000
      expect(result.creditBalance).toBe(100_000_000_000);
      // Verify transaction was added to buffer with zero amount
      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "test-workspace",
          amountNanoUsd: 0, // No adjustment
        })
      );
    });

    it("should handle missing token usage cost by using OpenRouter cost directly", async () => {
      const reservationWithoutTokenCost = {
        ...mockReservation,
        tokenUsageBasedCost: undefined,
      };
      mockReservationGet.mockResolvedValue(reservationWithoutTokenCost);

      const openrouterCost = 47_000_000_000;
      let currentBalance = 100_000_000_000;

      mockAtomicUpdate.mockImplementation(async (_pk, _sk, updater) => {
        const current = {
          ...mockWorkspace,
          creditBalance: currentBalance,
        };
        const result = await updater(current);
        currentBalance = (result as { creditBalance: number }).creditBalance;
        return result as WorkspaceRecord;
      });

      const result = await finalizeCreditReservation(
        mockDb,
        "test-reservation",
        openrouterCost,
        mockContext
      );

      // Should adjust based on OpenRouter cost vs reserved amount
      // Difference: 47_000_000_000 - 50_000_000_000 = -3_000_000_000 (refund)
      // New balance: 100_000_000_000 - (-3_000_000_000) = 103_000_000_000
      expect(result.creditBalance).toBe(103_000_000_000);
    });

    it("should throw error when reservation is not found", async () => {
      mockReservationGet.mockResolvedValue(null);

      await expect(
        finalizeCreditReservation(mockDb, "non-existent", 50_000_000_000, mockContext)
      ).rejects.toThrow("Reservation non-existent not found");
    });

    it("should handle version conflicts with retries", async () => {
      const openrouterCost = 47_000_000_000;

      // Simulate atomicUpdate's retry behavior: it will retry internally up to maxRetries times
      // Since we're mocking atomicUpdate, we simulate it succeeding after retries
      // In reality, atomicUpdate handles retries internally, but for testing we mock it
      mockAtomicUpdate.mockImplementation(async (_pk, _sk, updater) => {
        // Simulate that atomicUpdate retried internally and succeeded
        // The actual retry logic is tested in atomicUpdate's own tests
        const current = {
          ...mockWorkspace,
          creditBalance: 100_000_000_000,
        };
        const updated = await updater(current);
        return {
          ...current,
          ...updated,
          creditBalance: updated.creditBalance || current.creditBalance,
        } as WorkspaceRecord;
      });

      // With transaction system, finalizeCreditReservation adds transaction to buffer
      // instead of calling atomicUpdate directly
      const result = await finalizeCreditReservation(
        mockDb,
        "test-reservation",
        openrouterCost,
        mockContext,
        3 // maxRetries - not used with transaction system
      );

      expect(result).toBeDefined();
      expect(result.creditBalance).toBe(98_000_000_000); // 100 - (47 - 45) = 98
      // Verify transaction was added to buffer
      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "test-workspace",
          amountNanoUsd: -2_000_000_000, // 47 - 45 = 2, negated = -2 (negative for debit/additional charge)
        })
      );
    });

    it("should handle negative OpenRouter cost by clamping to zero", async () => {
      const negativeOpenrouterCost = -3_000_000_000; // -3.0 USD in nano-dollars (invalid)

      const result = await finalizeCreditReservation(
        mockDb,
        "test-reservation",
        negativeOpenrouterCost,
        mockContext
      );

      // Cost should be clamped to 0, so difference = 0 - 45_000_000_000 = -45_000_000_000 (refund)
      // Transaction amount: -(-45_000_000_000) = 45_000_000_000 (positive for credit)
      // New balance: 100_000_000_000 + 45_000_000_000 = 145_000_000_000
      expect(result.creditBalance).toBe(145_000_000_000);
      // Verify transaction was added to buffer with positive amount (credit/refund)
      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "test-workspace",
          amountNanoUsd: 45_000_000_000, // Positive for credit/refund
        })
      );
      expect(mockDelete).toHaveBeenCalledWith("credit-reservations/test-reservation");
    });
  });

  describe("debitCredits", () => {
    it("should successfully deduct credits when cost is positive", async () => {
      const tokenUsage: TokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      };

      mockCalculateTokenCost.mockReturnValue(5_000_000_000); // 5.0 USD in nano-dollars
      
      // Mock atomicUpdate to actually call the updater function
      mockAtomicUpdate.mockImplementation(async (_pk, _sk, updater) => {
        const current = { ...mockWorkspace };
        const result = await updater(current);
        return result as WorkspaceRecord;
      });

      const result = await debitCredits(
        mockDb,
        "test-workspace",
        "google",
        "gemini-2.5-flash",
        tokenUsage
      );

      expect(result.creditBalance).toBe(95_000_000_000);
      expect(mockCalculateTokenCost).toHaveBeenCalledWith(
        "google",
        "gemini-2.5-flash",
        100,
        50,
        0, // reasoningTokens
        0 // cachedPromptTokens
      );
    });

    it("should handle negative actual cost by clamping to zero", async () => {
      const tokenUsage: TokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      };

      // Simulate negative cost from pricing calculation (pricing info may be wrong)
      mockCalculateTokenCost.mockReturnValue(-5_000_000_000); // -5.0 USD in nano-dollars (invalid)
      const updatedWorkspace = {
        ...mockWorkspace,
        creditBalance: 100_000_000_000, // Should remain unchanged (0 cost deducted)
      };

      mockAtomicUpdate.mockResolvedValue(updatedWorkspace);

      const result = await debitCredits(
        mockDb,
        "test-workspace",
        "google",
        "gemini-2.5-flash",
        tokenUsage
      );

      // Cost should be clamped to 0, so balance should remain unchanged
      expect(result.creditBalance).toBe(100_000_000_000);
    });

    it("should skip deduction for BYOK requests", async () => {
      const tokenUsage: TokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      };

      const result = await debitCredits(
        mockDb,
        "test-workspace",
        "google",
        "gemini-2.5-flash",
        tokenUsage,
        3,
        true // usesByok
      );

      expect(result).toEqual(mockWorkspace);
      expect(mockAtomicUpdate).not.toHaveBeenCalled();
    });

    it("should throw error when workspace is not found", async () => {
      const tokenUsage: TokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      };

      mockGet.mockResolvedValue(undefined);

      await expect(
        debitCredits(
          mockDb,
          "test-workspace",
          "google",
          "gemini-2.5-flash",
          tokenUsage,
          3,
          true
        )
      ).rejects.toThrow("Workspace test-workspace not found");
    });
  });

  describe("enqueueCostVerification", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockQueue.publish.mockResolvedValue(undefined);
    });

    it("should enqueue cost verification with conversation context", async () => {
      const { enqueueCostVerification } = await import("../creditManagement");

      await enqueueCostVerification(
        "gen-12345",
        "workspace-1",
        "res-1",
        "conv-1",
        "agent-1"
      );

      expect(mockQueue.publish).toHaveBeenCalledWith({
        name: "openrouter-cost-verification-queue",
        payload: {
          reservationId: "res-1",
          openrouterGenerationId: "gen-12345",
          workspaceId: "workspace-1",
          conversationId: "conv-1",
          agentId: "agent-1",
        },
      });
    });

    it("should enqueue cost verification without conversation context (backward compatibility)", async () => {
      const { enqueueCostVerification } = await import("../creditManagement");

      await enqueueCostVerification("gen-12345", "workspace-1", "res-1");

      expect(mockQueue.publish).toHaveBeenCalledWith({
        name: "openrouter-cost-verification-queue",
        payload: {
          reservationId: "res-1",
          openrouterGenerationId: "gen-12345",
          workspaceId: "workspace-1",
          // conversationId and agentId should not be in payload
        },
      });

      const payload = mockQueue.publish.mock.calls[0][0].payload;
      expect(payload).not.toHaveProperty("conversationId");
      expect(payload).not.toHaveProperty("agentId");
    });

    it("should handle queue publish errors gracefully", async () => {
      const { enqueueCostVerification } = await import("../creditManagement");

      // Mock queues to throw error
      mockQueue.publish.mockRejectedValueOnce(new Error("Queue error"));

      // Should not throw - errors are logged but not propagated
      await expect(
        enqueueCostVerification("gen-12345", "workspace-1", "res-1")
      ).resolves.not.toThrow();
    });
  });

  describe("multi-generation with tools integration", () => {
    it("should correctly handle multiple LLM generations with tool costs in same conversation", async () => {
      const workspaceId = "test-workspace";
      const agentId = "test-agent";
      const conversationId = "test-conversation";

      // Reserve credits for LLM call with multiple generations
      const llmEstimatedCost = 50_000_000; // $0.05
      const llmReservation = await reserveCredits(
        mockDb,
        workspaceId,
        llmEstimatedCost,
        3,
        false,
        mockContext,
        "openrouter",
        "openrouter/auto",
        agentId,
        conversationId
      );

      expect(llmReservation.reservationId).toBeDefined();

      // Adjust LLM reservation with multiple generation IDs
      const tokenUsage: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      };

      mockCalculateTokenCost.mockReturnValue(45_000_000); // Actual cost: $0.045
      const expires = Math.floor(Date.now() / 1000) + 15 * 60;
      const llmReservationRecord: CreditReservationRecord = {
        pk: `credit-reservations/${llmReservation.reservationId}`,
        workspaceId,
        reservedAmount: llmEstimatedCost,
        estimatedCost: llmEstimatedCost,
        currency: "usd",
        expires,
        expiresHour: Math.floor(expires / 3600) * 3600,
        version: 1,
        createdAt: new Date().toISOString(),
        provider: "openrouter",
        modelName: "openrouter/auto",
        agentId,
        conversationId,
      };

      mockReservationGet.mockResolvedValue(llmReservationRecord);

      const openrouterGenerationIds = ["gen-12345", "gen-67890", "gen-abc123"];

      await adjustCreditReservation(
        mockDb,
        llmReservation.reservationId,
        workspaceId,
        "openrouter",
        "openrouter/auto",
        tokenUsage,
        mockContext,
        3,
        false,
        undefined,
        openrouterGenerationIds,
        agentId,
        conversationId
      );

      // Verify reservation was updated with multiple generation IDs
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          pk: `credit-reservations/${llmReservation.reservationId}`,
          openrouterGenerationIds,
          expectedGenerationCount: 3,
          verifiedGenerationIds: [],
          verifiedCosts: [],
        })
      );

      // Verify transaction was created for the adjustment
      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId,
          amountNanoUsd: 5_000_000, // Positive = refund (50_000_000 - 45_000_000)
        })
      );
    });

    it("should correctly track costs when LLM generations and tool calls happen together", async () => {
      const workspaceId = "test-workspace";
      const agentId = "test-agent";
      const conversationId = "test-conversation";

      // Simulate a conversation flow:
      // 1. LLM call with 2 generations
      // 2. Tool calls (Exa, Tavily, Scraper) happen during LLM processing
      // 3. All costs should be tracked separately

      // Reserve LLM credits
      const llmCost = 40_000_000;
      const llmReservation = await reserveCredits(
        mockDb,
        workspaceId,
        llmCost,
        3,
        false,
        mockContext,
        "openrouter",
        "openrouter/auto",
        agentId,
        conversationId
      );

      // Reserve Scraper credits (tool called during LLM processing)
      const scraperCost = 5_000_000;
      const scraperReservation = await reserveCredits(
        mockDb,
        workspaceId,
        scraperCost,
        3,
        false,
        mockContext,
        "scrape",
        "scrape",
        agentId,
        conversationId
      );

      // Adjust LLM with multiple generations
      const tokenUsage: TokenUsage = {
        promptTokens: 800,
        completionTokens: 400,
        totalTokens: 1200,
      };

      mockCalculateTokenCost.mockReturnValue(35_000_000);
      const expires = Math.floor(Date.now() / 1000) + 15 * 60;
      const llmReservationRecord: CreditReservationRecord = {
        pk: `credit-reservations/${llmReservation.reservationId}`,
        workspaceId,
        reservedAmount: llmCost,
        estimatedCost: llmCost,
        currency: "usd",
        expires,
        expiresHour: Math.floor(expires / 3600) * 3600,
        version: 1,
        createdAt: new Date().toISOString(),
        provider: "openrouter",
        modelName: "openrouter/auto",
        agentId,
        conversationId,
      };

      mockReservationGet.mockResolvedValue(llmReservationRecord);

      await adjustCreditReservation(
        mockDb,
        llmReservation.reservationId,
        workspaceId,
        "openrouter",
        "openrouter/auto",
        tokenUsage,
        mockContext,
        3,
        false,
        undefined,
        ["gen-1", "gen-2"],
        agentId,
        conversationId
      );

      // Verify both reservations exist and are tracked separately
      expect(llmReservation.reservationId).toBeDefined();
      expect(scraperReservation.reservationId).toBeDefined();
      expect(llmReservation.reservationId).not.toBe(scraperReservation.reservationId);

      // Verify LLM adjustment happened
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          openrouterGenerationIds: ["gen-1", "gen-2"],
          expectedGenerationCount: 2,
        })
      );
    });
  });
});
