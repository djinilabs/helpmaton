import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockReserveCredits } = vi.hoisted(() => ({
  mockReserveCredits: vi.fn(),
}));

// Mock credit management
vi.mock("../creditManagement", () => ({
  reserveCredits: mockReserveCredits,
}));

// Mock feature flags
vi.mock("../featureFlags", () => ({
  isCreditDeductionEnabled: vi.fn(() => true),
}));

// Import after mocks are set up
import type {
  CreditReservationRecord,
  DatabaseSchema,
  WorkspaceRecord,
} from "../../tables/schema";
import {
  reserveExaCredits,
  adjustExaCreditReservation,
  refundExaCredits,
} from "../exaCredits";
import type { AugmentedContext } from "../workspaceCreditContext";

describe("exaCredits", () => {
  let mockDb: DatabaseSchema;
  let mockWorkspace: WorkspaceRecord;
  let mockGet: ReturnType<typeof vi.fn>;
  let mockDelete: ReturnType<typeof vi.fn>;
  let mockReservationGet: ReturnType<typeof vi.fn>;
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

    // Setup mock database
    mockDb = {
      workspace: {
        get: mockGet,
      },
      "credit-reservations": {
        get: mockReservationGet,
        delete: mockDelete,
      },
    } as unknown as DatabaseSchema;

    // Setup mock context
    mockContext = {
      addWorkspaceCreditTransaction: vi.fn(),
    } as unknown as AugmentedContext;
  });

  describe("reserveExaCredits", () => {
    it("should reserve credits for Exa API call with default estimate", async () => {
      const reservation = {
        reservationId: "test-reservation-id",
        reservedAmount: 10_000, // $0.01 = 10,000 millionths
        workspace: mockWorkspace,
      };

      mockReserveCredits.mockResolvedValue(reservation);

      const result = await reserveExaCredits(
        mockDb,
        "test-workspace",
        0.01, // estimatedCostDollars (default)
        3, // maxRetries
        mockContext
      );

      expect(result).toEqual(reservation);
      expect(mockReserveCredits).toHaveBeenCalledWith(
        mockDb,
        "test-workspace",
        10_000, // estimatedCost (0.01 * 1_000_000)
        3, // maxRetries
        false, // usesByok
        mockContext, // context
        "exa", // provider
        "exa-api", // modelName
        undefined, // agentId (optional)
        undefined // conversationId (optional)
      );
    });

    it("should reserve credits with custom estimate", async () => {
      const reservation = {
        reservationId: "test-reservation-id",
        reservedAmount: 50_000, // $0.05 = 50,000 millionths
        workspace: mockWorkspace,
      };

      mockReserveCredits.mockResolvedValue(reservation);

      const result = await reserveExaCredits(
        mockDb,
        "test-workspace",
        0.05 // estimatedCostDollars
      );

      expect(result).toEqual(reservation);
      expect(mockReserveCredits).toHaveBeenCalledWith(
        mockDb,
        "test-workspace",
        50_000, // estimatedCost (0.05 * 1_000_000)
        3, // maxRetries (default)
        false, // usesByok
        undefined, // context (optional)
        "exa", // provider
        "exa-api", // modelName
        undefined, // agentId (optional)
        undefined // conversationId (optional)
      );
    });

    it("should handle credit deduction disabled", async () => {
      const { isCreditDeductionEnabled } = await import("../featureFlags");
      vi.mocked(isCreditDeductionEnabled).mockReturnValue(false);

      const result = await reserveExaCredits(
        mockDb,
        "test-workspace",
        0.01,
        3,
        mockContext
      );

      expect(result.reservationId).toBe("deduction-disabled");
      expect(result.reservedAmount).toBe(0);
      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "test-workspace",
          source: "tool-execution",
          supplier: "exa",
          tool_call: "exa-api",
          amountMillionthUsd: 0,
        })
      );
    });
  });

  describe("adjustExaCreditReservation", () => {
    let mockReservation: CreditReservationRecord;
    let reservationId: string;

    beforeEach(() => {
      reservationId = "test-reservation-id";
      mockReservation = {
        pk: `credit-reservations/${reservationId}`,
        workspaceId: "test-workspace",
        reservedAmount: 10_000, // $0.01 = 10,000 millionths
        estimatedCost: 10_000,
        currency: "usd",
        expires: Math.floor(Date.now() / 1000) + 15 * 60,
        version: 1,
        createdAt: new Date().toISOString(),
      } as CreditReservationRecord;

      mockReservationGet.mockResolvedValue(mockReservation);
    });

    it("should adjust credits when actual equals reserved", async () => {
      await adjustExaCreditReservation(
        mockDb,
        reservationId,
        "test-workspace",
        0.01, // actualCostDollars (same as reserved)
        mockContext,
        "search",
        3 // maxRetries
      );

      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "test-workspace",
          source: "tool-execution",
          supplier: "exa",
          tool_call: "search",
          amountMillionthUsd: 0, // difference is 0 (actual = reserved)
        })
      );
      expect(mockDelete).toHaveBeenCalledWith(
        `credit-reservations/${reservationId}`
      );
    });

    it("should refund difference when actual is less than reserved", async () => {
      await adjustExaCreditReservation(
        mockDb,
        reservationId,
        "test-workspace",
        0.005, // actualCostDollars (less than 0.01 reserved)
        mockContext,
        "search",
        3
      );

      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "test-workspace",
          source: "tool-execution",
          supplier: "exa",
          tool_call: "search",
          amountMillionthUsd: 5_000, // difference is negative (refund), negated = positive (credit)
        })
      );

      // actualCost = 0.005 * 1_000_000 = 5_000, reservedAmount = 10_000, difference = -5_000
      // Transaction should record positive amount for refund
    });

    it("should charge additional when actual is more than reserved", async () => {
      await adjustExaCreditReservation(
        mockDb,
        reservationId,
        "test-workspace",
        0.02, // actualCostDollars (more than 0.01 reserved)
        mockContext,
        "search",
        3
      );

      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "test-workspace",
          source: "tool-execution",
          supplier: "exa",
          tool_call: "search",
          amountMillionthUsd: -10_000, // difference is positive (additional charge), negated = negative (debit)
        })
      );

      // actualCost = 0.02 * 1_000_000 = 20_000, reservedAmount = 10_000, difference = 10_000
      // Transaction should record negative amount for additional charge
    });

    it("should create transaction even if reservation not found", async () => {
      mockReservationGet.mockResolvedValue(undefined);
      mockGet.mockResolvedValue({
        pk: "workspaces/test-workspace",
        sk: "workspace",
        creditBalance: 100_000_000,
        currency: "usd",
      });

      await adjustExaCreditReservation(
        mockDb,
        reservationId,
        "test-workspace",
        0.01,
        mockContext,
        "search",
        3
      );

      // Should create transaction with actual cost even if reservation not found
      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith({
        workspaceId: "test-workspace",
        agentId: undefined,
        conversationId: undefined,
        source: "tool-execution",
        supplier: "exa",
        tool_call: "search",
        description: "Exa API call: search - reservation not found, using actual cost",
        amountMillionthUsd: -10_000, // actualCost = 0.01 * 1_000_000 = 10_000, negative for debit
      });
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it("should throw error if workspace not found", async () => {
      mockGet.mockResolvedValue(undefined); // Workspace not found

      await expect(
        adjustExaCreditReservation(
          mockDb,
          reservationId,
          "test-workspace",
          0.01,
          mockContext,
          "search",
          3
        )
      ).rejects.toThrow("Workspace test-workspace not found");
    });

    it("should delete reservation after adjustment", async () => {
      await adjustExaCreditReservation(
        mockDb,
        reservationId,
        "test-workspace",
        0.01,
        mockContext,
        "search",
        3
      );

      expect(mockDelete).toHaveBeenCalledWith(
        `credit-reservations/${reservationId}`
      );
    });

    it("should handle deduction disabled case", async () => {
      const { isCreditDeductionEnabled } = await import("../featureFlags");
      vi.mocked(isCreditDeductionEnabled).mockReturnValue(false);

      await adjustExaCreditReservation(
        mockDb,
        "deduction-disabled",
        "test-workspace",
        0.01,
        mockContext,
        "search",
        3
      );

      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "test-workspace",
          source: "tool-execution",
          supplier: "exa",
          tool_call: "search",
          amountMillionthUsd: 0, // No charge when deduction is disabled
        })
      );
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it("should handle zero-cost adjustment", async () => {
      await adjustExaCreditReservation(
        mockDb,
        reservationId,
        "test-workspace",
        0, // actualCostDollars (zero)
        mockContext,
        "search",
        3
      );

      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "test-workspace",
          source: "tool-execution",
          supplier: "exa",
          tool_call: "search",
          amountMillionthUsd: 10_000, // Refund full reserved amount
        })
      );
    });
  });

  describe("refundExaCredits", () => {
    let mockReservation: CreditReservationRecord;
    let reservationId: string;

    beforeEach(() => {
      reservationId = "test-reservation-id";
      mockReservation = {
        pk: `credit-reservations/${reservationId}`,
        workspaceId: "test-workspace",
        reservedAmount: 10_000, // $0.01 = 10,000 millionths
        estimatedCost: 10_000,
        currency: "usd",
        expires: Math.floor(Date.now() / 1000) + 15 * 60,
        version: 1,
        createdAt: new Date().toISOString(),
      } as CreditReservationRecord;

      mockReservationGet.mockResolvedValue(mockReservation);
    });

    it("should refund reserved credits", async () => {
      await refundExaCredits(
        mockDb,
        reservationId,
        "test-workspace",
        mockContext,
        "search",
        3
      );

      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "test-workspace",
          source: "tool-execution",
          supplier: "exa",
          tool_call: "search",
          amountMillionthUsd: 10_000, // Positive for credit/refund
        })
      );
      expect(mockDelete).toHaveBeenCalledWith(
        `credit-reservations/${reservationId}`
      );
    });

    it("should return early if reservation not found", async () => {
      mockReservationGet.mockResolvedValue(undefined);

      await refundExaCredits(
        mockDb,
        reservationId,
        "test-workspace",
        mockContext,
        undefined,
        3
      );

      expect(mockContext.addWorkspaceCreditTransaction).not.toHaveBeenCalled();
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it("should throw error if workspace not found", async () => {
      mockGet.mockResolvedValue(undefined); // Workspace not found

      await expect(
        refundExaCredits(
          mockDb,
          reservationId,
          "test-workspace",
          mockContext,
          undefined,
          3
        )
      ).rejects.toThrow("Workspace test-workspace not found");
    });

    it("should delete reservation after refund", async () => {
      await refundExaCredits(
        mockDb,
        reservationId,
        "test-workspace",
        mockContext,
        "search",
        3
      );

      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "test-workspace",
          source: "tool-execution",
          supplier: "exa",
          tool_call: "search",
          amountMillionthUsd: 10_000, // Positive for credit/refund
        })
      );
      expect(mockDelete).toHaveBeenCalledWith(
        `credit-reservations/${reservationId}`
      );
    });
  });
});

