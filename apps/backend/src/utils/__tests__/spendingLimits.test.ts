import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDatabase, mockQueryUsageStats } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockQueryUsageStats: vi.fn(),
  };
});

// Mock the database module
vi.mock("../../tables/database", () => ({
  database: mockDatabase,
}));

// Mock aggregation module
vi.mock("../aggregation", () => ({
  queryUsageStats: mockQueryUsageStats,
}));

// Import after mocks are set up
import type {
  DatabaseSchema,
  AgentRecord,
  WorkspaceRecord,
} from "../../tables/schema";
import {
  calculateRollingWindow,
  getSpendingInWindow,
  checkSpendingLimits,
} from "../spendingLimits";

describe("spendingLimits", () => {
  let mockDb: DatabaseSchema;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    mockDb = {} as unknown as DatabaseSchema;
    mockDatabase.mockResolvedValue(mockDb);
  });

  describe("calculateRollingWindow", () => {
    it("should calculate daily rolling window (24 hours)", () => {
      const now = new Date("2024-01-15T12:00:00Z");
      vi.setSystemTime(now);

      const startDate = calculateRollingWindow("daily");

      const expected = new Date(now);
      expected.setHours(expected.getHours() - 24);

      expect(startDate.getTime()).toBe(expected.getTime());
    });

    it("should calculate weekly rolling window (7 days)", () => {
      const now = new Date("2024-01-15T12:00:00Z");
      vi.setSystemTime(now);

      const startDate = calculateRollingWindow("weekly");

      const expected = new Date(now);
      expected.setDate(expected.getDate() - 7);

      expect(startDate.getTime()).toBe(expected.getTime());
    });

    it("should calculate monthly rolling window (30 days)", () => {
      const now = new Date("2024-01-15T12:00:00Z");
      vi.setSystemTime(now);

      const startDate = calculateRollingWindow("monthly");

      const expected = new Date(now);
      expected.setDate(expected.getDate() - 30);

      expect(startDate.getTime()).toBe(expected.getTime());
    });

    it("should handle month boundaries correctly", () => {
      const now = new Date("2024-02-01T12:00:00Z");
      vi.setSystemTime(now);

      const startDate = calculateRollingWindow("monthly");

      const expected = new Date(now);
      expected.setDate(expected.getDate() - 30);

      expect(startDate.getTime()).toBe(expected.getTime());
    });
  });

  describe("getSpendingInWindow", () => {
    it("should return spending for workspace in USD", async () => {
      mockQueryUsageStats.mockResolvedValue({
        costUsd: 10_500_000, // 10.5 USD in millionths
        costEur: 9_500_000, // 9.5 EUR in millionths
        costGbp: 8_500_000, // 8.5 GBP in millionths
        inputTokens: 1000,
        outputTokens: 200,
      });

      const startDate = new Date("2024-01-01T00:00:00Z");
      const spending = await getSpendingInWindow(
        mockDb,
        "workspace-123",
        undefined,
        startDate,
        "usd"
      );

      expect(spending).toBe(10_500_000); // millionths
      expect(mockQueryUsageStats).toHaveBeenCalledWith(mockDb, {
        workspaceId: "workspace-123",
        agentId: undefined,
        startDate,
        endDate: expect.any(Date),
      });
    });

    it("should return spending for workspace in EUR", async () => {
      mockQueryUsageStats.mockResolvedValue({
        costUsd: 10_500_000, // 10.5 USD in millionths
        costEur: 9_500_000, // 9.5 EUR in millionths
        costGbp: 8_500_000, // 8.5 GBP in millionths
        inputTokens: 1000,
        outputTokens: 200,
      });

      const startDate = new Date("2024-01-01T00:00:00Z");
      const spending = await getSpendingInWindow(
        mockDb,
        "workspace-123",
        undefined,
        startDate,
        "eur"
      );

      expect(spending).toBe(9_500_000); // millionths
    });

    it("should return spending for workspace in GBP", async () => {
      mockQueryUsageStats.mockResolvedValue({
        costUsd: 10_500_000, // 10.5 USD in millionths
        costEur: 9_500_000, // 9.5 EUR in millionths
        costGbp: 8_500_000, // 8.5 GBP in millionths
        inputTokens: 1000,
        outputTokens: 200,
      });

      const startDate = new Date("2024-01-01T00:00:00Z");
      const spending = await getSpendingInWindow(
        mockDb,
        "workspace-123",
        undefined,
        startDate,
        "gbp"
      );

      expect(spending).toBe(8_500_000); // millionths
    });

    it("should return spending for specific agent", async () => {
      mockQueryUsageStats.mockResolvedValue({
        costUsd: 5_000_000, // 5.0 USD in millionths
        costEur: 4_500_000, // 4.5 EUR in millionths
        costGbp: 4_000_000, // 4.0 GBP in millionths
        inputTokens: 500,
        outputTokens: 100,
      });

      const startDate = new Date("2024-01-01T00:00:00Z");
      const spending = await getSpendingInWindow(
        mockDb,
        "workspace-123",
        "agent-456",
        startDate,
        "usd"
      );

      expect(spending).toBe(5_000_000); // millionths
      expect(mockQueryUsageStats).toHaveBeenCalledWith(mockDb, {
        workspaceId: undefined,
        agentId: "agent-456",
        startDate,
        endDate: expect.any(Date),
      });
    });

    it("should use current date as end date", async () => {
      const now = new Date("2024-01-15T12:00:00Z");
      vi.setSystemTime(now);

      mockQueryUsageStats.mockResolvedValue({
        costUsd: 0,
        costEur: 0,
        costGbp: 0,
        inputTokens: 0,
        outputTokens: 0,
      });

      const startDate = new Date("2024-01-01T00:00:00Z");
      await getSpendingInWindow(
        mockDb,
        "workspace-123",
        undefined,
        startDate,
        "usd"
      );

      const callArgs = mockQueryUsageStats.mock.calls[0][1];
      expect(callArgs.endDate.getTime()).toBe(now.getTime());
    });
  });

  describe("checkSpendingLimits", () => {
    it("should pass when no limits are set", async () => {
      const workspace: WorkspaceRecord = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Test Workspace",
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockQueryUsageStats.mockResolvedValue({
        costUsd: 0,
        costEur: 0,
        costGbp: 0,
        inputTokens: 0,
        outputTokens: 0,
      });

      const result = await checkSpendingLimits(
        mockDb,
        workspace,
        undefined,
        10_000_000 // 10.0 USD in millionths
      );

      expect(result.passed).toBe(true);
      expect(result.failedLimits).toEqual([]);
    });

    it("should pass when spending is under limit", async () => {
      const workspace: WorkspaceRecord = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Test Workspace",
        currency: "usd",
        creditBalance: 0,
        spendingLimits: [{ timeFrame: "daily", amount: 100_000_000 }], // 100.0 USD in millionths
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockQueryUsageStats.mockResolvedValue({
        costUsd: 50_000_000, // 50.0 USD in millionths (current spending)
        costEur: 45_000_000, // 45.0 EUR in millionths
        costGbp: 40_000_000, // 40.0 GBP in millionths
        inputTokens: 5000,
        outputTokens: 1000,
      });

      const result = await checkSpendingLimits(
        mockDb,
        workspace,
        undefined,
        10_000_000 // 10.0 USD in millionths
      );

      expect(result.passed).toBe(true);
      expect(result.failedLimits).toEqual([]);
    });

    it("should fail when estimated cost would exceed limit", async () => {
      const workspace: WorkspaceRecord = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Test Workspace",
        currency: "usd",
        creditBalance: 0,
        spendingLimits: [{ timeFrame: "daily", amount: 100_000_000 }], // 100.0 USD in millionths
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockQueryUsageStats.mockResolvedValue({
        costUsd: 95_000_000, // 95.0 USD in millionths (current spending)
        costEur: 85_000_000, // 85.0 EUR in millionths
        costGbp: 75_000_000, // 75.0 GBP in millionths
        inputTokens: 9500,
        outputTokens: 1900,
      });

      const result = await checkSpendingLimits(
        mockDb,
        workspace,
        undefined,
        10_000_000 // 10.0 USD in millionths
      );

      expect(result.passed).toBe(false);
      expect(result.failedLimits).toHaveLength(1);
      expect(result.failedLimits[0]).toEqual({
        scope: "workspace",
        timeFrame: "daily",
        limit: 100_000_000, // 100.0 USD in millionths
        current: 105_000_000, // 95.0 + 10.0 = 105.0 USD in millionths
      });
    });

    it("should check multiple workspace limits", async () => {
      const workspace: WorkspaceRecord = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Test Workspace",
        currency: "usd",
        creditBalance: 0,
        spendingLimits: [
          { timeFrame: "daily", amount: 50_000_000 }, // 50.0 USD in millionths
          { timeFrame: "weekly", amount: 200_000_000 }, // 200.0 USD in millionths
        ],
        version: 1,
        createdAt: new Date().toISOString(),
      };

      // First call: daily window
      // Second call: weekly window
      mockQueryUsageStats
        .mockResolvedValueOnce({
          costUsd: 60_000_000, // 60.0 USD in millionths (exceeds daily limit)
          costEur: 54_000_000, // 54.0 EUR in millionths
          costGbp: 48_000_000, // 48.0 GBP in millionths
          inputTokens: 6000,
          outputTokens: 1200,
        })
        .mockResolvedValueOnce({
          costUsd: 150_000_000, // 150.0 USD in millionths (under weekly limit)
          costEur: 135_000_000, // 135.0 EUR in millionths
          costGbp: 120_000_000, // 120.0 GBP in millionths
          inputTokens: 15000,
          outputTokens: 3000,
        });

      const result = await checkSpendingLimits(
        mockDb,
        workspace,
        undefined,
        5_000_000 // 5.0 USD in millionths
      );

      expect(result.passed).toBe(false);
      expect(result.failedLimits).toHaveLength(1);
      expect(result.failedLimits[0].timeFrame).toBe("daily");
      // Verify current value is correct: 60.0 + 5.0 = 65.0 USD = 65_000_000 millionths
      expect(result.failedLimits[0].current).toBe(65_000_000);
    });

    it("should check agent spending limits", async () => {
      const workspace: WorkspaceRecord = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Test Workspace",
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      const agent: AgentRecord = {
        pk: "agents/workspace-123/agent-456",
        sk: "agent",
        name: "Test Agent",
        workspaceId: "workspace-123",
        spendingLimits: [{ timeFrame: "daily", amount: 20_000_000 }], // 20.0 USD in millionths
        systemPrompt: "You are helpful",
        provider: "google",
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockQueryUsageStats.mockResolvedValue({
        costUsd: 18_000_000, // 18.0 USD in millionths (current agent spending)
        costEur: 16_000_000, // 16.0 EUR in millionths
        costGbp: 14_000_000, // 14.0 GBP in millionths
        inputTokens: 1800,
        outputTokens: 360,
      });

      const result = await checkSpendingLimits(
        mockDb,
        workspace,
        agent,
        5_000_000
      ); // 5.0 USD in millionths

      expect(result.passed).toBe(false);
      expect(result.failedLimits).toHaveLength(1);
      expect(result.failedLimits[0]).toEqual({
        scope: "agent",
        timeFrame: "daily",
        limit: 20_000_000, // 20.0 USD in millionths
        current: 23_000_000, // 18.0 + 5.0 = 23.0 USD in millionths
      });
    });

    it("should check both workspace and agent limits", async () => {
      const workspace: WorkspaceRecord = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Test Workspace",
        currency: "usd",
        creditBalance: 0,
        spendingLimits: [{ timeFrame: "daily", amount: 100_000_000 }], // 100.0 USD in millionths
        version: 1,
        createdAt: new Date().toISOString(),
      };

      const agent: AgentRecord = {
        pk: "agents/workspace-123/agent-456",
        sk: "agent",
        name: "Test Agent",
        workspaceId: "workspace-123",
        spendingLimits: [{ timeFrame: "daily", amount: 20_000_000 }], // 20.0 USD in millionths
        systemPrompt: "You are helpful",
        provider: "google",
        version: 1,
        createdAt: new Date().toISOString(),
      };

      // First call: workspace daily
      // Second call: agent daily
      mockQueryUsageStats
        .mockResolvedValueOnce({
          costUsd: 50_000_000, // 50.0 USD in millionths (under workspace limit)
          costEur: 45_000_000, // 45.0 EUR in millionths
          costGbp: 40_000_000, // 40.0 GBP in millionths
          inputTokens: 5000,
          outputTokens: 1000,
        })
        .mockResolvedValueOnce({
          costUsd: 18_000_000, // 18.0 USD in millionths (would exceed agent limit with 5.0)
          costEur: 16_000_000, // 16.0 EUR in millionths
          costGbp: 14_000_000, // 14.0 GBP in millionths
          inputTokens: 1800,
          outputTokens: 360,
        });

      const result = await checkSpendingLimits(
        mockDb,
        workspace,
        agent,
        5_000_000
      ); // 5.0 USD in millionths

      expect(result.passed).toBe(false);
      expect(result.failedLimits).toHaveLength(1);
      expect(result.failedLimits[0].scope).toBe("agent");
    });

    it("should handle workspace ID extraction from pk", async () => {
      const workspace: WorkspaceRecord = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Test Workspace",
        currency: "usd",
        creditBalance: 0,
        spendingLimits: [{ timeFrame: "daily", amount: 100_000_000 }], // 100.0 USD in millionths
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockQueryUsageStats.mockResolvedValue({
        costUsd: 0,
        costEur: 0,
        costGbp: 0,
        inputTokens: 0,
        outputTokens: 0,
      });

      await checkSpendingLimits(mockDb, workspace, undefined, 10_000_000); // 10.0 USD in millionths

      expect(mockQueryUsageStats).toHaveBeenCalledWith(
        mockDb,
        expect.objectContaining({
          workspaceId: "workspace-123",
        })
      );
    });

    it("should handle agent ID extraction from pk", async () => {
      const workspace: WorkspaceRecord = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Test Workspace",
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      const agent: AgentRecord = {
        pk: "agents/workspace-123/agent-456",
        sk: "agent",
        name: "Test Agent",
        workspaceId: "workspace-123",
        spendingLimits: [{ timeFrame: "daily", amount: 20_000_000 }], // 20.0 USD in millionths
        systemPrompt: "You are helpful",
        provider: "google",
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockQueryUsageStats.mockResolvedValue({
        costUsd: 0,
        costEur: 0,
        costGbp: 0,
        inputTokens: 0,
        outputTokens: 0,
      });

      await checkSpendingLimits(mockDb, workspace, agent, 10_000_000); // 10.0 USD in millionths

      expect(mockQueryUsageStats).toHaveBeenCalledWith(
        mockDb,
        expect.objectContaining({
          agentId: "agent-456",
        })
      );
    });
  });
});
