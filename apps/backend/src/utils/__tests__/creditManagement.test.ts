import { conflict } from "@hapi/boom";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDatabase, mockCalculateTokenCost } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockCalculateTokenCost: vi.fn(),
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
  refundReservation,
  reserveCredits,
} from "../creditManagement";

describe("creditManagement", () => {
  let mockDb: DatabaseSchema;
  let mockWorkspace: WorkspaceRecord;
  let mockAtomicUpdate: ReturnType<typeof vi.fn>;
  let mockGet: ReturnType<typeof vi.fn>;
  let mockCreate: ReturnType<typeof vi.fn>;
  let mockDelete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    // Setup mock workspace
    mockWorkspace = {
      pk: "workspaces/test-workspace",
      sk: "workspace",
      name: "Test Workspace",
      creditBalance: 100.0,
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

    // Setup mock database
    mockDb = {
      workspace: {
        get: mockGet,
        atomicUpdate: mockAtomicUpdate,
      },
      "credit-reservations": {
        get: vi.fn(),
        create: mockCreate,
        delete: mockDelete,
      },
    } as unknown as DatabaseSchema;

    mockDatabase.mockResolvedValue(mockDb);

    // Setup default pricing mock
    mockCalculateTokenCost.mockReturnValue(0.01);
  });

  describe("reserveCredits", () => {
    it("should successfully reserve credits when balance is sufficient", async () => {
      const estimatedCost = 10.0;
      const updatedWorkspace = {
        ...mockWorkspace,
        creditBalance: 90.0, // 100 - 10
      };

      mockAtomicUpdate.mockResolvedValue(updatedWorkspace);

      const result = await reserveCredits(
        mockDb,
        "test-workspace",
        estimatedCost,
        "usd"
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
      const estimatedCost = 150.0; // More than available 100.0

      mockAtomicUpdate.mockImplementation(async (_pk, _sk, updater) => {
        const current = { ...mockWorkspace };
        const result = await updater(current);
        return result as WorkspaceRecord;
      });

      await expect(
        reserveCredits(mockDb, "test-workspace", estimatedCost, "usd")
      ).rejects.toThrow(InsufficientCreditsError);

      await expect(
        reserveCredits(mockDb, "test-workspace", estimatedCost, "usd")
      ).rejects.toThrow("Insufficient credits");
    });

    it("should skip reservation for BYOK requests", async () => {
      const result = await reserveCredits(
        mockDb,
        "test-workspace",
        10.0,
        "usd",
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
        reserveCredits(mockDb, "test-workspace", 10.0, "usd", 3, true)
      ).rejects.toThrow("Workspace test-workspace not found");
    });

    it("should handle version conflicts - throws error after max retries", async () => {
      const estimatedCost = 10.0;

      // Simulate version conflict that persists after retries
      mockAtomicUpdate.mockRejectedValue(
        new Error("Conditional request failed")
      );

      await expect(
        reserveCredits(mockDb, "test-workspace", estimatedCost, "usd", 2)
      ).rejects.toThrow("Failed to reserve credits after 2 retries");
    });

    it("should throw error after max retries on version conflicts", async () => {
      const estimatedCost = 10.0;

      mockAtomicUpdate.mockRejectedValue(
        new Error("Conditional request failed")
      );

      await expect(
        reserveCredits(mockDb, "test-workspace", estimatedCost, "usd", 2)
      ).rejects.toThrow("Failed to reserve credits after 2 retries");
    });

    it("should handle exact balance match", async () => {
      const estimatedCost = 100.0; // Exactly the balance
      const updatedWorkspace = {
        ...mockWorkspace,
        creditBalance: 0.0,
      };

      mockAtomicUpdate.mockResolvedValue(updatedWorkspace);

      const result = await reserveCredits(
        mockDb,
        "test-workspace",
        estimatedCost,
        "usd"
      );

      expect(result.reservedAmount).toBe(estimatedCost);
      expect(result.workspace.creditBalance).toBe(0.0);
    });

    it("should round balance to 6 decimal places", async () => {
      const estimatedCost = 10.123456789;
      const updatedWorkspace = {
        ...mockWorkspace,
        creditBalance: 89.876543,
      };

      mockAtomicUpdate.mockResolvedValue(updatedWorkspace);

      await reserveCredits(mockDb, "test-workspace", estimatedCost, "usd");

      const updaterCall = mockAtomicUpdate.mock.calls[0][2];
      const current = { ...mockWorkspace };
      const result = await updaterCall(current);

      // Should round to 6 decimal places
      const expectedBalance =
        Math.round((mockWorkspace.creditBalance - estimatedCost) * 1_000_000) /
        1_000_000;
      expect(result.creditBalance).toBe(expectedBalance);
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
        reservedAmount: 10.0,
        estimatedCost: 10.0,
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

      // Actual cost will be less than reserved (10.0)
      mockCalculateTokenCost.mockReturnValue(5.0); // Actual cost
      const updatedWorkspace = {
        ...mockWorkspace,
        creditBalance: 95.0, // 90 + 5 (refund of difference)
      };

      mockAtomicUpdate.mockResolvedValue(updatedWorkspace);

      const result = await adjustCreditReservation(
        mockDb,
        reservationId,
        "test-workspace",
        "google",
        "gemini-2.5-flash",
        tokenUsage
      );

      expect(result.creditBalance).toBe(95.0);
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
      mockCalculateTokenCost.mockReturnValue(15.0); // Actual cost
      const updatedWorkspace = {
        ...mockWorkspace,
        creditBalance: 85.0, // 90 - 5 (additional deduction)
      };

      mockAtomicUpdate.mockResolvedValue(updatedWorkspace);

      const result = await adjustCreditReservation(
        mockDb,
        reservationId,
        "test-workspace",
        "google",
        "gemini-2.5-flash",
        tokenUsage
      );

      expect(result.creditBalance).toBe(85.0);
    });

    it("should handle exact match (no adjustment needed)", async () => {
      const tokenUsage: TokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      };

      // Actual cost equals reserved
      mockCalculateTokenCost.mockReturnValue(10.0);
      const updatedWorkspace = {
        ...mockWorkspace,
        creditBalance: 90.0, // No change
      };

      mockAtomicUpdate.mockResolvedValue(updatedWorkspace);

      const result = await adjustCreditReservation(
        mockDb,
        reservationId,
        "test-workspace",
        "google",
        "gemini-2.5-flash",
        tokenUsage
      );

      expect(result.creditBalance).toBe(90.0);
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
        tokenUsage
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

      mockCalculateTokenCost.mockReturnValue(5.0);
      mockAtomicUpdate.mockRejectedValue(new Error("Item was outdated"));

      await expect(
        adjustCreditReservation(
          mockDb,
          reservationId,
          "test-workspace",
          "google",
          "gemini-2.5-flash",
          tokenUsage,
          2
        )
      ).rejects.toThrow("Failed to adjust credit reservation after 2 retries");
    });

    it("should handle delete failure gracefully", async () => {
      const tokenUsage: TokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      };

      mockCalculateTokenCost.mockReturnValue(5.0);
      mockDelete.mockRejectedValue(new Error("Delete failed"));

      const updatedWorkspace = {
        ...mockWorkspace,
        creditBalance: 95.0,
      };

      mockAtomicUpdate.mockResolvedValue(updatedWorkspace);

      // Should not throw even if delete fails
      const result = await adjustCreditReservation(
        mockDb,
        reservationId,
        "test-workspace",
        "google",
        "gemini-2.5-flash",
        tokenUsage
      );

      expect(result.creditBalance).toBe(95.0);
    });

    it("should handle reasoning tokens in cost calculation", async () => {
      const tokenUsage: TokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        reasoningTokens: 25,
      };

      mockCalculateTokenCost.mockReturnValue(12.0);
      const updatedWorkspace = {
        ...mockWorkspace,
        creditBalance: 88.0,
      };

      mockAtomicUpdate.mockResolvedValue(updatedWorkspace);

      await adjustCreditReservation(
        mockDb,
        reservationId,
        "test-workspace",
        "google",
        "gemini-2.5-flash",
        tokenUsage
      );

      expect(mockCalculateTokenCost).toHaveBeenCalledWith(
        "google",
        "gemini-2.5-flash",
        100,
        50,
        "usd",
        25
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
        reservedAmount: 10.0,
        estimatedCost: 10.0,
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
      const updatedWorkspace = {
        ...mockWorkspace,
        creditBalance: 110.0, // 100 + 10 (refund)
      };

      mockAtomicUpdate.mockResolvedValue(updatedWorkspace);

      await refundReservation(mockDb, reservationId);

      expect(mockAtomicUpdate).toHaveBeenCalledWith(
        "workspaces/test-workspace",
        "workspace",
        expect.any(Function),
        { maxRetries: 3 }
      );
      expect(mockDelete).toHaveBeenCalledWith(
        `credit-reservations/${reservationId}`
      );

      // Verify the updater function adds the reserved amount
      const updaterCall = mockAtomicUpdate.mock.calls[0][2];
      const current = { ...mockWorkspace, creditBalance: 90.0 };
      const result = await updaterCall(current);
      expect(result.creditBalance).toBe(100.0); // 90 + 10
    });

    it("should skip refund for BYOK reservations", async () => {
      await refundReservation(mockDb, "byok");

      expect(mockAtomicUpdate).not.toHaveBeenCalled();
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it("should handle reservation not found gracefully", async () => {
      (
        mockDb["credit-reservations"].get as ReturnType<typeof vi.fn>
      ).mockResolvedValue(undefined);

      await refundReservation(mockDb, reservationId);

      expect(mockAtomicUpdate).not.toHaveBeenCalled();
    });

    it("should handle version conflicts - throws error after max retries", async () => {
      mockAtomicUpdate.mockRejectedValue(conflict("Item was outdated"));

      await expect(refundReservation(mockDb, reservationId, 2)).rejects.toThrow(
        "Failed to refund reservation after 2 retries"
      );
    });

    it("should throw error after max retries", async () => {
      mockAtomicUpdate.mockRejectedValue(
        conflict("Failed to atomically update record after 3 retries")
      );

      await expect(refundReservation(mockDb, reservationId, 2)).rejects.toThrow(
        "Failed to refund reservation after 2 retries"
      );
    });

    it("should handle delete failure gracefully", async () => {
      const updatedWorkspace = {
        ...mockWorkspace,
        creditBalance: 110.0,
      };

      mockAtomicUpdate.mockResolvedValue(updatedWorkspace);
      mockDelete.mockRejectedValue(new Error("Delete failed"));

      // Should not throw even if delete fails
      await refundReservation(mockDb, reservationId);

      expect(mockAtomicUpdate).toHaveBeenCalled();
    });

    it("should round refund amount to 6 decimal places", async () => {
      const reservationWithDecimal = {
        ...mockReservation,
        reservedAmount: 10.123456789,
      };

      (
        mockDb["credit-reservations"].get as ReturnType<typeof vi.fn>
      ).mockResolvedValue(reservationWithDecimal);

      const updatedWorkspace = {
        ...mockWorkspace,
        creditBalance: 110.123457, // Rounded
      };

      mockAtomicUpdate.mockResolvedValue(updatedWorkspace);

      await refundReservation(mockDb, reservationId);

      const updaterCall = mockAtomicUpdate.mock.calls[0][2];
      const current = { ...mockWorkspace, creditBalance: 90.0 };
      const result = await updaterCall(current);

      const expectedBalance =
        Math.round((90.0 + 10.123456789) * 1_000_000) / 1_000_000;
      expect(result.creditBalance).toBe(expectedBalance);
    });
  });

  describe("concurrent reservation scenarios", () => {
    it("should verify atomic check prevents overspending", async () => {
      const estimatedCost = 60.0;
      const initialBalance = 100.0;

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
        "usd"
      );
      expect(result1.reservationId).toBeDefined();

      // Second reservation should fail (40 < 60)
      // Update mock to reflect new balance
      mockAtomicUpdate.mockImplementation(async (_pk, _sk, updater) => {
        const current = {
          ...mockWorkspace,
          creditBalance: 40.0, // After first reservation
        };
        const result = await updater(current);
        return result as WorkspaceRecord;
      });

      await expect(
        reserveCredits(mockDb, "test-workspace", estimatedCost, "usd")
      ).rejects.toThrow(InsufficientCreditsError);

      // This demonstrates that the atomic check in the updater function
      // prevents overspending by validating balance before deducting
    });

    it("should handle sequential reservations correctly", async () => {
      const estimatedCost = 30.0;
      let currentBalance = 100.0;

      mockAtomicUpdate.mockImplementation(async (_pk, _sk, updater) => {
        const current = {
          ...mockWorkspace,
          creditBalance: currentBalance,
        };
        const result = await updater(current);
        currentBalance = (result as { creditBalance: number }).creditBalance;
        return result as WorkspaceRecord;
      });

      // First reservation: 100 - 30 = 70
      const result1 = await reserveCredits(
        mockDb,
        "test-workspace",
        estimatedCost,
        "usd"
      );
      expect(result1.workspace.creditBalance).toBe(70.0);

      // Second reservation: 70 - 30 = 40
      const result2 = await reserveCredits(
        mockDb,
        "test-workspace",
        estimatedCost,
        "usd"
      );
      expect(result2.workspace.creditBalance).toBe(40.0);

      // Third reservation: 40 - 30 = 10
      const result3 = await reserveCredits(
        mockDb,
        "test-workspace",
        estimatedCost,
        "usd"
      );
      expect(result3.workspace.creditBalance).toBe(10.0);

      // Fourth reservation should fail: 10 < 30
      await expect(
        reserveCredits(mockDb, "test-workspace", estimatedCost, "usd")
      ).rejects.toThrow(InsufficientCreditsError);

      // Verify final balance is correct
      expect(currentBalance).toBe(10.0);
    });
  });
});
