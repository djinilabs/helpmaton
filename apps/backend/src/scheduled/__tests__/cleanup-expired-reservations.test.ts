import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDatabase, mockRefundReservation } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockRefundReservation: vi.fn(),
  };
});

// Mock the database module
vi.mock("../../tables/database", () => ({
  database: mockDatabase,
}));

// Mock creditManagement
vi.mock("../../utils/creditManagement", () => ({
  refundReservation: mockRefundReservation,
}));

// Import after mocks are set up
import type {
  DatabaseSchema,
  CreditReservationRecord,
} from "../../tables/schema";
import { cleanupExpiredReservations } from "../cleanup-expired-reservations";

describe("cleanupExpiredReservations", () => {
  let mockDb: DatabaseSchema;
  let mockQuery: ReturnType<typeof vi.fn>;
  let mockDelete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    // Setup mock query
    mockQuery = vi.fn().mockResolvedValue({ items: [] });

    // Setup mock delete
    mockDelete = vi.fn().mockResolvedValue({});

    // Setup mock database
    mockDb = {
      "credit-reservations": {
        query: mockQuery,
        delete: mockDelete,
      },
    } as unknown as DatabaseSchema;

    mockDatabase.mockResolvedValue(mockDb);
  });

  it("should successfully process expired reservations and refund credits", async () => {
    const now = Math.floor(Date.now() / 1000);
    const currentHour = Math.floor(now / 3600) * 3600;
    const expiredTime = now - 1000; // Expired 1000 seconds ago

    const reservation: CreditReservationRecord = {
      pk: "credit-reservations/reservation-123",
      sk: "reservation",
      workspaceId: "workspace-456",
      reservedAmount: 10.0,
      estimatedCost: 10.0,
      currency: "usd",
      expires: expiredTime,
      expiresHour: currentHour,
      version: 1,
      createdAt: new Date().toISOString(),
    };

    // Mock both hour bucket queries (previous hour empty, current hour has reservation)
    mockQuery
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [reservation] });
    mockRefundReservation.mockResolvedValue(undefined);

    await cleanupExpiredReservations();

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockRefundReservation).toHaveBeenCalledWith(
      mockDb,
      "reservation-123"
    );
  });

  it("should query correct hour buckets (current and previous hour)", async () => {
    mockQuery.mockResolvedValue({ items: [] });

    await cleanupExpiredReservations();

    // Should query both current and previous hour
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        IndexName: "byExpiresHour",
        KeyConditionExpression: "expiresHour = :hourBucket AND expires < :now",
        ExpressionAttributeValues: expect.objectContaining({
          ":hourBucket": expect.any(Number),
          ":now": expect.any(Number),
        }),
      })
    );
  });

  it("should filter reservations correctly using expires < now condition", async () => {
    const now = Math.floor(Date.now() / 1000);
    const currentHour = Math.floor(now / 3600) * 3600;
    const expiredTime = now - 1000;

    const expiredReservation: CreditReservationRecord = {
      pk: "credit-reservations/reservation-123",
      sk: "reservation",
      workspaceId: "workspace-456",
      reservedAmount: 10.0,
      estimatedCost: 10.0,
      currency: "usd",
      expires: expiredTime,
      expiresHour: currentHour,
      version: 1,
      createdAt: new Date().toISOString(),
    };

    // Query should filter by expires < now, so only expired reservations are returned
    mockQuery
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [expiredReservation] });

    await cleanupExpiredReservations();

    expect(mockRefundReservation).toHaveBeenCalledTimes(1);
    expect(mockRefundReservation).toHaveBeenCalledWith(
      mockDb,
      "reservation-123"
    );
  });

  it("should skip BYOK reservations and delete them", async () => {
    const now = Math.floor(Date.now() / 1000);
    const currentHour = Math.floor(now / 3600) * 3600;
    const expiredTime = now - 1000;

    const byokReservation: CreditReservationRecord = {
      pk: "credit-reservations/byok",
      sk: "reservation",
      workspaceId: "workspace-456",
      reservedAmount: 0,
      estimatedCost: 0,
      currency: "usd",
      expires: expiredTime,
      expiresHour: currentHour,
      version: 1,
      createdAt: new Date().toISOString(),
    };

    mockQuery
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [byokReservation] });

    await cleanupExpiredReservations();

    expect(mockRefundReservation).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith("credit-reservations/byok");
  });

  it("should handle safety limit (stops at 1000 reservations)", async () => {
    const now = Math.floor(Date.now() / 1000);
    const currentHour = Math.floor(now / 3600) * 3600;
    const expiredTime = now - 1000;

    // Create 1000 reservations
    const reservations: CreditReservationRecord[] = Array.from(
      { length: 1000 },
      (_, i) => ({
        pk: `credit-reservations/reservation-${i}`,
        sk: "reservation",
        workspaceId: "workspace-456",
        reservedAmount: 10.0,
        estimatedCost: 10.0,
        currency: "usd",
        expires: expiredTime,
        expiresHour: currentHour,
        version: 1,
        createdAt: new Date().toISOString(),
      })
    );

    // First hour bucket returns 1000, should stop before querying second bucket
    mockQuery.mockResolvedValueOnce({ items: reservations });

    await cleanupExpiredReservations();

    // Should only process first 1000 and stop
    expect(mockRefundReservation).toHaveBeenCalledTimes(1000);
    // Should stop querying after reaching limit (only queries first hour bucket)
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("should continue processing other reservations when one fails", async () => {
    const now = Math.floor(Date.now() / 1000);
    const currentHour = Math.floor(now / 3600) * 3600;
    const expiredTime = now - 1000;

    const reservation1: CreditReservationRecord = {
      pk: "credit-reservations/reservation-1",
      sk: "reservation",
      workspaceId: "workspace-456",
      reservedAmount: 10.0,
      estimatedCost: 10.0,
      currency: "usd",
      expires: expiredTime,
      expiresHour: currentHour,
      version: 1,
      createdAt: new Date().toISOString(),
    };

    const reservation2: CreditReservationRecord = {
      pk: "credit-reservations/reservation-2",
      sk: "reservation",
      workspaceId: "workspace-456",
      reservedAmount: 20.0,
      estimatedCost: 20.0,
      currency: "usd",
      expires: expiredTime,
      expiresHour: currentHour,
      version: 1,
      createdAt: new Date().toISOString(),
    };

    mockQuery
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [reservation1, reservation2] });
    mockRefundReservation
      .mockRejectedValueOnce(new Error("Refund failed"))
      .mockResolvedValueOnce(undefined);

    await cleanupExpiredReservations();

    // Should attempt both refunds
    expect(mockRefundReservation).toHaveBeenCalledTimes(2);
    expect(mockRefundReservation).toHaveBeenCalledWith(mockDb, "reservation-1");
    expect(mockRefundReservation).toHaveBeenCalledWith(mockDb, "reservation-2");
  });

  it("should handle query errors gracefully (continues with next hour bucket)", async () => {
    // First query fails, second succeeds
    mockQuery
      .mockRejectedValueOnce(new Error("Query failed"))
      .mockResolvedValueOnce({ items: [] });

    await cleanupExpiredReservations();

    // Should still query both hour buckets
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("should handle refund errors gracefully (logs but continues)", async () => {
    const now = Math.floor(Date.now() / 1000);
    const currentHour = Math.floor(now / 3600) * 3600;
    const expiredTime = now - 1000;

    const reservation: CreditReservationRecord = {
      pk: "credit-reservations/reservation-123",
      sk: "reservation",
      workspaceId: "workspace-456",
      reservedAmount: 10.0,
      estimatedCost: 10.0,
      currency: "usd",
      expires: expiredTime,
      expiresHour: currentHour,
      version: 1,
      createdAt: new Date().toISOString(),
    };

    mockQuery.mockResolvedValue({ items: [reservation] });
    mockRefundReservation.mockRejectedValue(new Error("Refund failed"));

    // Should not throw
    await expect(cleanupExpiredReservations()).resolves.not.toThrow();

    expect(mockRefundReservation).toHaveBeenCalled();
  });

  it("should return early when no expired reservations found", async () => {
    mockQuery.mockResolvedValue({ items: [] });

    await cleanupExpiredReservations();

    expect(mockRefundReservation).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("should correctly extract reservation IDs from pk format", async () => {
    const now = Math.floor(Date.now() / 1000);
    const currentHour = Math.floor(now / 3600) * 3600;
    const expiredTime = now - 1000;

    const reservation: CreditReservationRecord = {
      pk: "credit-reservations/complex-reservation-id-123",
      sk: "reservation",
      workspaceId: "workspace-456",
      reservedAmount: 10.0,
      estimatedCost: 10.0,
      currency: "usd",
      expires: expiredTime,
      expiresHour: currentHour,
      version: 1,
      createdAt: new Date().toISOString(),
    };

    mockQuery
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [reservation] });
    mockRefundReservation.mockResolvedValue(undefined);

    await cleanupExpiredReservations();

    expect(mockRefundReservation).toHaveBeenCalledWith(
      mockDb,
      "complex-reservation-id-123"
    );
  });

  it("should handle delete errors for BYOK reservations gracefully", async () => {
    const now = Math.floor(Date.now() / 1000);
    const currentHour = Math.floor(now / 3600) * 3600;
    const expiredTime = now - 1000;

    const byokReservation: CreditReservationRecord = {
      pk: "credit-reservations/byok",
      sk: "reservation",
      workspaceId: "workspace-456",
      reservedAmount: 0,
      estimatedCost: 0,
      currency: "usd",
      expires: expiredTime,
      expiresHour: currentHour,
      version: 1,
      createdAt: new Date().toISOString(),
    };

    mockQuery
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [byokReservation] });
    mockDelete.mockRejectedValue(new Error("Delete failed"));

    // Should not throw
    await expect(cleanupExpiredReservations()).resolves.not.toThrow();

    expect(mockRefundReservation).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalled();
  });

  it("should process reservations from multiple hour buckets", async () => {
    const now = Math.floor(Date.now() / 1000);
    const currentHour = Math.floor(now / 3600) * 3600;
    const previousHour = currentHour - 3600;
    const expiredTime = now - 1000;

    const reservation1: CreditReservationRecord = {
      pk: "credit-reservations/reservation-1",
      sk: "reservation",
      workspaceId: "workspace-456",
      reservedAmount: 10.0,
      estimatedCost: 10.0,
      currency: "usd",
      expires: expiredTime,
      expiresHour: previousHour,
      version: 1,
      createdAt: new Date().toISOString(),
    };

    const reservation2: CreditReservationRecord = {
      pk: "credit-reservations/reservation-2",
      sk: "reservation",
      workspaceId: "workspace-456",
      reservedAmount: 20.0,
      estimatedCost: 20.0,
      currency: "usd",
      expires: expiredTime,
      expiresHour: currentHour,
      version: 1,
      createdAt: new Date().toISOString(),
    };

    mockQuery
      .mockResolvedValueOnce({ items: [reservation1] })
      .mockResolvedValueOnce({ items: [reservation2] });

    await cleanupExpiredReservations();

    expect(mockRefundReservation).toHaveBeenCalledTimes(2);
    expect(mockRefundReservation).toHaveBeenCalledWith(mockDb, "reservation-1");
    expect(mockRefundReservation).toHaveBeenCalledWith(mockDb, "reservation-2");
  });
});



