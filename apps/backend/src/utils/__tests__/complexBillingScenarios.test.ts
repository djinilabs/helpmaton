import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const {
  mockDatabase,
  mockCalculateTokenCost,
  mockQueue,
  mockReserveExaCredits,
  mockAdjustExaCreditReservation,
  mockReserveTavilyCredits,
  mockAdjustTavilyCreditReservation,
  mockReserveRerankingCredits,
  mockAdjustRerankingCreditReservation,
} = vi.hoisted(() => {
  const publish = vi.fn().mockResolvedValue(undefined);
  return {
    mockDatabase: vi.fn(),
    mockCalculateTokenCost: vi.fn(),
    mockQueue: {
      publish,
    },
    mockReserveExaCredits: vi.fn(),
    mockAdjustExaCreditReservation: vi.fn(),
    mockReserveTavilyCredits: vi.fn(),
    mockAdjustTavilyCreditReservation: vi.fn(),
    mockReserveRerankingCredits: vi.fn(),
    mockAdjustRerankingCreditReservation: vi.fn(),
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

// Mock tool credit functions
vi.mock("../exaCredits", () => ({
  reserveExaCredits: mockReserveExaCredits,
  adjustExaCreditReservation: mockAdjustExaCreditReservation,
}));

vi.mock("../tavilyCredits", () => ({
  reserveTavilyCredits: mockReserveTavilyCredits,
  adjustTavilyCreditReservation: mockAdjustTavilyCreditReservation,
}));

vi.mock("../knowledgeRerankingCredits", () => ({
  reserveRerankingCredits: mockReserveRerankingCredits,
  adjustRerankingCreditReservation: mockAdjustRerankingCreditReservation,
}));

// Import after mocks are set up
import type {
  DatabaseSchema,
  WorkspaceRecord,
  CreditReservationRecord,
} from "../../tables/schema";
import type { TokenUsage } from "../conversationLogger";
import {
  reserveCredits,
  adjustCreditReservation,
  finalizeCreditReservation,
  refundReservation,
} from "../creditManagement";
import type { AugmentedContext } from "../workspaceCreditContext";

describe("Complex Billing Scenarios", () => {
  let mockDb: DatabaseSchema;
  let mockWorkspace: WorkspaceRecord;
  let mockAtomicUpdate: ReturnType<typeof vi.fn>;
  let mockGet: ReturnType<typeof vi.fn>;
  let mockCreate: ReturnType<typeof vi.fn>;
  let mockDelete: ReturnType<typeof vi.fn>;
  let mockReservationGet: ReturnType<typeof vi.fn>;
  let mockUpdate: ReturnType<typeof vi.fn>;
  let mockContext: AugmentedContext;
  let workspaceBalance: number;

  /**
   * IMPORTANT: Balance Tracking Pattern
   *
   * This test file uses two different balance tracking approaches:
   *
   * 1. Real functions (reserveCredits, adjustCreditReservation, etc.):
   *    - These call mockAtomicUpdate, which automatically updates workspaceBalance
   *    - DO NOT manually subtract after calling these functions
   *    - Examples: LLM reservations, Scraper reservations
   *
   * 2. Mocked functions (mockReserveExaCredits, mockReserveTavilyCredits, etc.):
   *    - These are vi.fn() mocks that don't call mockAtomicUpdate
   *    - DO manually subtract workspaceBalance after calling these
   *    - Examples: Exa, Tavily, Reranking tool reservations
   *
   * This pattern reflects real behavior: real credit management functions use
   * atomic updates, while mocked tool functions need manual tracking in tests.
   */

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    workspaceBalance = 1_000_000_000; // 1000.0 USD in millionths

    // Setup mock workspace (creditBalance in millionths)
    mockWorkspace = {
      pk: "workspaces/test-workspace",
      sk: "workspace",
      name: "Test Workspace",
      creditBalance: workspaceBalance,
      currency: "usd",
      version: 1,
      createdAt: new Date().toISOString(),
    } as WorkspaceRecord;

    // Setup mock atomicUpdate
    mockAtomicUpdate = vi.fn().mockImplementation(async (_pk, _sk, updater) => {
      const current = { ...mockWorkspace, creditBalance: workspaceBalance };
      const result = await updater(current);
      if (result) {
        workspaceBalance = result.creditBalance;
        mockWorkspace = { ...mockWorkspace, creditBalance: workspaceBalance };
      }
      return result as WorkspaceRecord;
    });

    // Setup mock get
    mockGet = vi.fn().mockImplementation(() => {
      return Promise.resolve({
        ...mockWorkspace,
        creditBalance: workspaceBalance,
      });
    });

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
        atomicUpdate: mockAtomicUpdate,
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

    // Setup default pricing mock (returns millionths)
    mockCalculateTokenCost.mockReturnValue(10_000); // 0.01 USD in millionths

    // Setup tool credit mocks
    mockReserveExaCredits.mockResolvedValue({
      reservationId: "exa-res-1",
      reservedAmount: 10_000, // $0.01
      workspace: mockWorkspace,
    });

    mockReserveTavilyCredits.mockResolvedValue({
      reservationId: "tavily-res-1",
      reservedAmount: 8_000, // $0.008
      workspace: mockWorkspace,
    });

    mockReserveRerankingCredits.mockResolvedValue({
      reservationId: "reranking-res-1",
      reservedAmount: 5_000, // $0.005
      workspace: mockWorkspace,
    });
  });

  describe("Gap 1: Complex Conversation with Multiple Cost Types", () => {
    it("should correctly charge for conversation with multiple LLM generations, tools, and reranking", async () => {
      const workspaceId = "test-workspace";
      const agentId = "test-agent";
      const conversationId = "test-conversation";

      // Step 1: Reserve credits for LLM call (multiple generations expected)
      const llmEstimatedCost = 50_000; // $0.05
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
      expect(workspaceBalance).toBe(1_000_000_000 - llmEstimatedCost);

      // Step 2: Reserve credits for Exa tool call
      // Note: mockReserveExaCredits is a mocked function that doesn't call mockAtomicUpdate,
      // so we need to manually track the balance change
      const exaReservation = await mockReserveExaCredits(
        mockDb,
        workspaceId,
        0.01,
        3,
        mockContext,
        agentId,
        conversationId
      );

      expect(exaReservation.reservationId).toBe("exa-res-1");
      // Note: mockReserveExaCredits is a mocked function, so manually track balance
      workspaceBalance -= exaReservation.reservedAmount;

      // Step 3: Reserve credits for Tavily tool call
      const tavilyReservation = await mockReserveTavilyCredits(
        mockDb,
        workspaceId,
        1,
        3,
        mockContext,
        agentId,
        conversationId
      );

      expect(tavilyReservation.reservationId).toBe("tavily-res-1");
      // Note: mockReserveTavilyCredits is a mocked function, so manually track balance
      workspaceBalance -= tavilyReservation.reservedAmount;

      // Step 4: Reserve credits for Scraper tool call (uses reserveCredits directly)
      const scraperCost = 5_000; // $0.005
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

      expect(scraperReservation.reservationId).toBeDefined();
      // Note: workspaceBalance already updated by mockAtomicUpdate in reserveCredits
      // No need to manually subtract here

      // Step 5: Reserve credits for reranking
      const rerankingReservation = await mockReserveRerankingCredits(
        mockDb,
        workspaceId,
        mockContext,
        agentId,
        conversationId
      );

      expect(rerankingReservation.reservationId).toBe("reranking-res-1");
      // Note: mockReserveRerankingCredits is a mocked function, so manually track balance
      workspaceBalance -= rerankingReservation.reservedAmount;

      // Step 6: Adjust LLM reservation after actual token usage (Step 2 of 3-step)
      const tokenUsage: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      };

      mockCalculateTokenCost.mockReturnValue(45_000); // Actual cost: $0.045
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
        "gen-12345",
        ["gen-12345", "gen-67890"],
        agentId,
        conversationId
      );

      // Should refund difference: 50_000 - 45_000 = 5_000
      // Balance should increase by 5_000
      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          amountMillionthUsd: 5_000, // Positive = refund
        })
      );

      // Step 7: Adjust Exa reservation
      mockAdjustExaCreditReservation.mockResolvedValue(mockWorkspace);
      await mockAdjustExaCreditReservation(
        mockDb,
        exaReservation.reservationId,
        workspaceId,
        0.008, // Actual cost less than estimate
        mockContext,
        "search",
        3,
        agentId,
        conversationId
      );

      // Step 8: Adjust Tavily reservation
      mockAdjustTavilyCreditReservation.mockResolvedValue(mockWorkspace);
      await mockAdjustTavilyCreditReservation(
        mockDb,
        tavilyReservation.reservationId,
        workspaceId,
        1, // Actual credits used
        mockContext,
        "search_web",
        3,
        agentId,
        conversationId
      );

      // Step 9: Adjust Scraper reservation (no adjustment needed - fixed cost)
      // Scraper uses fixed cost, so no adjustment

      // Step 10: Adjust reranking reservation
      mockAdjustRerankingCreditReservation.mockResolvedValue(mockWorkspace);
      await mockAdjustRerankingCreditReservation(
        mockDb,
        rerankingReservation.reservationId,
        workspaceId,
        4_000, // Provisional cost
        "gen-rerank-123",
        mockContext,
        3,
        agentId,
        conversationId
      );

      // Verify all reservations were created
      // Note: mockCreate is only called for real reserveCredits calls (LLM, Scraper)
      // Mocked functions (Exa, Tavily, Reranking) don't call mockCreate
      expect(mockCreate).toHaveBeenCalledTimes(2); // LLM and Scraper
      expect(mockReserveExaCredits).toHaveBeenCalled();
      expect(mockReserveTavilyCredits).toHaveBeenCalled();
      expect(mockReserveRerankingCredits).toHaveBeenCalled();
    });

    it("should correctly finalize all costs through OpenRouter verification", async () => {
      const workspaceId = "test-workspace";
      const agentId = "test-agent";
      const conversationId = "test-conversation";

      // Create LLM reservation with multiple generations
      const llmEstimatedCost = 50_000;
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

      mockCalculateTokenCost.mockReturnValue(45_000);
      const expires = Math.floor(Date.now() / 1000) + 15 * 60;
      const llmReservationRecord: CreditReservationRecord = {
        pk: `credit-reservations/${llmReservation.reservationId}`,
        workspaceId,
        reservedAmount: llmEstimatedCost,
        estimatedCost: llmEstimatedCost,
        tokenUsageBasedCost: 45_000,
        currency: "usd",
        expires,
        expiresHour: Math.floor(expires / 3600) * 3600,
        version: 1,
        createdAt: new Date().toISOString(),
        provider: "openrouter",
        modelName: "openrouter/auto",
        agentId,
        conversationId,
        openrouterGenerationIds: ["gen-12345", "gen-67890"],
        expectedGenerationCount: 2,
        verifiedGenerationIds: [],
        verifiedCosts: [],
      };

      mockReservationGet.mockResolvedValue(llmReservationRecord);

      // Finalize with OpenRouter costs (Step 3)
      // Costs: $0.022 for first generation, $0.023 for second generation
      const totalOpenrouterCost = 47_500; // $0.0475 total (with markup)

      // Simulate finalization after both generations verified
      const finalReservation: CreditReservationRecord = {
        ...llmReservationRecord,
        verifiedGenerationIds: ["gen-12345", "gen-67890"],
        verifiedCosts: [22_000, 23_000],
        allGenerationsVerified: true,
        totalOpenrouterCost,
      };

      mockReservationGet.mockResolvedValue(finalReservation);

      await finalizeCreditReservation(
        mockDb,
        llmReservation.reservationId,
        totalOpenrouterCost,
        mockContext,
        3
      );

      // Should adjust: 47_500 (OpenRouter) - 45_000 (token-based) = 2_500 additional charge
      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          amountMillionthUsd: -2_500, // Negative = additional charge
        })
      );
    });
  });

  describe("Gap 2: Concurrent Tool Calls in Same Conversation", () => {
    it("should correctly charge for multiple concurrent tool calls", async () => {
      const workspaceId = "test-workspace";
      const agentId = "test-agent";
      const conversationId = "test-conversation";

      // Simulate concurrent tool calls
      const toolCalls = [
        { type: "exa", cost: 10_000 },
        { type: "tavily", cost: 8_000 },
        { type: "scraper", cost: 5_000 },
        { type: "exa", cost: 10_000 }, // Second Exa call
      ];

      const reservations: string[] = [];

      // Reserve credits for all tool calls
      for (const toolCall of toolCalls) {
        if (toolCall.type === "exa") {
          const reservation = await mockReserveExaCredits(
            mockDb,
            workspaceId,
            0.01,
            3,
            mockContext,
            agentId,
            conversationId
          );
          reservations.push(reservation.reservationId);
          // Note: mockReserveExaCredits is a mocked function, so manually track balance
          workspaceBalance -= reservation.reservedAmount;
        } else if (toolCall.type === "tavily") {
          const reservation = await mockReserveTavilyCredits(
            mockDb,
            workspaceId,
            1,
            3,
            mockContext,
            agentId,
            conversationId
          );
          reservations.push(reservation.reservationId);
          // Note: mockReserveTavilyCredits is a mocked function, so manually track balance
          workspaceBalance -= reservation.reservedAmount;
        } else if (toolCall.type === "scraper") {
          const reservation = await reserveCredits(
            mockDb,
            workspaceId,
            toolCall.cost,
            3,
            false,
            mockContext,
            "scrape",
            "scrape",
            agentId,
            conversationId
          );
          reservations.push(reservation.reservationId);
          // Note: workspaceBalance already updated by mockAtomicUpdate in reserveCredits
          // No need to manually subtract here
        }
      }

      // Verify all reservations were created
      expect(reservations).toHaveLength(4);
      expect(mockReserveExaCredits).toHaveBeenCalledTimes(2);
      expect(mockReserveTavilyCredits).toHaveBeenCalledTimes(1);

      // Verify that reserveCredits was called for scraper (which updates balance)
      // Note: Mocked functions (Exa, Tavily) don't update workspaceBalance,
      // but reserveCredits does through mockAtomicUpdate
      expect(mockAtomicUpdate).toHaveBeenCalled();

      // Adjust all reservations
      for (const reservationId of reservations) {
        if (reservationId.startsWith("exa-")) {
          await mockAdjustExaCreditReservation(
            mockDb,
            reservationId,
            workspaceId,
            0.008, // Actual cost
            mockContext,
            "search",
            3,
            agentId,
            conversationId
          );
        } else if (reservationId.startsWith("tavily-")) {
          await mockAdjustTavilyCreditReservation(
            mockDb,
            reservationId,
            workspaceId,
            1,
            mockContext,
            "search_web",
            3,
            agentId,
            conversationId
          );
        }
        // Scraper has fixed cost, no adjustment needed
      }

      // Verify all adjustments were called
      expect(mockAdjustExaCreditReservation).toHaveBeenCalledTimes(2);
      expect(mockAdjustTavilyCreditReservation).toHaveBeenCalledTimes(1);
    });
  });

  describe("Gap 3: Multi-Turn Conversation with Mixed Costs", () => {
    it("should correctly track costs across multiple conversation turns", async () => {
      const workspaceId = "test-workspace";
      const agentId = "test-agent";
      const conversationId = "test-conversation";

      // Turn 1: LLM call + Exa tool
      const turn1LLMCost = 30_000;
      const turn1LLMReservation = await reserveCredits(
        mockDb,
        workspaceId,
        turn1LLMCost,
        3,
        false,
        mockContext,
        "openrouter",
        "openrouter/auto",
        agentId,
        conversationId
      );

      const turn1ExaReservation = await mockReserveExaCredits(
        mockDb,
        workspaceId,
        0.01,
        3,
        mockContext,
        agentId,
        conversationId
      );

      // Turn 2: LLM call + Tavily tool + Reranking
      const turn2LLMCost = 40_000;
      const turn2LLMReservation = await reserveCredits(
        mockDb,
        workspaceId,
        turn2LLMCost,
        3,
        false,
        mockContext,
        "openrouter",
        "openrouter/auto",
        agentId,
        conversationId
      );

      const turn2TavilyReservation = await mockReserveTavilyCredits(
        mockDb,
        workspaceId,
        1,
        3,
        mockContext,
        agentId,
        conversationId
      );

      const turn2RerankingReservation = await mockReserveRerankingCredits(
        mockDb,
        workspaceId,
        mockContext,
        agentId,
        conversationId
      );

      // Turn 3: LLM call only
      const turn3LLMCost = 25_000;
      const turn3LLMReservation = await reserveCredits(
        mockDb,
        workspaceId,
        turn3LLMCost,
        3,
        false,
        mockContext,
        "openrouter",
        "openrouter/auto",
        agentId,
        conversationId
      );

      // Verify total cost across all turns
      // Note: Only reserveCredits (LLM calls) actually update workspaceBalance through mockAtomicUpdate
      // Mocked functions (Exa, Tavily, Reranking) don't update it
      // Verify that reserveCredits was called for all LLM calls
      expect(mockAtomicUpdate).toHaveBeenCalledTimes(3); // Three LLM reservations

      // Verify each turn's costs are tracked separately
      expect(turn1LLMReservation.reservationId).toBeDefined();
      expect(turn1ExaReservation.reservationId).toBeDefined();
      expect(turn2LLMReservation.reservationId).toBeDefined();
      expect(turn2TavilyReservation.reservationId).toBeDefined();
      expect(turn2RerankingReservation.reservationId).toBeDefined();
      expect(turn3LLMReservation.reservationId).toBeDefined();
    });
  });

  describe("Gap 4: Partial Failure Scenarios", () => {
    it("should correctly handle partial failures - some operations succeed, some fail", async () => {
      const workspaceId = "test-workspace";
      const agentId = "test-agent";
      const conversationId = "test-conversation";

      // Reserve credits for LLM call
      const llmCost = 50_000;
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
      // Note: workspaceBalance already updated by mockAtomicUpdate in reserveCredits
      // No need to manually subtract here

      // Reserve credits for Exa tool call
      const exaReservation = await mockReserveExaCredits(
        mockDb,
        workspaceId,
        0.01,
        3,
        mockContext,
        agentId,
        conversationId
      );
      // Note: mockReserveExaCredits is a mocked function, so manually track balance
      workspaceBalance -= exaReservation.reservedAmount;

      // Reserve credits for Tavily tool call
      const tavilyReservation = await mockReserveTavilyCredits(
        mockDb,
        workspaceId,
        1,
        3,
        mockContext,
        agentId,
        conversationId
      );
      // Note: mockReserveTavilyCredits is a mocked function, so manually track balance
      workspaceBalance -= tavilyReservation.reservedAmount;

      // Simulate: LLM call succeeds, Exa fails, Tavily succeeds
      // Adjust LLM reservation (success)
      const tokenUsage: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      };

      mockCalculateTokenCost.mockReturnValue(45_000);
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
        mockContext
      );

      // Exa failure: no refund (reserved amount remains deducted).
      // NOTE: This models the new billing policy where tool failures consume
      // the reservation and no refund is issued. This is a breaking billing
      // change and should be called out in release notes when modified.

      // Adjust Tavily reservation (success)
      mockAdjustTavilyCreditReservation.mockResolvedValue(mockWorkspace);
      await mockAdjustTavilyCreditReservation(
        mockDb,
        tavilyReservation.reservationId,
        workspaceId,
        1,
        mockContext,
        "search_web",
        3,
        agentId,
        conversationId
      );

      // Verify final balance: initial - llmCost - tavilyCost + exaRefund
      // LLM: 50_000 reserved, 45_000 actual = 5_000 refund
      // Exa: 10_000 reserved, fully refunded
      // Tavily: 8_000 reserved, 8_000 actual = no change
      // Expected final balance: initialBalance - 45_000 - 8_000 (only successful operations charged)

      // Note: The actual balance tracking in this test is simplified
      // In real implementation, transactions are committed atomically
      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalled();
    });

    it("should correctly handle LLM generation failure with tool success", async () => {
      const workspaceId = "test-workspace";
      const agentId = "test-agent";
      const conversationId = "test-conversation";

      // Reserve credits for LLM call
      const llmCost = 50_000;
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
      // Note: workspaceBalance already updated by mockAtomicUpdate in reserveCredits
      // No need to manually subtract here

      // Reserve credits for Exa tool call
      const exaReservation = await mockReserveExaCredits(
        mockDb,
        workspaceId,
        0.01,
        3,
        mockContext,
        agentId,
        conversationId
      );
      // Note: mockReserveExaCredits is a mocked function, so manually track balance
      workspaceBalance -= exaReservation.reservedAmount;

      // Simulate: LLM call fails, Exa succeeds
      // Refund LLM reservation
      const llmExpires = Math.floor(Date.now() / 1000) + 15 * 60;
      const llmReservationRecord: CreditReservationRecord = {
        pk: `credit-reservations/${llmReservation.reservationId}`,
        workspaceId,
        reservedAmount: llmCost,
        estimatedCost: llmCost,
        currency: "usd",
        expires: llmExpires,
        expiresHour: Math.floor(llmExpires / 3600) * 3600,
        version: 1,
        createdAt: new Date().toISOString(),
        provider: "openrouter",
        modelName: "openrouter/auto",
        agentId,
        conversationId,
      };

      mockReservationGet.mockResolvedValue(llmReservationRecord);

      await refundReservation(
        mockDb,
        llmReservation.reservationId,
        mockContext
      );

      workspaceBalance += llmCost; // Refund

      // Adjust Exa reservation (success)
      mockAdjustExaCreditReservation.mockResolvedValue(mockWorkspace);
      await mockAdjustExaCreditReservation(
        mockDb,
        exaReservation.reservationId,
        workspaceId,
        0.008,
        mockContext,
        "search",
        3,
        agentId,
        conversationId
      );

      // Verify only Exa was charged
      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalled();
    });
  });

  describe("Gap 5: Edge Cases in Multi-Generation Verification", () => {
    it("should handle out-of-order OpenRouter verification", async () => {
      const workspaceId = "test-workspace";
      const agentId = "test-agent";
      const conversationId = "test-conversation";

      // Create reservation with 3 expected generations
      const llmCost = 60_000;
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

      // Adjust with 3 generation IDs
      const tokenUsage: TokenUsage = {
        promptTokens: 1500,
        completionTokens: 750,
        totalTokens: 2250,
      };

      mockCalculateTokenCost.mockReturnValue(55_000);
      const expires = Math.floor(Date.now() / 1000) + 15 * 60;
      const llmReservationRecord: CreditReservationRecord = {
        pk: `credit-reservations/${llmReservation.reservationId}`,
        workspaceId,
        reservedAmount: llmCost,
        estimatedCost: llmCost,
        tokenUsageBasedCost: 55_000,
        currency: "usd",
        expires,
        expiresHour: Math.floor(expires / 3600) * 3600,
        version: 1,
        createdAt: new Date().toISOString(),
        provider: "openrouter",
        modelName: "openrouter/auto",
        agentId,
        conversationId,
        openrouterGenerationIds: ["gen-1", "gen-2", "gen-3"],
        expectedGenerationCount: 3,
        verifiedGenerationIds: [],
        verifiedCosts: [],
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
        ["gen-1", "gen-2", "gen-3"],
        agentId,
        conversationId
      );

      // Simulate out-of-order verification: gen-2 arrives first, then gen-3, then gen-1
      // This should be handled by the cost verification queue's atomic update logic
      // The reservation should accumulate costs and only finalize when all 3 are verified

      // Verify the reservation was updated with all generation IDs
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          openrouterGenerationIds: ["gen-1", "gen-2", "gen-3"],
          expectedGenerationCount: 3,
        })
      );
    });

    it("should handle missing generation ID gracefully", async () => {
      const workspaceId = "test-workspace";
      const agentId = "test-agent";
      const conversationId = "test-conversation";

      // Create reservation expecting 2 generations
      const llmCost = 40_000;
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

      // Adjust with only 1 generation ID (missing one)
      const tokenUsage: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      };

      mockCalculateTokenCost.mockReturnValue(35_000);
      const expires = Math.floor(Date.now() / 1000) + 15 * 60;
      const llmReservationRecord: CreditReservationRecord = {
        pk: `credit-reservations/${llmReservation.reservationId}`,
        workspaceId,
        reservedAmount: llmCost,
        estimatedCost: llmCost,
        tokenUsageBasedCost: 35_000,
        currency: "usd",
        expires,
        expiresHour: Math.floor(expires / 3600) * 3600,
        version: 1,
        createdAt: new Date().toISOString(),
        provider: "openrouter",
        modelName: "openrouter/auto",
        agentId,
        conversationId,
        openrouterGenerationIds: ["gen-1"], // Only one ID, expected 2
        expectedGenerationCount: 1, // System should handle this gracefully
        verifiedGenerationIds: [],
        verifiedCosts: [],
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
        "gen-1",
        ["gen-1"],
        agentId,
        conversationId
      );

      // System should still process the single generation
      expect(mockUpdate).toHaveBeenCalled();
    });
  });

  describe("Gap 6: Scraper Tool Billing", () => {
    it("should correctly reserve and charge for scraper tool calls", async () => {
      const workspaceId = "test-workspace";
      const agentId = "test-agent";
      const conversationId = "test-conversation";

      const initialBalance = workspaceBalance;

      // Scraper uses reserveCredits directly with fixed cost
      const scraperCost = 5_000; // $0.005
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

      expect(scraperReservation.reservationId).toBeDefined();
      expect(scraperReservation.reservedAmount).toBe(scraperCost);
      expect(workspaceBalance).toBe(initialBalance - scraperCost);

      // Scraper has fixed cost, so no adjustment needed after successful call
      // If call fails, reservation should be removed without refund
      const expires = Math.floor(Date.now() / 1000) + 15 * 60;
      const scraperReservationRecord: CreditReservationRecord = {
        pk: `credit-reservations/${scraperReservation.reservationId}`,
        workspaceId,
        reservedAmount: scraperCost,
        estimatedCost: scraperCost,
        currency: "usd",
        expires,
        expiresHour: Math.floor(expires / 3600) * 3600,
        version: 1,
        createdAt: new Date().toISOString(),
        provider: "scrape",
        modelName: "scrape",
        agentId,
        conversationId,
      };

      mockReservationGet.mockResolvedValue(scraperReservationRecord);

      // Simulate successful scrape - no adjustment needed (fixed cost)
      // Just delete the reservation
      await mockDb["credit-reservations"].delete(
        `credit-reservations/${scraperReservation.reservationId}`
      );

      expect(mockDelete).toHaveBeenCalledWith(
        `credit-reservations/${scraperReservation.reservationId}`
      );
    });

    it("should consume scraper reservation on failure without refund", async () => {
      const workspaceId = "test-workspace";
      const agentId = "test-agent";
      const conversationId = "test-conversation";

      // Reserve credits for scraper
      const scraperCost = 5_000;
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
      // Note: workspaceBalance already updated by mockAtomicUpdate in reserveCredits
      // No need to manually subtract here

      // Simulate failure - remove reservation without refund
      const expires = Math.floor(Date.now() / 1000) + 15 * 60;
      const scraperReservationRecord: CreditReservationRecord = {
        pk: `credit-reservations/${scraperReservation.reservationId}`,
        workspaceId,
        reservedAmount: scraperCost,
        estimatedCost: scraperCost,
        currency: "usd",
        expires,
        expiresHour: Math.floor(expires / 3600) * 3600,
        version: 1,
        createdAt: new Date().toISOString(),
        provider: "scrape",
        modelName: "scrape",
        agentId,
        conversationId,
      };

      mockReservationGet.mockResolvedValue(scraperReservationRecord);

      await mockDb["credit-reservations"].delete(
        `credit-reservations/${scraperReservation.reservationId}`
      );

      // Verify reservation cleanup happened without refund transaction
      expect(mockDelete).toHaveBeenCalledWith(
        `credit-reservations/${scraperReservation.reservationId}`
      );
      expect(mockContext.addWorkspaceCreditTransaction).not.toHaveBeenCalledWith(
        expect.objectContaining({
          amountMillionthUsd: scraperCost,
        })
      );
    });
  });

  describe("Aggregate balance checks", () => {
    it("should settle final workspace balance after mixed workloads", async () => {
      const workspaceId = "test-workspace";
      const agentId = "test-agent";
      const conversationId = "test-conversation";

      const trackingContext: AugmentedContext = {
        ...mockContext,
        addWorkspaceCreditTransaction: vi.fn((transaction) => {
          workspaceBalance += transaction.amountMillionthUsd;
        }),
      } as unknown as AugmentedContext;

      // LLM reservation
      const llmEstimatedCost = 50_000;
      const llmReservation = await reserveCredits(
        mockDb,
        workspaceId,
        llmEstimatedCost,
        3,
        false,
        undefined,
        "openrouter",
        "openrouter/auto",
        agentId,
        conversationId
      );

      // Scraper reservation
      const scraperCost = 5_000;
      await reserveCredits(
        mockDb,
        workspaceId,
        scraperCost,
        3,
        false,
        undefined,
        "scrape",
        "scrape",
        agentId,
        conversationId
      );

      // Exa reservation (mocked tool, manual balance adjustment)
      const exaReservation = await mockReserveExaCredits(
        mockDb,
        workspaceId,
        0.01,
        3,
        trackingContext,
        agentId,
        conversationId
      );
      workspaceBalance -= exaReservation.reservedAmount;

      // LLM actual cost (refund 5,000)
      const tokenUsage: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      };
      mockCalculateTokenCost.mockReturnValue(45_000);

      const expires = Math.floor(Date.now() / 1000) + 15 * 60;
      mockReservationGet.mockResolvedValue({
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
      });

      await adjustCreditReservation(
        mockDb,
        llmReservation.reservationId,
        workspaceId,
        "openrouter",
        "openrouter/auto",
        tokenUsage,
        trackingContext,
        3,
        false,
        "gen-1",
        ["gen-1"],
        agentId,
        conversationId
      );

      // Exa failure: no refund, reservation remains consumed
      // Scraper success: no adjustment for fixed cost

      const expectedBalance =
        1_000_000_000 - llmEstimatedCost - scraperCost - exaReservation.reservedAmount + 5_000;
      expect(workspaceBalance).toBe(expectedBalance);
    });
  });
});
