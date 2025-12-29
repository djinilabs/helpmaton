import { describe, it, expect, vi, beforeEach } from "vitest";

// Type for tool with execute method (AI SDK tool type doesn't expose execute in types)
type ToolWithExecute = {
  execute: (args: unknown, options?: unknown) => Promise<string>;
};

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const {
  mockDatabase,
  mockIncrementSearchRequestBucket,
  mockExaSearch,
  mockReserveExaCredits,
  mockAdjustExaCreditReservation,
  mockRefundExaCredits,
} = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockIncrementSearchRequestBucket: vi.fn(),
    mockExaSearch: vi.fn(),
    mockReserveExaCredits: vi.fn(),
    mockAdjustExaCreditReservation: vi.fn(),
    mockRefundExaCredits: vi.fn(),
  };
});

// Mock the database module
vi.mock("../../../tables/database", () => ({
  database: mockDatabase,
}));

// Mock request tracking
vi.mock("../../../utils/requestTracking", () => ({
  incrementSearchRequestBucket: mockIncrementSearchRequestBucket,
}));

// Mock Exa API
vi.mock("../../../utils/exa", () => ({
  exaSearch: mockExaSearch,
  extractExaCost: vi.fn((response) => response.costDollars?.total ?? 0),
}));

// Mock Exa credits
vi.mock("../../../utils/exaCredits", () => ({
  reserveExaCredits: mockReserveExaCredits,
  adjustExaCreditReservation: mockAdjustExaCreditReservation,
  refundExaCredits: mockRefundExaCredits,
  calculateExaCost: vi.fn((dollars) => Math.ceil(dollars * 1_000_000)),
}));

// Import after mocks are set up
import type { DatabaseSchema } from "../../../tables/schema";
import type { AugmentedContext } from "../../../utils/workspaceCreditContext";
import { createExaSearchTool } from "../exaTools";

describe("exaTools", () => {
  let mockDb: DatabaseSchema;
  let mockContext: AugmentedContext;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    mockDb = {} as DatabaseSchema;
    mockDatabase.mockResolvedValue(mockDb);

    // Setup mock context
    mockContext = {
      addWorkspaceCreditTransaction: vi.fn(),
    } as unknown as AugmentedContext;

    // Default mock for reservation
    mockReserveExaCredits.mockResolvedValue({
      reservationId: "test-reservation-id",
      reservedAmount: 10_000, // $0.01 = 10,000 millionths
      workspace: {
        pk: "workspaces/test-workspace",
        sk: "workspace",
        creditBalance: 100_000_000,
        currency: "usd",
      },
    });

    // Default mock for request tracking
    mockIncrementSearchRequestBucket.mockResolvedValue({
      pk: "request-buckets/sub-123/search/2024-01-15T14:00:00.000Z",
      subscriptionId: "sub-123",
      category: "search",
      hourTimestamp: "2024-01-15T14:00:00.000Z",
      count: 1,
      expires: 0,
      version: 1,
      createdAt: new Date().toISOString(),
    });
  });

  describe("createExaSearchTool", () => {
    const workspaceId = "test-workspace";
    const agentId = "test-agent";
    const conversationId = "test-conversation";

    it("should successfully search with valid category and query", async () => {
      const tool = createExaSearchTool(
        workspaceId,
        mockContext,
        agentId,
        conversationId
      );
      const searchResponse = {
        query: "test query",
        results: [
          {
            title: "Test Result",
            url: "https://example.com",
            text: "Test content",
            score: 0.9,
          },
        ],
        costDollars: {
          total: 0.01,
        },
      };

      mockExaSearch.mockResolvedValue(searchResponse);

      const result = await (tool as unknown as ToolWithExecute).execute({
        category: "news",
        query: "test query",
        num_results: 5,
      });

      // The actual call passes 0.01 as the estimated cost
      expect(mockReserveExaCredits).toHaveBeenCalledWith(
        mockDb,
        workspaceId,
        0.01, // Estimate: $0.01 per call (conservative)
        3, // maxRetries
        mockContext,
        agentId,
        conversationId
      );
      // Check that exaSearch was called with correct arguments
      const callArgs = mockExaSearch.mock.calls[0];
      expect(callArgs[0]).toBe("test query");
      expect(callArgs[1]).toBe("news");
      expect(callArgs[2]?.num_results).toBe(5);
      expect(mockIncrementSearchRequestBucket).toHaveBeenCalledWith(workspaceId);
      expect(mockAdjustExaCreditReservation).toHaveBeenCalledWith(
        mockDb,
        "test-reservation-id",
        workspaceId,
        0.01, // actualCostDollars
        mockContext,
        "search",
        3,
        agentId,
        conversationId
      );
      expect(result).toContain("Test Result");
      expect(result).toContain("https://example.com");
      expect(result).toContain("Test content");
      expect(result).toContain("[TOOL_COST:");
    });

    it("should validate category parameter", async () => {
      const tool = createExaSearchTool(workspaceId, mockContext);

      // The tool validates category is a string, but doesn't validate enum values
      // The actual validation happens in exaSearch which will throw
      mockExaSearch.mockRejectedValue(
        new Error("Invalid search category: invalid-category")
      );

      const result = await (tool as unknown as ToolWithExecute).execute({
        category: "invalid-category",
        query: "test query",
      });

      // The error will be caught and returned as a string
      expect(result).toContain("Error");
      expect(result).toContain("Exa.ai");
    });

    it("should validate query parameter is not empty", async () => {
      const tool = createExaSearchTool(workspaceId, mockContext);

      const result = await (tool as unknown as ToolWithExecute).execute({
        category: "news",
        query: "",
      });

      expect(result).toContain("Error");
      expect(result).toContain("query");
      expect(mockExaSearch).not.toHaveBeenCalled();
    });

    it("should use default num_results when not provided", async () => {
      const tool = createExaSearchTool(workspaceId, mockContext);
      const searchResponse = {
        query: "test query",
        results: [],
        costDollars: {
          total: 0.01,
        },
      };

      mockExaSearch.mockResolvedValue(searchResponse);

      await (tool as unknown as ToolWithExecute).execute({
        category: "news",
        query: "test query",
      });

      // When num_results is not provided, zod sets it to 10 (default)
      // But when calling execute directly, it might be undefined, which exa.ts handles as 10
      const callArgs = mockExaSearch.mock.calls[0];
      expect(callArgs[0]).toBe("test query");
      expect(callArgs[1]).toBe("news");
      // num_results should be 10 (from zod default) or undefined (which exa.ts handles as 10)
      expect(callArgs[2]?.num_results ?? 10).toBe(10);
    });

    it("should handle all valid categories", async () => {
      const categories = [
        "company",
        "research paper",
        "news",
        "pdf",
        "github",
        "tweet",
        "personal site",
        "people",
        "financial report",
      ];

      const tool = createExaSearchTool(workspaceId, mockContext);
      const searchResponse = {
        query: "test",
        results: [],
        costDollars: {
          total: 0.01,
        },
      };

      mockExaSearch.mockResolvedValue(searchResponse);

      for (const category of categories) {
        // Reset mocks for each iteration
        vi.clearAllMocks();
        
        // Re-setup mocks after clearing
        mockReserveExaCredits.mockResolvedValue({
          reservationId: "test-reservation-id",
          reservedAmount: 10_000,
          workspace: {
            pk: "workspaces/test-workspace",
            sk: "workspace",
            creditBalance: 100_000_000,
            currency: "usd",
          },
        });
        mockExaSearch.mockResolvedValue({
          query: "test",
          results: [],
          costDollars: {
            total: 0.01,
          },
        });
        mockIncrementSearchRequestBucket.mockResolvedValue({
          pk: "request-buckets/sub-123/search/2024-01-15T14:00:00.000Z",
          subscriptionId: "sub-123",
          category: "search",
          hourTimestamp: "2024-01-15T14:00:00.000Z",
          count: 1,
          expires: 0,
          version: 1,
          createdAt: new Date().toISOString(),
        });
        mockAdjustExaCreditReservation.mockResolvedValue(undefined);
        
        await (tool as unknown as ToolWithExecute).execute({
          category,
          query: "test",
        });

        // Check that exaSearch was called with the category and default num_results
        const callArgs = mockExaSearch.mock.calls[0];
        expect(callArgs[0]).toBe("test");
        expect(callArgs[1]).toBe(category);
        // num_results should be 10 (from zod default) or undefined (which exa.ts handles as 10)
        expect(callArgs[2]?.num_results ?? 10).toBe(10);
      }
    });

    it("should handle API errors and refund credits", async () => {
      const tool = createExaSearchTool(workspaceId, mockContext);
      const apiError = new Error("Exa API error");

      mockExaSearch.mockRejectedValue(apiError);

      const result = await (tool as unknown as ToolWithExecute).execute({
        category: "news",
        query: "test query",
      });

      expect(result).toContain("Error searching with Exa.ai");
      expect(mockRefundExaCredits).toHaveBeenCalledWith(
        mockDb,
        "test-reservation-id",
        workspaceId,
        mockContext,
        "search",
        3,
        undefined, // agentId not passed in this test
        undefined // conversationId not passed in this test
      );
    });

    it("should handle missing context gracefully", async () => {
      const tool = createExaSearchTool(workspaceId, undefined); // No context
      const searchResponse = {
        query: "test query",
        results: [],
        costDollars: {
          total: 0.01,
        },
      };

      mockExaSearch.mockResolvedValue(searchResponse);

      const result = await (tool as unknown as ToolWithExecute).execute({
        category: "news",
        query: "test query",
      });

      expect(result).toContain("Error searching with Exa.ai");
      expect(result).toContain("Context not available");
    });

    it("should handle reservation errors gracefully", async () => {
      const tool = createExaSearchTool(workspaceId, mockContext);
      const reservationError = new Error("Insufficient credits");

      mockReserveExaCredits.mockRejectedValue(reservationError);

      const result = await (tool as unknown as ToolWithExecute).execute({
        category: "news",
        query: "test query",
      });

      expect(result).toContain("Error searching with Exa.ai");
      expect(result).toContain("Insufficient credits");
    });

    it("should format results correctly", async () => {
      const tool = createExaSearchTool(workspaceId, mockContext);
      const searchResponse = {
        query: "test query",
        results: [
          {
            title: "Result 1",
            url: "https://example.com/1",
            text: "Content 1",
            score: 0.95,
          },
          {
            title: "Result 2",
            url: "https://example.com/2",
            text: "Content 2",
            score: 0.85,
          },
        ],
        costDollars: {
          total: 0.02,
        },
      };

      mockExaSearch.mockResolvedValue(searchResponse);

      const result = await (tool as unknown as ToolWithExecute).execute({
        category: "news",
        query: "test query",
      });

      expect(result).toContain("Found 2 search results");
      expect(result).toContain("Result 1");
      expect(result).toContain("https://example.com/1");
      expect(result).toContain("Content 1");
      expect(result).toContain("0.95");
      expect(result).toContain("Result 2");
      expect(result).toContain("https://example.com/2");
      expect(result).toContain("Content 2");
      expect(result).toContain("0.85");
    });

    it("should handle results without scores", async () => {
      const tool = createExaSearchTool(workspaceId, mockContext);
      const searchResponse = {
        query: "test query",
        results: [
          {
            title: "Result 1",
            url: "https://example.com/1",
            text: "Content 1",
          },
        ],
        costDollars: {
          total: 0.01,
        },
      };

      mockExaSearch.mockResolvedValue(searchResponse);

      const result = await (tool as unknown as ToolWithExecute).execute({
        category: "news",
        query: "test query",
      });

      expect(result).toContain("Result 1");
      expect(result).not.toContain("Relevance score");
    });

    it("should handle request tracking errors gracefully", async () => {
      const tool = createExaSearchTool(workspaceId, mockContext);
      const searchResponse = {
        query: "test query",
        results: [],
        costDollars: {
          total: 0.01,
        },
      };

      mockExaSearch.mockResolvedValue(searchResponse);
      mockIncrementSearchRequestBucket.mockRejectedValue(
        new Error("Tracking error")
      );

      // Should still succeed even if tracking fails
      const result = await (tool as unknown as ToolWithExecute).execute({
        category: "news",
        query: "test query",
      });

      expect(result).toContain("Found 0 search results");
      expect(mockAdjustExaCreditReservation).toHaveBeenCalled();
    });

    it("should handle missing reservation ID gracefully", async () => {
      const tool = createExaSearchTool(workspaceId, mockContext);
      const searchResponse = {
        query: "test query",
        results: [],
        costDollars: {
          total: 0.01,
        },
      };

      mockReserveExaCredits.mockResolvedValue({
        reservationId: "byok", // Special reservation ID
        reservedAmount: 0,
        workspace: {
          pk: "workspaces/test-workspace",
          sk: "workspace",
          creditBalance: 100_000_000,
          currency: "usd",
        },
      });

      mockExaSearch.mockResolvedValue(searchResponse);

      const result = await (tool as unknown as ToolWithExecute).execute({
        category: "news",
        query: "test query",
      });

      expect(result).toContain("Found 0 search results");
      // Should not call adjustExaCreditReservation for special reservation IDs
      expect(mockAdjustExaCreditReservation).not.toHaveBeenCalled();
    });

    it("should handle invalid args object", async () => {
      const tool = createExaSearchTool(workspaceId, mockContext);

      const result = await (tool as unknown as ToolWithExecute).execute(null);

      expect(result).toContain("Error");
      expect(result).toContain("requires");
      expect(mockExaSearch).not.toHaveBeenCalled();
    });
  });
});

