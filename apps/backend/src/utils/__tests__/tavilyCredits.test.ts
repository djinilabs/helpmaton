import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockReserveCredits } = vi.hoisted(() => ({
  mockReserveCredits: vi.fn(),
}));

// Mock credit management
vi.mock("../creditManagement", () => ({
  reserveCredits: mockReserveCredits,
}));

// Import after mocks are set up
import type {
  CreditReservationRecord,
  DatabaseSchema,
  WorkspaceRecord,
} from "../../tables/schema";
import {
  calculateTavilyCost,
  reserveTavilyCredits,
  adjustTavilyCreditReservation,
  refundTavilyCredits,
} from "../tavilyCredits";

describe("tavilyCredits", () => {
  let mockDb: DatabaseSchema;
  let mockWorkspace: WorkspaceRecord;
  let mockAtomicUpdate: ReturnType<typeof vi.fn>;
  let mockGet: ReturnType<typeof vi.fn>;
  let mockDelete: ReturnType<typeof vi.fn>;
  let mockReservationGet: ReturnType<typeof vi.fn>;

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

    // Setup mock atomicUpdate
    mockAtomicUpdate = vi.fn().mockResolvedValue(mockWorkspace);

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
        atomicUpdate: mockAtomicUpdate,
      },
      "credit-reservations": {
        get: mockReservationGet,
        delete: mockDelete,
      },
    } as unknown as DatabaseSchema;
  });

  describe("calculateTavilyCost", () => {
    it("should calculate cost for 1 credit (default)", () => {
      const result = calculateTavilyCost();
      expect(result).toBe(8_000); // $0.008 = 8,000 millionths
    });

    it("should calculate cost for multiple credits", () => {
      const result = calculateTavilyCost(3);
      expect(result).toBe(24_000); // 3 * $0.008 = 24,000 millionths
    });

    it("should handle zero credits", () => {
      const result = calculateTavilyCost(0);
      expect(result).toBe(0);
    });
  });

  describe("reserveTavilyCredits", () => {
    it("should reserve credits for Tavily API call", async () => {
      const reservation = {
        reservationId: "test-reservation-id",
        reservedAmount: 8_000,
        workspace: mockWorkspace,
      };

      mockReserveCredits.mockResolvedValue(reservation);

      const result = await reserveTavilyCredits(
        mockDb,
        "test-workspace",
        1, // estimatedCredits
        3 // maxRetries
      );

      expect(result).toEqual(reservation);
      expect(mockReserveCredits).toHaveBeenCalledWith(
        mockDb,
        "test-workspace",
        8_000, // estimatedCost (1 * 8,000)
        3, // maxRetries
        false // usesByok
      );
    });

    it("should handle multiple credits", async () => {
      const reservation = {
        reservationId: "test-reservation-id",
        reservedAmount: 16_000,
        workspace: mockWorkspace,
      };

      mockReserveCredits.mockResolvedValue(reservation);

      const result = await reserveTavilyCredits(
        mockDb,
        "test-workspace",
        2 // estimatedCredits
      );

      expect(result).toEqual(reservation);
      expect(mockReserveCredits).toHaveBeenCalledWith(
        mockDb,
        "test-workspace",
        16_000, // estimatedCost (2 * 8,000)
        3, // maxRetries (default)
        false // usesByok
      );
    });
  });

  describe("adjustTavilyCreditReservation", () => {
    let mockReservation: CreditReservationRecord;
    let reservationId: string;

    beforeEach(() => {
      reservationId = "test-reservation-id";
      mockReservation = {
        pk: `credit-reservations/${reservationId}`,
        workspaceId: "test-workspace",
        reservedAmount: 8_000, // $0.008 in millionths
        estimatedCost: 8_000,
        currency: "usd",
        expires: Math.floor(Date.now() / 1000) + 15 * 60,
        version: 1,
        createdAt: new Date().toISOString(),
      } as CreditReservationRecord;

      mockReservationGet.mockResolvedValue(mockReservation);
    });

    it("should adjust credits when actual equals reserved", async () => {
      const updatedWorkspace = {
        ...mockWorkspace,
        creditBalance: 99_992_000, // 100_000_000 - 8_000 (no change since actual = reserved)
      };

      mockAtomicUpdate.mockResolvedValue(updatedWorkspace);

      await adjustTavilyCreditReservation(
        mockDb,
        reservationId,
        "test-workspace",
        1, // actualCreditsUsed (same as reserved)
        3 // maxRetries
      );

      expect(mockAtomicUpdate).toHaveBeenCalledWith(
        "workspaces/test-workspace",
        "workspace",
        expect.any(Function),
        { maxRetries: 3 }
      );
      expect(mockDelete).toHaveBeenCalledWith(
        `credit-reservations/${reservationId}`
      );

      // Verify the updater function logic
      const updaterCall = mockAtomicUpdate.mock.calls[0][2];
      const current = { ...mockWorkspace };
      const result = await updaterCall(current);

      // actualCost = 8_000, reservedAmount = 8_000, difference = 0
      // newBalance = 100_000_000 - 0 = 100_000_000
      expect(result.creditBalance).toBe(100_000_000);
    });

    it("should refund difference when actual is less than reserved", async () => {
      const updatedWorkspace = {
        ...mockWorkspace,
        creditBalance: 100_004_000, // Refunded 4,000 (reserved 8,000, actual 4,000)
      };

      mockAtomicUpdate.mockResolvedValue(updatedWorkspace);

      await adjustTavilyCreditReservation(
        mockDb,
        reservationId,
        "test-workspace",
        0.5, // actualCreditsUsed (less than 1)
        3
      );

      // Verify the updater function logic
      const updaterCall = mockAtomicUpdate.mock.calls[0][2];
      const current = { ...mockWorkspace };
      const result = await updaterCall(current);

      // actualCost = 0.5 * 8_000 = 4_000, reservedAmount = 8_000, difference = -4_000
      // newBalance = 100_000_000 - (-4_000) = 100_004_000 (refund)
      expect(result.creditBalance).toBe(100_004_000);
    });

    it("should charge additional when actual is more than reserved", async () => {
      const updatedWorkspace = {
        ...mockWorkspace,
        creditBalance: 99_992_000, // Charged additional 8,000 (reserved 8,000, actual 16,000)
      };

      mockAtomicUpdate.mockResolvedValue(updatedWorkspace);

      await adjustTavilyCreditReservation(
        mockDb,
        reservationId,
        "test-workspace",
        2, // actualCreditsUsed (more than 1)
        3
      );

      // Verify the updater function logic
      const updaterCall = mockAtomicUpdate.mock.calls[0][2];
      const current = { ...mockWorkspace };
      const result = await updaterCall(current);

      // actualCost = 2 * 8_000 = 16_000, reservedAmount = 8_000, difference = 8_000
      // newBalance = 100_000_000 - 8_000 = 99_992_000 (additional charge)
      expect(result.creditBalance).toBe(99_992_000);
    });

    it("should return early if reservation not found", async () => {
      mockReservationGet.mockResolvedValue(undefined);

      await adjustTavilyCreditReservation(
        mockDb,
        reservationId,
        "test-workspace",
        1,
        3
      );

      expect(mockAtomicUpdate).not.toHaveBeenCalled();
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it("should throw error if workspace not found", async () => {
      mockAtomicUpdate.mockImplementation(async (_pk, _sk, updater) => {
        const current = undefined; // Workspace not found
        await updater(current);
      });

      await expect(
        adjustTavilyCreditReservation(
          mockDb,
          reservationId,
          "test-workspace",
          1,
          3
        )
      ).rejects.toThrow("Workspace test-workspace not found");
    });

    it("should delete reservation after adjustment", async () => {
      const updatedWorkspace = {
        ...mockWorkspace,
        creditBalance: 99_992_000,
      };

      mockAtomicUpdate.mockResolvedValue(updatedWorkspace);

      await adjustTavilyCreditReservation(
        mockDb,
        reservationId,
        "test-workspace",
        1,
        3
      );

      expect(mockDelete).toHaveBeenCalledWith(
        `credit-reservations/${reservationId}`
      );
    });
  });

  describe("refundTavilyCredits", () => {
    let mockReservation: CreditReservationRecord;
    let reservationId: string;

    beforeEach(() => {
      reservationId = "test-reservation-id";
      mockReservation = {
        pk: `credit-reservations/${reservationId}`,
        workspaceId: "test-workspace",
        reservedAmount: 8_000, // $0.008 in millionths
        estimatedCost: 8_000,
        currency: "usd",
        expires: Math.floor(Date.now() / 1000) + 15 * 60,
        version: 1,
        createdAt: new Date().toISOString(),
      } as CreditReservationRecord;

      mockReservationGet.mockResolvedValue(mockReservation);
    });

    it("should refund reserved credits", async () => {
      const updatedWorkspace = {
        ...mockWorkspace,
        creditBalance: 100_008_000, // Refunded 8,000
      };

      mockAtomicUpdate.mockResolvedValue(updatedWorkspace);

      await refundTavilyCredits(mockDb, reservationId, "test-workspace", 3);

      expect(mockAtomicUpdate).toHaveBeenCalledWith(
        "workspaces/test-workspace",
        "workspace",
        expect.any(Function),
        { maxRetries: 3 }
      );
      expect(mockDelete).toHaveBeenCalledWith(
        `credit-reservations/${reservationId}`
      );

      // Verify the updater function logic
      const updaterCall = mockAtomicUpdate.mock.calls[0][2];
      const current = { ...mockWorkspace };
      const result = await updaterCall(current);

      // newBalance = 100_000_000 + 8_000 = 100_008_000 (refund)
      expect(result.creditBalance).toBe(100_008_000);
    });

    it("should return early if reservation not found", async () => {
      mockReservationGet.mockResolvedValue(undefined);

      await refundTavilyCredits(mockDb, reservationId, "test-workspace", 3);

      expect(mockAtomicUpdate).not.toHaveBeenCalled();
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it("should throw error if workspace not found", async () => {
      mockAtomicUpdate.mockImplementation(async (_pk, _sk, updater) => {
        const current = undefined; // Workspace not found
        await updater(current);
      });

      await expect(
        refundTavilyCredits(mockDb, reservationId, "test-workspace", 3)
      ).rejects.toThrow("Workspace test-workspace not found");
    });

    it("should delete reservation after refund", async () => {
      const updatedWorkspace = {
        ...mockWorkspace,
        creditBalance: 100_008_000,
      };

      mockAtomicUpdate.mockResolvedValue(updatedWorkspace);

      await refundTavilyCredits(mockDb, reservationId, "test-workspace", 3);

      expect(mockDelete).toHaveBeenCalledWith(
        `credit-reservations/${reservationId}`
      );
    });
  });
});

