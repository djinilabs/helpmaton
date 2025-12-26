import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const {
  mockDatabase,
  mockCheckTavilyDailyLimit,
  mockIncrementTavilyCallBucket,
  mockGetWorkspaceSubscription,
  mockTavilySearch,
  mockTavilyExtract,
  mockExtractCreditsUsed,
  mockReserveTavilyCredits,
  mockAdjustTavilyCreditReservation,
  mockRefundTavilyCredits,
  mockCalculateTavilyCost,
} = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockCheckTavilyDailyLimit: vi.fn(),
    mockIncrementTavilyCallBucket: vi.fn(),
    mockGetWorkspaceSubscription: vi.fn(),
    mockTavilySearch: vi.fn(),
    mockTavilyExtract: vi.fn(),
    mockExtractCreditsUsed: vi.fn(),
    mockReserveTavilyCredits: vi.fn(),
    mockAdjustTavilyCreditReservation: vi.fn(),
    mockRefundTavilyCredits: vi.fn(),
    mockCalculateTavilyCost: vi.fn(),
  };
});

// Mock the database module
vi.mock("../../../tables/database", () => ({
  database: mockDatabase,
}));

// Mock request tracking
vi.mock("../../../utils/requestTracking", () => ({
  checkTavilyDailyLimit: mockCheckTavilyDailyLimit,
  incrementTavilyCallBucket: mockIncrementTavilyCallBucket,
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

// Import after mocks are set up
import type { DatabaseSchema } from "../../../tables/schema";
import { createTavilySearchTool, createTavilyFetchTool } from "../tavilyTools";

describe("tavilyTools", () => {
  let mockDb: DatabaseSchema;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    mockDb = {} as DatabaseSchema;
    mockDatabase.mockResolvedValue(mockDb);
    
    // Default mock for calculateTavilyCost: 1 credit = 8000 millionths ($0.008)
    mockCalculateTavilyCost.mockImplementation((creditsUsed: number = 1) => {
      return creditsUsed * 8000;
    });
  });

  describe("createTavilySearchTool", () => {
    const workspaceId = "test-workspace";

    it("should successfully search within free limit", async () => {
      const tool = createTavilySearchTool(workspaceId);
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
      mockIncrementTavilyCallBucket.mockResolvedValue({
        pk: "tavily-call-buckets/test-workspace/2024-01-15T14:00:00.000Z",
        workspaceId,
        hourTimestamp: "2024-01-15T14:00:00.000Z",
        count: 6,
        expires: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      });

      const result = await (tool as any).execute({
        query: "test query",
        max_results: 5,
      });

      expect(mockCheckTavilyDailyLimit).toHaveBeenCalledWith(workspaceId);
      expect(mockTavilySearch).toHaveBeenCalledWith("test query", {
        max_results: 5,
      });
      expect(mockIncrementTavilyCallBucket).toHaveBeenCalledWith(workspaceId);
      expect(result).toContain("Found 1 search result");
      expect(result).toContain("Test Result");
      expect(result).toContain("https://example.com");
    });

    it("should reserve credits for paid tier exceeding free limit", async () => {
      const tool = createTavilySearchTool(workspaceId);
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
      mockIncrementTavilyCallBucket.mockResolvedValue({
        pk: "tavily-call-buckets/test-workspace/2024-01-15T14:00:00.000Z",
        workspaceId,
        hourTimestamp: "2024-01-15T14:00:00.000Z",
        count: 16,
        expires: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      });
      mockAdjustTavilyCreditReservation.mockResolvedValue(undefined);

      const result = await (tool as any).execute({
        query: "test query",
        max_results: 5,
      });

      expect(mockReserveTavilyCredits).toHaveBeenCalledWith(
        mockDb,
        workspaceId,
        1, // estimatedCredits
        3 // maxRetries
      );
      expect(mockAdjustTavilyCreditReservation).toHaveBeenCalledWith(
        mockDb,
        "test-reservation-id",
        workspaceId,
        1, // actualCreditsUsed
        3 // maxRetries
      );
      expect(result).toContain("Found 1 search result");
    });

    it("should return error message for free tier exceeding limit", async () => {
      const tool = createTavilySearchTool(workspaceId);
      const { tooManyRequests } = await import("@hapi/boom");

      mockCheckTavilyDailyLimit.mockRejectedValue(
        tooManyRequests("Daily Tavily API call limit exceeded")
      );

      const result = await (tool as any).execute({
        query: "test query",
        max_results: 5,
      });

      expect(result).toContain("Error searching with Tavily");
      expect(result).toContain("Daily Tavily API call limit exceeded");
    });

    it("should refund credits on API error", async () => {
      const tool = createTavilySearchTool(workspaceId);
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

      const result = await (tool as any).execute({
        query: "test query",
        max_results: 5,
      });

      expect(result).toContain("Error searching with Tavily");
      expect(result).toContain("Tavily API error");
      expect(mockRefundTavilyCredits).toHaveBeenCalledWith(
        mockDb,
        "test-reservation-id",
        workspaceId,
        3 // maxRetries
      );
    });

    it("should handle tracking failure gracefully", async () => {
      const tool = createTavilySearchTool(workspaceId);
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
      mockIncrementTavilyCallBucket.mockRejectedValue(
        new Error("Tracking failed")
      );

      // Should not throw - tracking failure is logged but doesn't fail the tool
      const result = await (tool as any).execute({
        query: "test query",
        max_results: 5,
      });

      expect(result).toContain("Found 1 search result");
    });

    it("should handle empty search results", async () => {
      const tool = createTavilySearchTool(workspaceId);
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
      mockIncrementTavilyCallBucket.mockResolvedValue({
        pk: "tavily-call-buckets/test-workspace/2024-01-15T14:00:00.000Z",
        workspaceId,
        hourTimestamp: "2024-01-15T14:00:00.000Z",
        count: 6,
        expires: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      });

      const result = await (tool as any).execute({
        query: "test query",
        max_results: 5,
      });

      expect(result).toContain("Found 0 search results");
    });

    it("should include answer if available in response", async () => {
      const tool = createTavilySearchTool(workspaceId);
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
      mockIncrementTavilyCallBucket.mockResolvedValue({
        pk: "tavily-call-buckets/test-workspace/2024-01-15T14:00:00.000Z",
        workspaceId,
        hourTimestamp: "2024-01-15T14:00:00.000Z",
        count: 6,
        expires: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      });

      const result = await (tool as any).execute({
        query: "test query",
        max_results: 5,
      });

      expect(result).toContain("This is the answer");
    });
  });

  describe("createTavilyFetchTool", () => {
    const workspaceId = "test-workspace";

    it("should successfully fetch content within free limit", async () => {
      const tool = createTavilyFetchTool(workspaceId);
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
      mockIncrementTavilyCallBucket.mockResolvedValue({
        pk: "tavily-call-buckets/test-workspace/2024-01-15T14:00:00.000Z",
        workspaceId,
        hourTimestamp: "2024-01-15T14:00:00.000Z",
        count: 6,
        expires: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      });

      const result = await (tool as any).execute({
        url: "https://example.com/article",
      });

      expect(mockCheckTavilyDailyLimit).toHaveBeenCalledWith(workspaceId);
      expect(mockTavilyExtract).toHaveBeenCalledWith(
        "https://example.com/article"
      );
      expect(mockIncrementTavilyCallBucket).toHaveBeenCalledWith(workspaceId);
      expect(result).toContain("Test Page");
      expect(result).toContain("This is the extracted content");
      expect(result).toContain("https://example.com/article");
    });

    it("should reserve credits for paid tier exceeding free limit", async () => {
      const tool = createTavilyFetchTool(workspaceId);
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
      mockIncrementTavilyCallBucket.mockResolvedValue({
        pk: "tavily-call-buckets/test-workspace/2024-01-15T14:00:00.000Z",
        workspaceId,
        hourTimestamp: "2024-01-15T14:00:00.000Z",
        count: 16,
        expires: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      });
      mockAdjustTavilyCreditReservation.mockResolvedValue(undefined);

      const result = await (tool as any).execute({
        url: "https://example.com/article",
      });

      expect(mockReserveTavilyCredits).toHaveBeenCalledWith(
        mockDb,
        workspaceId,
        1, // estimatedCredits
        3 // maxRetries
      );
      expect(mockAdjustTavilyCreditReservation).toHaveBeenCalledWith(
        mockDb,
        "test-reservation-id",
        workspaceId,
        1, // actualCreditsUsed
        3 // maxRetries
      );
      expect(result).toContain("Test Page");
    });

    it("should return error message for free tier exceeding limit", async () => {
      const tool = createTavilyFetchTool(workspaceId);
      const { tooManyRequests } = await import("@hapi/boom");

      mockCheckTavilyDailyLimit.mockRejectedValue(
        tooManyRequests("Daily Tavily API call limit exceeded")
      );

      const result = await (tool as any).execute({
        url: "https://example.com/article",
      });

      expect(result).toContain("Error fetching content with Tavily");
      expect(result).toContain("Daily Tavily API call limit exceeded");
    });

    it("should refund credits on API error", async () => {
      const tool = createTavilyFetchTool(workspaceId);
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

      const result = await (tool as any).execute({
        url: "https://example.com/article",
      });

      expect(result).toContain("Error fetching content with Tavily");
      expect(result).toContain("Tavily API error");
      expect(mockRefundTavilyCredits).toHaveBeenCalledWith(
        mockDb,
        "test-reservation-id",
        workspaceId,
        3 // maxRetries
      );
    });

    it("should handle tracking failure gracefully", async () => {
      const tool = createTavilyFetchTool(workspaceId);
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
      mockIncrementTavilyCallBucket.mockRejectedValue(
        new Error("Tracking failed")
      );

      // Should not throw - tracking failure is logged but doesn't fail the tool
      const result = await (tool as any).execute({
        url: "https://example.com/article",
      });

      expect(result).toContain("Test Page");
    });

    it("should handle missing title and content", async () => {
      const tool = createTavilyFetchTool(workspaceId);
      const extractResponse = {
        url: "https://example.com/article",
      };

      mockCheckTavilyDailyLimit.mockResolvedValue({
        withinFreeLimit: true,
        callCount: 5,
      });
      mockTavilyExtract.mockResolvedValue(extractResponse);
      mockExtractCreditsUsed.mockReturnValue(1);
      mockIncrementTavilyCallBucket.mockResolvedValue({
        pk: "tavily-call-buckets/test-workspace/2024-01-15T14:00:00.000Z",
        workspaceId,
        hourTimestamp: "2024-01-15T14:00:00.000Z",
        count: 6,
        expires: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      });

      const result = await (tool as any).execute({
        url: "https://example.com/article",
      });

      expect(result).toContain("https://example.com/article");
    });
  });
});

