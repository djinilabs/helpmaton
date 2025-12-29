import { describe, it, expect, vi, beforeEach } from "vitest";

// Type for tool with execute method (AI SDK tool type doesn't expose execute in types)
// We use unknown as intermediate cast because the actual Tool type is complex
type ToolWithExecute = {
  execute: (args: unknown, options?: unknown) => Promise<string>;
};

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const {
  mockDatabase,
  mockCheckTavilyDailyLimit,
  mockIncrementSearchRequestBucket,
  mockIncrementFetchRequestBucket,
  mockGetWorkspaceSubscription,
  mockTavilySearch,
  mockTavilyExtract,
  mockExtractCreditsUsed,
  mockReserveTavilyCredits,
  mockAdjustTavilyCreditReservation,
  mockRefundTavilyCredits,
  mockCalculateTavilyCost,
  mockJinaSearch,
} = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockCheckTavilyDailyLimit: vi.fn(),
    mockIncrementSearchRequestBucket: vi.fn(),
    mockIncrementFetchRequestBucket: vi.fn(),
    mockGetWorkspaceSubscription: vi.fn(),
    mockTavilySearch: vi.fn(),
    mockTavilyExtract: vi.fn(),
    mockExtractCreditsUsed: vi.fn(),
    mockReserveTavilyCredits: vi.fn(),
    mockAdjustTavilyCreditReservation: vi.fn(),
    mockRefundTavilyCredits: vi.fn(),
    mockCalculateTavilyCost: vi.fn(),
    mockJinaSearch: vi.fn(),
  };
});

// Mock the database module
vi.mock("../../../tables/database", () => ({
  database: mockDatabase,
}));

// Mock request tracking
vi.mock("../../../utils/requestTracking", () => ({
  checkTavilyDailyLimit: mockCheckTavilyDailyLimit,
  incrementSearchRequestBucket: mockIncrementSearchRequestBucket,
  incrementFetchRequestBucket: mockIncrementFetchRequestBucket,
  isTavilyApiKeyProduction: vi.fn(() => false), // Default to free tier for tests
}));

// Mock subscription utilities
vi.mock("../../../utils/subscriptionUtils", () => ({
  getWorkspaceSubscription: mockGetWorkspaceSubscription,
}));

// Mock Tavily API
vi.mock("../../../utils/tavily", () => ({
  tavilySearch: mockTavilySearch,
  tavilyExtract: mockTavilyExtract,
  extractCreditsUsed: mockExtractCreditsUsed,
}));

// Mock Tavily credits
vi.mock("../../../utils/tavilyCredits", () => ({
  reserveTavilyCredits: mockReserveTavilyCredits,
  adjustTavilyCreditReservation: mockAdjustTavilyCreditReservation,
  refundTavilyCredits: mockRefundTavilyCredits,
  calculateTavilyCost: mockCalculateTavilyCost,
}));

// Mock Jina utilities
vi.mock("../../../utils/jina", () => ({
  jinaFetch: vi.fn(),
  jinaSearch: mockJinaSearch,
}));

// Import after mocks are set up
import type { DatabaseSchema } from "../../../tables/schema";
import type { AugmentedContext } from "../../../utils/workspaceCreditContext";
import { createTavilySearchTool, createTavilyFetchTool, createJinaSearchTool } from "../tavilyTools";

describe("tavilyTools", () => {
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

    // Default mock for calculateTavilyCost: 1 credit = 8000 millionths ($0.008)
    mockCalculateTavilyCost.mockImplementation((creditsUsed: number = 1) => {
      return creditsUsed * 8000;
    });
  });

  describe("createTavilySearchTool", () => {
    const workspaceId = "test-workspace";

    it("should successfully search within free limit", async () => {
      const tool = createTavilySearchTool(workspaceId, mockContext);
      const searchResponse = {
        results: [
          {
            title: "Test Result",
            url: "https://example.com",
            content: "Test content",
            score: 0.95,
          },
        ],
        query: "test query",
      };

      mockCheckTavilyDailyLimit.mockResolvedValue({
        withinFreeLimit: true,
        callCount: 5,
      });
      mockTavilySearch.mockResolvedValue(searchResponse);
      mockExtractCreditsUsed.mockReturnValue(1);
      mockIncrementSearchRequestBucket.mockResolvedValue({
        pk: "request-buckets/sub-123/search/2024-01-15T14:00:00.000Z",
        subscriptionId: "sub-123",
        category: "search",
        hourTimestamp: "2024-01-15T14:00:00.000Z",
        count: 6,
        expires: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      });

      const result = await (tool as unknown as ToolWithExecute).execute({
        query: "test query",
        max_results: 5,
      });

      expect(mockCheckTavilyDailyLimit).toHaveBeenCalledWith(workspaceId);
      expect(mockTavilySearch).toHaveBeenCalledWith("test query", {
        max_results: 5,
      });
      expect(mockIncrementSearchRequestBucket).toHaveBeenCalledWith(workspaceId);
      // Verify transaction is created for free tier users with actual cost
      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith({
        workspaceId,
        agentId: undefined,
        conversationId: undefined,
        source: "tool-execution",
        supplier: "tavily",
        tool_call: "search_web",
        description: "Tavily API call: search_web - actual cost (free tier)",
        amountMillionthUsd: -8000, // 1 credit * 8000 = 8000, negative for debit
      });
      expect(result).toContain("Found 1 search result");
      expect(result).toContain("Test Result");
      expect(result).toContain("https://example.com");
    });

    it("should reserve credits for paid tier exceeding free limit", async () => {
      const tool = createTavilySearchTool(workspaceId, mockContext);
      const searchResponse = {
        results: [
          {
            title: "Test Result",
            url: "https://example.com",
            content: "Test content",
            score: 0.95,
          },
        ],
        query: "test query",
      };

      mockCheckTavilyDailyLimit.mockResolvedValue({
        withinFreeLimit: false,
        callCount: 15,
      });
      mockGetWorkspaceSubscription.mockResolvedValue({
        plan: "pro",
      });
      mockReserveTavilyCredits.mockResolvedValue({
        reservationId: "test-reservation-id",
        reservedAmount: 8_000,
        workspace: {
          pk: "workspaces/test-workspace",
          creditBalance: 100_000_000,
        },
      });
      mockTavilySearch.mockResolvedValue(searchResponse);
      mockExtractCreditsUsed.mockReturnValue(1);
      mockIncrementSearchRequestBucket.mockResolvedValue({
        pk: "request-buckets/sub-123/search/2024-01-15T14:00:00.000Z",
        subscriptionId: "sub-123",
        category: "search",
        hourTimestamp: "2024-01-15T14:00:00.000Z",
        count: 16,
        expires: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      });
      mockAdjustTavilyCreditReservation.mockResolvedValue(undefined);

      const result = await (tool as unknown as ToolWithExecute).execute({
        query: "test query",
        max_results: 5,
      });

      expect(mockReserveTavilyCredits).toHaveBeenCalledWith(
        mockDb,
        workspaceId,
        1, // estimatedCredits
        3, // maxRetries
        mockContext,
        undefined, // agentId (optional)
        undefined // conversationId (optional)
      );
      expect(mockAdjustTavilyCreditReservation).toHaveBeenCalledWith(
        mockDb,
        "test-reservation-id",
        workspaceId,
        1, // actualCreditsUsed
        mockContext,
        "search_web",
        3, // maxRetries
        undefined, // agentId
        undefined // conversationId
      );
      expect(result).toContain("Found 1 search result");
    });

    it("should return error message for free tier exceeding limit", async () => {
      const tool = createTavilySearchTool(workspaceId, mockContext);
      const { tooManyRequests } = await import("@hapi/boom");

      mockCheckTavilyDailyLimit.mockRejectedValue(
        tooManyRequests("Daily Tavily API call limit exceeded")
      );

      const result = await (tool as unknown as ToolWithExecute).execute({
        query: "test query",
        max_results: 5,
      });

      expect(result).toContain("Error searching the web");
      expect(result).toContain("Daily Tavily API call limit exceeded");
    });

    it("should refund credits on API error", async () => {
      const tool = createTavilySearchTool(workspaceId, mockContext);
      const apiError = new Error("Tavily API error");

      mockCheckTavilyDailyLimit.mockResolvedValue({
        withinFreeLimit: false,
        callCount: 15,
      });
      mockGetWorkspaceSubscription.mockResolvedValue({
        plan: "pro",
      });
      mockReserveTavilyCredits.mockResolvedValue({
        reservationId: "test-reservation-id",
        reservedAmount: 8_000,
        workspace: {
          pk: "workspaces/test-workspace",
          creditBalance: 100_000_000,
        },
      });
      mockTavilySearch.mockRejectedValue(apiError);
      mockRefundTavilyCredits.mockResolvedValue(undefined);

      const result = await (tool as unknown as ToolWithExecute).execute({
        query: "test query",
        max_results: 5,
      });

      expect(result).toContain("Error searching the web");
      expect(result).toContain("Tavily API error");
      expect(mockRefundTavilyCredits).toHaveBeenCalledWith(
        mockDb,
        "test-reservation-id",
        workspaceId,
        mockContext,
        "search_web",
        3, // maxRetries
        undefined, // agentId
        undefined // conversationId
      );
    });

    it("should handle tracking failure gracefully", async () => {
      const tool = createTavilySearchTool(workspaceId, mockContext);
      const searchResponse = {
        results: [
          {
            title: "Test Result",
            url: "https://example.com",
            content: "Test content",
            score: 0.95,
          },
        ],
        query: "test query",
      };

      mockCheckTavilyDailyLimit.mockResolvedValue({
        withinFreeLimit: true,
        callCount: 5,
      });
      mockTavilySearch.mockResolvedValue(searchResponse);
      mockExtractCreditsUsed.mockReturnValue(1);
      mockIncrementSearchRequestBucket.mockRejectedValue(
        new Error("Tracking failed")
      );

      // Should not throw - tracking failure is logged but doesn't fail the tool
      const result = await (tool as unknown as ToolWithExecute).execute({
        query: "test query",
        max_results: 5,
      });

      expect(result).toContain("Found 1 search result");
    });

    it("should handle empty search results", async () => {
      const tool = createTavilySearchTool(workspaceId, mockContext);
      const searchResponse = {
        results: [],
        query: "test query",
      };

      mockCheckTavilyDailyLimit.mockResolvedValue({
        withinFreeLimit: true,
        callCount: 5,
      });
      mockTavilySearch.mockResolvedValue(searchResponse);
      mockExtractCreditsUsed.mockReturnValue(1);
      mockIncrementSearchRequestBucket.mockResolvedValue({
        pk: "request-buckets/sub-123/search/2024-01-15T14:00:00.000Z",
        subscriptionId: "sub-123",
        category: "search",
        hourTimestamp: "2024-01-15T14:00:00.000Z",
        count: 6,
        expires: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      });

      const result = await (tool as unknown as ToolWithExecute).execute({
        query: "test query",
        max_results: 5,
      });

      expect(result).toContain("Found 0 search results");
    });

    it("should include answer if available in response", async () => {
      const tool = createTavilySearchTool(workspaceId, mockContext);
      const searchResponse = {
        results: [
          {
            title: "Test Result",
            url: "https://example.com",
            content: "Test content",
            score: 0.95,
          },
        ],
        query: "test query",
        answer: "This is the answer",
      };

      mockCheckTavilyDailyLimit.mockResolvedValue({
        withinFreeLimit: true,
        callCount: 5,
      });
      mockTavilySearch.mockResolvedValue(searchResponse);
      mockExtractCreditsUsed.mockReturnValue(1);
      mockIncrementSearchRequestBucket.mockResolvedValue({
        pk: "request-buckets/sub-123/search/2024-01-15T14:00:00.000Z",
        subscriptionId: "sub-123",
        category: "search",
        hourTimestamp: "2024-01-15T14:00:00.000Z",
        count: 6,
        expires: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      });

      const result = await (tool as unknown as ToolWithExecute).execute({
        query: "test query",
        max_results: 5,
      });

      expect(result).toContain("This is the answer");
    });
  });

  describe("createTavilyFetchTool", () => {
    // Fetch tool tests should use incrementFetchRequestBucket
    const workspaceId = "test-workspace";

    it("should successfully fetch content within free limit", async () => {
      const tool = createTavilyFetchTool(workspaceId, mockContext);
      const extractResponse = {
        content: "This is the extracted content",
        title: "Test Page",
        url: "https://example.com/article",
        images: ["https://example.com/image.jpg"],
      };

      mockCheckTavilyDailyLimit.mockResolvedValue({
        withinFreeLimit: true,
        callCount: 5,
      });
      mockTavilyExtract.mockResolvedValue(extractResponse);
      mockExtractCreditsUsed.mockReturnValue(1);
      mockIncrementFetchRequestBucket.mockResolvedValue({
        pk: "request-buckets/sub-123/fetch/2024-01-15T14:00:00.000Z",
        subscriptionId: "sub-123",
        category: "fetch",
        hourTimestamp: "2024-01-15T14:00:00.000Z",
        count: 6,
        expires: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      });

      const result = await (tool as unknown as ToolWithExecute).execute({
        url: "https://example.com/article",
      });

      expect(mockCheckTavilyDailyLimit).toHaveBeenCalledWith(workspaceId);
      expect(mockTavilyExtract).toHaveBeenCalledWith(
        "https://example.com/article"
      );
      expect(mockIncrementFetchRequestBucket).toHaveBeenCalledWith(workspaceId);
      // Verify transaction is created for free tier users with actual cost
      expect(mockContext.addWorkspaceCreditTransaction).toHaveBeenCalledWith({
        workspaceId,
        agentId: undefined,
        conversationId: undefined,
        source: "tool-execution",
        supplier: "tavily",
        tool_call: "fetch_url",
        description: "Tavily API call: fetch_url - actual cost (free tier)",
        amountMillionthUsd: -8000, // 1 credit * 8000 = 8000, negative for debit
      });
      expect(result).toContain("Test Page");
      expect(result).toContain("This is the extracted content");
      expect(result).toContain("https://example.com/article");
    });

    it("should reserve credits for paid tier exceeding free limit", async () => {
      const tool = createTavilyFetchTool(workspaceId, mockContext);
      const extractResponse = {
        content: "This is the extracted content",
        title: "Test Page",
        url: "https://example.com/article",
      };

      mockCheckTavilyDailyLimit.mockResolvedValue({
        withinFreeLimit: false,
        callCount: 15,
      });
      mockGetWorkspaceSubscription.mockResolvedValue({
        plan: "pro",
      });
      mockReserveTavilyCredits.mockResolvedValue({
        reservationId: "test-reservation-id",
        reservedAmount: 8_000,
        workspace: {
          pk: "workspaces/test-workspace",
          creditBalance: 100_000_000,
        },
      });
      mockTavilyExtract.mockResolvedValue(extractResponse);
      mockExtractCreditsUsed.mockReturnValue(1);
      mockIncrementFetchRequestBucket.mockResolvedValue({
        pk: "request-buckets/sub-123/fetch/2024-01-15T14:00:00.000Z",
        subscriptionId: "sub-123",
        category: "fetch",
        hourTimestamp: "2024-01-15T14:00:00.000Z",
        count: 16,
        expires: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      });
      mockAdjustTavilyCreditReservation.mockResolvedValue(undefined);

      const result = await (tool as unknown as ToolWithExecute).execute({
        url: "https://example.com/article",
      });

      expect(mockReserveTavilyCredits).toHaveBeenCalledWith(
        mockDb,
        workspaceId,
        1, // estimatedCredits
        3, // maxRetries
        mockContext,
        undefined, // agentId (optional)
        undefined // conversationId (optional)
      );
      expect(mockAdjustTavilyCreditReservation).toHaveBeenCalledWith(
        mockDb,
        "test-reservation-id",
        workspaceId,
        1, // actualCreditsUsed
        mockContext,
        "fetch_url",
        3, // maxRetries
        undefined, // agentId
        undefined // conversationId
      );
      expect(result).toContain("Test Page");
    });

    it("should return error message for free tier exceeding limit", async () => {
      const tool = createTavilyFetchTool(workspaceId, mockContext);
      const { tooManyRequests } = await import("@hapi/boom");

      mockCheckTavilyDailyLimit.mockRejectedValue(
        tooManyRequests("Daily Tavily API call limit exceeded")
      );

      const result = await (tool as unknown as ToolWithExecute).execute({
        url: "https://example.com/article",
      });

      expect(result).toContain("Error fetching web content");
      expect(result).toContain("Daily Tavily API call limit exceeded");
    });

    it("should refund credits on API error", async () => {
      const tool = createTavilyFetchTool(workspaceId, mockContext);
      const apiError = new Error("Tavily API error");

      mockCheckTavilyDailyLimit.mockResolvedValue({
        withinFreeLimit: false,
        callCount: 15,
      });
      mockGetWorkspaceSubscription.mockResolvedValue({
        plan: "pro",
      });
      mockReserveTavilyCredits.mockResolvedValue({
        reservationId: "test-reservation-id",
        reservedAmount: 8_000,
        workspace: {
          pk: "workspaces/test-workspace",
          creditBalance: 100_000_000,
        },
      });
      mockTavilyExtract.mockRejectedValue(apiError);
      mockRefundTavilyCredits.mockResolvedValue(undefined);

      const result = await (tool as unknown as ToolWithExecute).execute({
        url: "https://example.com/article",
      });

      expect(result).toContain("Error fetching web content");
      expect(result).toContain("Tavily API error");
      expect(mockRefundTavilyCredits).toHaveBeenCalledWith(
        mockDb,
        "test-reservation-id",
        workspaceId,
        mockContext,
        "fetch_url",
        3, // maxRetries
        undefined, // agentId
        undefined // conversationId
      );
    });

    it("should handle tracking failure gracefully", async () => {
      const tool = createTavilyFetchTool(workspaceId, mockContext);
      const extractResponse = {
        content: "This is the extracted content",
        title: "Test Page",
        url: "https://example.com/article",
      };

      mockCheckTavilyDailyLimit.mockResolvedValue({
        withinFreeLimit: true,
        callCount: 5,
      });
      mockTavilyExtract.mockResolvedValue(extractResponse);
      mockExtractCreditsUsed.mockReturnValue(1);
      mockIncrementFetchRequestBucket.mockRejectedValue(
        new Error("Tracking failed")
      );

      // Should not throw - tracking failure is logged but doesn't fail the tool
      const result = await (tool as unknown as ToolWithExecute).execute({
        url: "https://example.com/article",
      });

      expect(result).toContain("Test Page");
    });

    it("should handle missing title and content", async () => {
      const tool = createTavilyFetchTool(workspaceId, mockContext);
      const extractResponse = {
        url: "https://example.com/article",
      };

      mockCheckTavilyDailyLimit.mockResolvedValue({
        withinFreeLimit: true,
        callCount: 5,
      });
      mockTavilyExtract.mockResolvedValue(extractResponse);
      mockExtractCreditsUsed.mockReturnValue(1);
      mockIncrementFetchRequestBucket.mockResolvedValue({
        pk: "request-buckets/sub-123/fetch/2024-01-15T14:00:00.000Z",
        subscriptionId: "sub-123",
        category: "fetch",
        hourTimestamp: "2024-01-15T14:00:00.000Z",
        count: 6,
        expires: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      });

      const result = await (tool as unknown as ToolWithExecute).execute({
        url: "https://example.com/article",
      });

      expect(result).toContain("https://example.com/article");
    });
  });

  describe("createJinaSearchTool", () => {
    const workspaceId = "test-workspace";
    const agentId = "test-agent";
    const conversationId = "test-conversation";

    beforeEach(() => {
      mockJinaSearch.mockClear();
    });

    it("should successfully search with valid query", async () => {
      const tool = createJinaSearchTool(workspaceId, agentId, conversationId);
      const searchResponse = {
        query: "AI news",
        results: [
          {
            title: "Article 1",
            url: "https://example.com/article1",
            content: "Content about AI",
            score: 0.95,
          },
          {
            title: "Article 2",
            url: "https://example.com/article2",
            content: "Content about ML",
            score: 0.85,
          },
        ],
        answer: "Summary of AI news",
      };

      mockJinaSearch.mockResolvedValue(searchResponse);

      const result = await (tool as unknown as ToolWithExecute).execute({
        query: "AI news",
        max_results: 5,
      });

      expect(result).toContain("Found 2 search results");
      expect(result).toContain("Article 1");
      expect(result).toContain("https://example.com/article1");
      expect(result).toContain("Summary Answer");
      expect(mockJinaSearch).toHaveBeenCalledWith("AI news", {
        max_results: 5,
      });
    });

    it("should use default max_results when not provided", async () => {
      const tool = createJinaSearchTool(workspaceId);
      const searchResponse = {
        query: "test query",
        results: [],
      };

      mockJinaSearch.mockResolvedValue(searchResponse);

      await (tool as unknown as ToolWithExecute).execute({
        query: "test query",
      });

      // max_results defaults to 5 in the schema, but if not provided it's undefined
      // jinaSearch will use its own default
      expect(mockJinaSearch).toHaveBeenCalledWith("test query", expect.any(Object));
    });

    it("should return error message for invalid query", async () => {
      const tool = createJinaSearchTool(workspaceId);

      const result = await (tool as unknown as ToolWithExecute).execute({
        query: "",
      });

      expect(result).toContain("Error: search_web requires a non-empty 'query' parameter");
    });

    it("should return error message for missing query", async () => {
      const tool = createJinaSearchTool(workspaceId);

      const result = await (tool as unknown as ToolWithExecute).execute({});

      expect(result).toContain("Error: search_web requires a non-empty 'query' parameter");
    });

    it("should handle API errors gracefully", async () => {
      const tool = createJinaSearchTool(workspaceId);
      const apiError = new Error("Jina API error");

      mockJinaSearch.mockRejectedValue(apiError);

      const result = await (tool as unknown as ToolWithExecute).execute({
        query: "test query",
      });

      expect(result).toContain("Error searching the web");
      expect(result).toContain("Jina API error");
    });

    it("should handle results without URLs", async () => {
      const tool = createJinaSearchTool(workspaceId);
      const searchResponse = {
        query: "test query",
        results: [
          {
            title: "Result without URL",
            url: "",
            content: "Content here",
          },
        ],
      };

      mockJinaSearch.mockResolvedValue(searchResponse);

      const result = await (tool as unknown as ToolWithExecute).execute({
        query: "test query",
      });

      expect(result).toContain("Result without URL");
      expect(result).not.toContain("URL:");
    });

    it("should handle results without scores", async () => {
      const tool = createJinaSearchTool(workspaceId);
      const searchResponse = {
        query: "test query",
        results: [
          {
            title: "Article",
            url: "https://example.com/article",
            content: "Content",
          },
        ],
      };

      mockJinaSearch.mockResolvedValue(searchResponse);

      const result = await (tool as unknown as ToolWithExecute).execute({
        query: "test query",
      });

      expect(result).toContain("Article");
      expect(result).not.toContain("Relevance score");
    });

    it("should handle empty results", async () => {
      const tool = createJinaSearchTool(workspaceId);
      const searchResponse = {
        query: "test query",
        results: [],
      };

      mockJinaSearch.mockResolvedValue(searchResponse);

      const result = await (tool as unknown as ToolWithExecute).execute({
        query: "test query",
      });

      expect(result).toContain("Found 0 search results");
    });
  });
});
