import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDatabase } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
  };
});

// Mock the database module
vi.mock("../../tables/database", () => ({
  database: mockDatabase,
}));

// Import after mocks are set up
import type { DatabaseSchema } from "../../tables/schema";
import { isUserInTrialPeriod, getTrialDaysRemaining } from "../trialPeriod";

describe("trialPeriod", () => {
  let mockDb: DatabaseSchema;
  let mockGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    mockGet = vi.fn();

    mockDb = {
      "next-auth": {
        get: mockGet,
      },
    } as unknown as DatabaseSchema;

    mockDatabase.mockResolvedValue(mockDb);
  });

  describe("isUserInTrialPeriod", () => {
    it("should return true for user within trial period", async () => {
      const now = new Date("2024-01-15T12:00:00Z");
      vi.setSystemTime(now);

      // User created 3 days ago (within 7-day trial)
      const createdAt = new Date("2024-01-12T12:00:00Z");

      mockGet.mockResolvedValue({
        pk: "USER#user-123",
        sk: "USER#user-123",
        id: "user-123",
        email: "user@example.com",
        type: "USER",
        createdAt: createdAt.toISOString(),
      });

      const result = await isUserInTrialPeriod("user-123");

      expect(result).toBe(true);
      expect(mockGet).toHaveBeenCalledWith("USER#user-123", "USER#user-123");
    });

    it("should return false for user past trial period", async () => {
      const now = new Date("2024-01-20T12:00:00Z");
      vi.setSystemTime(now);

      // User created 10 days ago (past 7-day trial)
      const createdAt = new Date("2024-01-10T12:00:00Z");

      mockGet.mockResolvedValue({
        pk: "USER#user-123",
        sk: "USER#user-123",
        id: "user-123",
        email: "user@example.com",
        type: "USER",
        createdAt: createdAt.toISOString(),
      });

      const result = await isUserInTrialPeriod("user-123");

      expect(result).toBe(false);
    });

    it("should return false for user exactly at trial period boundary", async () => {
      const now = new Date("2024-01-19T12:00:00Z");
      vi.setSystemTime(now);

      // User created exactly 7 days ago (at boundary)
      const createdAt = new Date("2024-01-12T12:00:00Z");

      mockGet.mockResolvedValue({
        pk: "USER#user-123",
        sk: "USER#user-123",
        id: "user-123",
        email: "user@example.com",
        type: "USER",
        createdAt: createdAt.toISOString(),
      });

      const result = await isUserInTrialPeriod("user-123");

      // 7 days = exactly at boundary, should return false (< 7)
      expect(result).toBe(false);
    });

    it("should return false when user not found", async () => {
      mockGet.mockResolvedValue(undefined);

      const result = await isUserInTrialPeriod("user-123");

      expect(result).toBe(false);
    });

    it("should return false when user record missing createdAt", async () => {
      mockGet.mockResolvedValue({
        pk: "USER#user-123",
        sk: "USER#user-123",
        id: "user-123",
        email: "user@example.com",
        type: "USER",
        // Missing createdAt
      });

      const result = await isUserInTrialPeriod("user-123");

      expect(result).toBe(false);
    });

    it("should return false when user record missing email", async () => {
      const createdAt = new Date("2024-01-12T12:00:00Z");

      mockGet.mockResolvedValue({
        pk: "USER#user-123",
        sk: "USER#user-123",
        id: "user-123",
        type: "USER",
        createdAt: createdAt.toISOString(),
        // Missing email
      });

      const result = await isUserInTrialPeriod("user-123");

      expect(result).toBe(false);
    });

    it("should return false when sk doesn't match", async () => {
      const createdAt = new Date("2024-01-12T12:00:00Z");

      mockGet.mockResolvedValue({
        pk: "USER#user-123",
        sk: "USER#different-user", // Doesn't match
        id: "user-123",
        email: "user@example.com",
        type: "USER",
        createdAt: createdAt.toISOString(),
      });

      const result = await isUserInTrialPeriod("user-123");

      expect(result).toBe(false);
    });

    it("should handle database errors gracefully", async () => {
      mockGet.mockRejectedValue(new Error("Database error"));

      const result = await isUserInTrialPeriod("user-123");

      expect(result).toBe(false);
    });
  });

  describe("getTrialDaysRemaining", () => {
    it("should return correct days remaining for user in trial", async () => {
      const now = new Date("2024-01-15T12:00:00Z");
      vi.setSystemTime(now);

      // User created 3 days ago (4 days remaining)
      const createdAt = new Date("2024-01-12T12:00:00Z");

      mockGet.mockResolvedValue({
        pk: "USER#user-123",
        sk: "USER#user-123",
        id: "user-123",
        email: "user@example.com",
        type: "USER",
        createdAt: createdAt.toISOString(),
      });

      const result = await getTrialDaysRemaining("user-123");

      expect(result).toBe(4); // 7 - 3 = 4
    });

    it("should return 0 for user past trial period", async () => {
      const now = new Date("2024-01-20T12:00:00Z");
      vi.setSystemTime(now);

      // User created 10 days ago
      const createdAt = new Date("2024-01-10T12:00:00Z");

      mockGet.mockResolvedValue({
        pk: "USER#user-123",
        sk: "USER#user-123",
        id: "user-123",
        email: "user@example.com",
        type: "USER",
        createdAt: createdAt.toISOString(),
      });

      const result = await getTrialDaysRemaining("user-123");

      expect(result).toBe(0);
    });

    it("should return 0 for user exactly at trial period boundary", async () => {
      const now = new Date("2024-01-19T12:00:00Z");
      vi.setSystemTime(now);

      // User created exactly 7 days ago
      const createdAt = new Date("2024-01-12T12:00:00Z");

      mockGet.mockResolvedValue({
        pk: "USER#user-123",
        sk: "USER#user-123",
        id: "user-123",
        email: "user@example.com",
        type: "USER",
        createdAt: createdAt.toISOString(),
      });

      const result = await getTrialDaysRemaining("user-123");

      expect(result).toBe(0); // 7 - 7 = 0
    });

    it("should return 0 when user not found", async () => {
      mockGet.mockResolvedValue(undefined);

      const result = await getTrialDaysRemaining("user-123");

      expect(result).toBe(0);
    });

    it("should return 0 when user record missing createdAt", async () => {
      mockGet.mockResolvedValue({
        pk: "USER#user-123",
        sk: "USER#user-123",
        id: "user-123",
        email: "user@example.com",
        type: "USER",
        // Missing createdAt
      });

      const result = await getTrialDaysRemaining("user-123");

      expect(result).toBe(0);
    });

    it("should handle database errors gracefully", async () => {
      mockGet.mockRejectedValue(new Error("Database error"));

      const result = await getTrialDaysRemaining("user-123");

      expect(result).toBe(0);
    });

    it("should return correct days for user created today", async () => {
      const now = new Date("2024-01-15T12:00:00Z");
      vi.setSystemTime(now);

      // User created today
      const createdAt = new Date("2024-01-15T10:00:00Z");

      mockGet.mockResolvedValue({
        pk: "USER#user-123",
        sk: "USER#user-123",
        id: "user-123",
        email: "user@example.com",
        type: "USER",
        createdAt: createdAt.toISOString(),
      });

      const result = await getTrialDaysRemaining("user-123");

      // Should be 7 days (or close to it, depending on time of day)
      expect(result).toBeGreaterThanOrEqual(6);
      expect(result).toBeLessThanOrEqual(7);
    });
  });
});


