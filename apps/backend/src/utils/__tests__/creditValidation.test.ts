import type { ModelMessage } from "ai";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies using vi.hoisted
const {
  mockDatabase,
  mockReserveCredits,
  mockCheckSpendingLimits,
  mockEstimateTokenCost,
  mockIsCreditValidationEnabled,
  mockIsCreditDeductionEnabled,
  mockIsSpendingLimitChecksEnabled,
} = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockReserveCredits: vi.fn(),
    mockCheckSpendingLimits: vi.fn(),
    mockEstimateTokenCost: vi.fn(),
    mockIsCreditValidationEnabled: vi.fn(),
    mockIsCreditDeductionEnabled: vi.fn(),
    mockIsSpendingLimitChecksEnabled: vi.fn(),
  };
});

// Mock the database module
vi.mock("../../tables/database", () => ({
  database: mockDatabase,
}));

// Mock credit management
vi.mock("../creditManagement", () => ({
  reserveCredits: mockReserveCredits,
}));

// Mock spending limits
vi.mock("../spendingLimits", () => ({
  checkSpendingLimits: mockCheckSpendingLimits,
}));

// Mock token estimation
vi.mock("../tokenEstimation", () => ({
  estimateTokenCost: mockEstimateTokenCost,
}));

// Mock feature flags
vi.mock("../featureFlags", () => ({
  isCreditValidationEnabled: mockIsCreditValidationEnabled,
  isCreditDeductionEnabled: mockIsCreditDeductionEnabled,
  isSpendingLimitChecksEnabled: mockIsSpendingLimitChecksEnabled,
}));

// Import after mocks are set up
import type {
  DatabaseSchema,
  WorkspaceRecord,
  AgentRecord,
} from "../../tables/schema";
import {
  InsufficientCreditsError,
  SpendingLimitExceededError,
} from "../creditErrors";
import { validateCreditsAndLimitsAndReserve } from "../creditValidation";

describe("creditValidation", () => {
  let mockDb: DatabaseSchema;
  let mockWorkspace: WorkspaceRecord;
  let mockAgent: AgentRecord;
  let mockGet: ReturnType<typeof vi.fn>;

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

    // Setup mock agent
    mockAgent = {
      pk: "agents/test-workspace/test-agent",
      sk: "agent",
      workspaceId: "test-workspace",
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      version: 1,
      createdAt: new Date().toISOString(),
    } as AgentRecord;

    // Setup mock get
    mockGet = vi.fn().mockImplementation((pk: string) => {
      if (pk === "workspaces/test-workspace") {
        return Promise.resolve(mockWorkspace);
      }
      if (pk === "agents/test-workspace/test-agent") {
        return Promise.resolve(mockAgent);
      }
      return Promise.resolve(undefined);
    });

    // Setup mock database
    mockDb = {
      workspace: {
        get: mockGet,
      },
      agent: {
        get: mockGet,
      },
    } as unknown as DatabaseSchema;

    mockDatabase.mockResolvedValue(mockDb);

    // Default feature flag values
    mockIsCreditValidationEnabled.mockReturnValue(true);
    mockIsCreditDeductionEnabled.mockReturnValue(true);
    mockIsSpendingLimitChecksEnabled.mockReturnValue(true);

    // Default mocks (all values in millionths)
    mockEstimateTokenCost.mockReturnValue(10_000_000); // 10.0 USD in millionths
    mockCheckSpendingLimits.mockResolvedValue({
      passed: true,
      failedLimits: [],
    });
    mockReserveCredits.mockResolvedValue({
      reservationId: "test-reservation",
      reservedAmount: 10_000_000, // 10.0 USD in millionths
      workspace: mockWorkspace,
    });
  });

  describe("validateCreditsAndLimitsAndReserve", () => {
    const messages: ModelMessage[] = [{ role: "user", content: "Hello" }];

    it("should successfully validate and reserve credits", async () => {
      const result = await validateCreditsAndLimitsAndReserve(
        mockDb,
        "test-workspace",
        "test-agent",
        "google",
        "gemini-2.5-flash",
        messages,
        "System prompt",
        [],
        false
      );

      expect(result).not.toBeNull();
      expect(result?.reservationId).toBe("test-reservation");
      expect(mockEstimateTokenCost).toHaveBeenCalled();
      expect(mockCheckSpendingLimits).toHaveBeenCalled();
      expect(mockReserveCredits).toHaveBeenCalled();
    });

    it("should skip validation for BYOK requests", async () => {
      const result = await validateCreditsAndLimitsAndReserve(
        mockDb,
        "test-workspace",
        "test-agent",
        "google",
        "gemini-2.5-flash",
        messages,
        "System prompt",
        [],
        true // usesByok
      );

      expect(result).toBeNull();
      expect(mockReserveCredits).not.toHaveBeenCalled();
    });

    it("should throw InsufficientCreditsError when credits are insufficient", async () => {
      mockReserveCredits.mockRejectedValue(
        new InsufficientCreditsError("test-workspace", 150.0, 100.0, "usd")
      );

      await expect(
        validateCreditsAndLimitsAndReserve(
          mockDb,
          "test-workspace",
          "test-agent",
          "google",
          "gemini-2.5-flash",
          messages,
          "System prompt",
          [],
          false
        )
      ).rejects.toThrow(InsufficientCreditsError);
    });

    it("should throw SpendingLimitExceededError when limits are exceeded", async () => {
      mockCheckSpendingLimits.mockResolvedValue({
        passed: false,
        failedLimits: [
          {
            scope: "workspace",
            timeFrame: "daily",
            limit: 50.0,
            current: 60.0,
          },
        ],
      });

      await expect(
        validateCreditsAndLimitsAndReserve(
          mockDb,
          "test-workspace",
          "test-agent",
          "google",
          "gemini-2.5-flash",
          messages,
          "System prompt",
          [],
          false
        )
      ).rejects.toThrow(SpendingLimitExceededError);
    });

    it("should skip credit validation when feature flag is disabled", async () => {
      mockIsCreditValidationEnabled.mockReturnValue(false);
      mockIsCreditDeductionEnabled.mockReturnValue(false); // Disable deduction to get null result
      mockIsSpendingLimitChecksEnabled.mockReturnValue(true);

      const result = await validateCreditsAndLimitsAndReserve(
        mockDb,
        "test-workspace",
        "test-agent",
        "google",
        "gemini-2.5-flash",
        messages,
        "System prompt",
        [],
        false
      );

      expect(result).toBeNull();
      expect(mockReserveCredits).not.toHaveBeenCalled();
      expect(mockCheckSpendingLimits).toHaveBeenCalled();
    });

    it("should create reservation when validation disabled but deduction enabled", async () => {
      mockIsCreditValidationEnabled.mockReturnValue(false);
      mockIsCreditDeductionEnabled.mockReturnValue(true); // Deduction enabled
      mockIsSpendingLimitChecksEnabled.mockReturnValue(true);

      const result = await validateCreditsAndLimitsAndReserve(
        mockDb,
        "test-workspace",
        "test-agent",
        "google",
        "gemini-2.5-flash",
        messages,
        "System prompt",
        [],
        false
      );

      // Should still create reservation even though validation is disabled
      expect(result).not.toBeNull();
      expect(result?.reservationId).toBe("test-reservation");
      expect(mockReserveCredits).toHaveBeenCalled();
      expect(mockCheckSpendingLimits).toHaveBeenCalled();
    });

    it("should skip all checks when both feature flags are disabled", async () => {
      mockIsCreditValidationEnabled.mockReturnValue(false);
      mockIsCreditDeductionEnabled.mockReturnValue(false);
      mockIsSpendingLimitChecksEnabled.mockReturnValue(false);

      const result = await validateCreditsAndLimitsAndReserve(
        mockDb,
        "test-workspace",
        "test-agent",
        "google",
        "gemini-2.5-flash",
        messages,
        "System prompt",
        [],
        false
      );

      expect(result).toBeNull();
      expect(mockReserveCredits).not.toHaveBeenCalled();
      expect(mockCheckSpendingLimits).not.toHaveBeenCalled();
    });

    it("should skip spending limit checks when feature flag is disabled", async () => {
      mockIsCreditValidationEnabled.mockReturnValue(true);
      mockIsSpendingLimitChecksEnabled.mockReturnValue(false);

      const result = await validateCreditsAndLimitsAndReserve(
        mockDb,
        "test-workspace",
        "test-agent",
        "google",
        "gemini-2.5-flash",
        messages,
        "System prompt",
        [],
        false
      );

      expect(result).not.toBeNull();
      expect(mockCheckSpendingLimits).not.toHaveBeenCalled();
      expect(mockReserveCredits).toHaveBeenCalled();
    });

    it("should throw error when workspace is not found", async () => {
      mockGet.mockResolvedValue(undefined);

      await expect(
        validateCreditsAndLimitsAndReserve(
          mockDb,
          "test-workspace",
          "test-agent",
          "google",
          "gemini-2.5-flash",
          messages,
          "System prompt",
          [],
          false
        )
      ).rejects.toThrow("Workspace test-workspace not found");
    });

    it("should throw error when agent is not found", async () => {
      mockGet.mockImplementation((pk: string) => {
        if (pk === "workspaces/test-workspace") {
          return Promise.resolve(mockWorkspace);
        }
        return Promise.resolve(undefined);
      });

      await expect(
        validateCreditsAndLimitsAndReserve(
          mockDb,
          "test-workspace",
          "test-agent",
          "google",
          "gemini-2.5-flash",
          messages,
          "System prompt",
          [],
          false
        )
      ).rejects.toThrow("Agent test-agent not found");
    });

    it("should work without agent ID", async () => {
      const result = await validateCreditsAndLimitsAndReserve(
        mockDb,
        "test-workspace",
        undefined,
        "google",
        "gemini-2.5-flash",
        messages,
        "System prompt",
        [],
        false
      );

      expect(result).not.toBeNull();
      expect(mockCheckSpendingLimits).toHaveBeenCalledWith(
        mockDb,
        mockWorkspace,
        undefined,
        10_000_000 // 10.0 USD in millionths
      );
    });

    it("should pass correct parameters to estimateTokenCost", async () => {
      await validateCreditsAndLimitsAndReserve(
        mockDb,
        "test-workspace",
        "test-agent",
        "google",
        "gemini-2.5-flash",
        messages,
        "System prompt",
        [{ name: "tool1" }],
        false
      );

      expect(mockEstimateTokenCost).toHaveBeenCalledWith(
        "google",
        "gemini-2.5-flash",
        messages,
        "System prompt",
        [{ name: "tool1" }]
      );
    });

    it("should pass correct parameters to checkSpendingLimits", async () => {
      await validateCreditsAndLimitsAndReserve(
        mockDb,
        "test-workspace",
        "test-agent",
        "google",
        "gemini-2.5-flash",
        messages,
        "System prompt",
        [],
        false
      );

      expect(mockCheckSpendingLimits).toHaveBeenCalledWith(
        mockDb,
        mockWorkspace,
        mockAgent,
        10_000_000 // 10.0 USD in millionths
      );
    });

    it("should pass correct parameters to reserveCredits", async () => {
      await validateCreditsAndLimitsAndReserve(
        mockDb,
        "test-workspace",
        "test-agent",
        "google",
        "gemini-2.5-flash",
        messages,
        "System prompt",
        [],
        false
      );

      expect(mockReserveCredits).toHaveBeenCalledWith(
        mockDb,
        "test-workspace",
        10_000_000, // 10.0 USD in millionths
        3,
        false,
        undefined, // context (optional)
        "google", // provider
        "gemini-2.5-flash", // modelName
        "test-agent", // agentId
        undefined // conversationId (optional)
      );
    });

    it("should handle multiple failed spending limits", async () => {
      mockCheckSpendingLimits.mockResolvedValue({
        passed: false,
        failedLimits: [
          {
            scope: "workspace",
            timeFrame: "daily",
            limit: 50.0,
            current: 60.0,
          },
          {
            scope: "agent",
            timeFrame: "monthly",
            limit: 200.0,
            current: 250.0,
          },
        ],
      });

      await expect(
        validateCreditsAndLimitsAndReserve(
          mockDb,
          "test-workspace",
          "test-agent",
          "google",
          "gemini-2.5-flash",
          messages,
          "System prompt",
          [],
          false
        )
      ).rejects.toThrow(SpendingLimitExceededError);

      const error = await validateCreditsAndLimitsAndReserve(
        mockDb,
        "test-workspace",
        "test-agent",
        "google",
        "gemini-2.5-flash",
        messages,
        "System prompt",
        [],
        false
      ).catch((e) => e);

      expect(error).toBeInstanceOf(SpendingLimitExceededError);
      expect(error.failedLimits).toHaveLength(2);
    });
  });
});
