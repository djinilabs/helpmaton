import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  tavilySearch,
  tavilyExtract,
  extractCreditsUsed,
  resetTavilyClient,
  type TavilySearchResponse,
  type TavilyExtractResponse,
} from "../tavily";

// Mock @tavily/core
const mockSearch = vi.fn();
const mockExtract = vi.fn();
const mockTavilyClient = {
  search: mockSearch,
  extract: mockExtract,
};

vi.mock("@tavily/core", () => ({
  tavily: vi.fn(() => mockTavilyClient),
}));

describe("tavily", () => {
  const originalEnv = process.env.TAVILY_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch.mockClear();
    mockExtract.mockClear();
    resetTavilyClient(); // Reset client singleton between tests
    process.env.TAVILY_API_KEY = "test-api-key";
  });

  afterEach(() => {
    resetTavilyClient(); // Reset client singleton after tests
    process.env.TAVILY_API_KEY = originalEnv;
  });

  describe("tavilySearch", () => {
    it("should successfully search with valid query", async () => {
      const mockLibraryResponse = {
        query: "test query",
        responseTime: 0.5,
        results: [
          {
            title: "Test Result",
            url: "https://example.com",
            content: "Test content",
            score: 0.9,
          },
        ],
        usage: {
          credits: 1,
        },
        requestId: "test-request-id",
      };

      const expectedResponse: TavilySearchResponse = {
        query: "test query",
        response_time: 0.5,
        results: [
          {
            title: "Test Result",
            url: "https://example.com",
            content: "Test content",
            score: 0.9,
          },
        ],
        usage: {
          credits_used: 1,
        },
      };

      mockSearch.mockResolvedValueOnce(mockLibraryResponse);

      const result = await tavilySearch("test query");

      expect(result).toEqual(expectedResponse);
      expect(mockSearch).toHaveBeenCalledWith("test query", {
        maxResults: 5,
        searchDepth: "basic",
        includeAnswer: false,
        includeRawContent: false,
        includeImages: false,
        includeUsage: true,
        timeout: 30, // in seconds
      });
    });

    it("should throw error when API key is not set", async () => {
      delete process.env.TAVILY_API_KEY;

      await expect(tavilySearch("test query")).rejects.toThrow(
        "TAVILY_API_KEY environment variable is not set"
      );
    });

    it("should throw error on API error response", async () => {
      const apiError = new Error("Bad Request");
      apiError.name = "TavilyError";
      mockSearch.mockRejectedValueOnce(apiError);

      await expect(tavilySearch("test query")).rejects.toThrow(
        "Tavily search API error"
      );
    });

    it("should retry on rate limit error", async () => {
      // First call: rate limit
      const rateLimitError = new Error("Rate limit exceeded");
      rateLimitError.message = "429 Rate limit exceeded";
      mockSearch.mockRejectedValueOnce(rateLimitError);

      // Second call: success
      const mockLibraryResponse = {
        query: "test query",
        responseTime: 0.5,
        results: [],
        usage: {
          credits: 1,
        },
        requestId: "test-request-id",
      };

      mockSearch.mockResolvedValueOnce(mockLibraryResponse);

      // Use fake timers to speed up retry
      vi.useFakeTimers();
      const searchPromise = tavilySearch("test query");
      await vi.advanceTimersByTimeAsync(2000);
      const result = await searchPromise;
      vi.useRealTimers();

      expect(result.query).toBe("test query");
      expect(mockSearch).toHaveBeenCalledTimes(2);
    });

    it("should use default max_results when not provided", async () => {
      const mockLibraryResponse = {
        query: "test query",
        responseTime: 0.5,
        results: [],
        usage: {
          credits: 1,
        },
        requestId: "test-request-id",
      };

      mockSearch.mockResolvedValueOnce(mockLibraryResponse);

      await tavilySearch("test query");

      expect(mockSearch).toHaveBeenCalledWith(
        "test query",
        expect.objectContaining({
          maxResults: 5,
        })
      );
    });

    it("should map options correctly", async () => {
      const mockLibraryResponse = {
        query: "test query",
        responseTime: 0.5,
        results: [],
        usage: {
          credits: 1,
        },
        requestId: "test-request-id",
      };

      mockSearch.mockResolvedValueOnce(mockLibraryResponse);

      await tavilySearch("test query", {
        max_results: 10,
        search_depth: "advanced",
        include_answer: true,
        include_raw_content: true,
        include_images: true,
      });

      expect(mockSearch).toHaveBeenCalledWith("test query", {
        maxResults: 10,
        searchDepth: "advanced",
        includeAnswer: true,
        includeRawContent: "text",
        includeImages: true,
        includeUsage: true,
        timeout: 30, // in seconds
      });
    });

    it("should convert library response format correctly", async () => {
      const mockLibraryResponse = {
        query: "test query",
        responseTime: 1.5,
        answer: "Test answer",
        images: [
          { url: "https://example.com/image1.jpg", description: "Image 1" },
          { url: "https://example.com/image2.jpg" },
        ],
        results: [
          {
            title: "Result 1",
            url: "https://example.com/1",
            content: "Content 1",
            score: 0.9,
            rawContent: "Raw content 1",
          },
        ],
        usage: {
          credits: 2,
        },
        requestId: "test-request-id",
      };

      mockSearch.mockResolvedValueOnce(mockLibraryResponse);

      const result = await tavilySearch("test query");

      expect(result).toEqual({
        query: "test query",
        response_time: 1.5,
        answer: "Test answer",
        images: [
          "https://example.com/image1.jpg",
          "https://example.com/image2.jpg",
        ],
        results: [
          {
            title: "Result 1",
            url: "https://example.com/1",
            content: "Content 1",
            score: 0.9,
            raw_content: "Raw content 1",
          },
        ],
        usage: {
          credits_used: 2,
        },
      });
    });
  });

  describe("tavilyExtract", () => {
    it("should successfully extract content from URL", async () => {
      const mockLibraryResponse = {
        results: [
          {
            url: "https://example.com",
            rawContent: "Example content",
            images: ["https://example.com/image.jpg"],
          },
        ],
        failedResults: [],
        responseTime: 0.5,
        usage: {
          credits: 1,
        },
        requestId: "test-request-id",
      };

      const expectedResponse: TavilyExtractResponse = {
        url: "https://example.com",
        content: "Example content",
        images: ["https://example.com/image.jpg"],
        raw_content: "Example content",
        usage: {
          credits_used: 1,
        },
      };

      mockExtract.mockResolvedValueOnce(mockLibraryResponse);

      const result = await tavilyExtract("https://example.com");

      expect(result).toEqual(expectedResponse);
      expect(mockExtract).toHaveBeenCalledWith(["https://example.com"], {
        includeImages: false,
        format: undefined,
        includeUsage: true,
        timeout: 30, // in seconds
      });
    });

    it("should throw error when API key is not set", async () => {
      delete process.env.TAVILY_API_KEY;

      await expect(tavilyExtract("https://example.com")).rejects.toThrow(
        "TAVILY_API_KEY environment variable is not set"
      );
    });

    it("should throw error on API error response", async () => {
      const apiError = new Error("Not Found");
      apiError.name = "TavilyError";
      mockExtract.mockRejectedValueOnce(apiError);

      await expect(tavilyExtract("https://example.com")).rejects.toThrow(
        "Tavily extract API error"
      );
    });

    it("should handle failed results from library", async () => {
      const mockLibraryResponse = {
        results: [],
        failedResults: [
          {
            url: "https://example.com",
            error: "Failed to extract content",
          },
        ],
        responseTime: 0.5,
        usage: {
          credits: 1,
        },
        requestId: "test-request-id",
      };

      mockExtract.mockResolvedValueOnce(mockLibraryResponse);

      await expect(tavilyExtract("https://example.com")).rejects.toThrow(
        "Tavily extract API error: Failed to extract"
      );
    });

    it("should handle empty results array", async () => {
      const mockLibraryResponse = {
        results: [],
        failedResults: [],
        responseTime: 0.5,
        usage: {
          credits: 1,
        },
        requestId: "test-request-id",
      };

      mockExtract.mockResolvedValueOnce(mockLibraryResponse);

      await expect(tavilyExtract("https://example.com")).rejects.toThrow(
        "Tavily extract API error: No results returned"
      );
    });

    it("should map options correctly", async () => {
      const mockLibraryResponse = {
        results: [
          {
            url: "https://example.com",
            rawContent: "Example content",
          },
        ],
        failedResults: [],
        responseTime: 0.5,
        usage: {
          credits: 1,
        },
        requestId: "test-request-id",
      };

      mockExtract.mockResolvedValueOnce(mockLibraryResponse);

      await tavilyExtract("https://example.com", {
        include_images: true,
        include_raw_content: true,
      });

      expect(mockExtract).toHaveBeenCalledWith(["https://example.com"], {
        includeImages: true,
        format: "text",
        includeUsage: true,
        timeout: 30, // in seconds
      });
    });

    it("should use first result when multiple URLs provided", async () => {
      const mockLibraryResponse = {
        results: [
          {
            url: "https://example.com",
            rawContent: "Example content",
          },
          {
            url: "https://other.com",
            rawContent: "Other content",
          },
        ],
        failedResults: [],
        responseTime: 0.5,
        usage: {
          credits: 1,
        },
        requestId: "test-request-id",
      };

      mockExtract.mockResolvedValueOnce(mockLibraryResponse);

      const result = await tavilyExtract("https://example.com");

      expect(result.url).toBe("https://example.com");
      expect(result.content).toBe("Example content");
    });

    it("should retry on rate limit error", async () => {
      // First call: rate limit
      const rateLimitError = new Error("429 Rate limit exceeded");
      mockExtract.mockRejectedValueOnce(rateLimitError);

      // Second call: success
      const mockLibraryResponse = {
        results: [
          {
            url: "https://example.com",
            rawContent: "Example content",
          },
        ],
        failedResults: [],
        responseTime: 0.5,
        usage: {
          credits: 1,
        },
        requestId: "test-request-id",
      };

      mockExtract.mockResolvedValueOnce(mockLibraryResponse);

      // Use fake timers to speed up retry
      vi.useFakeTimers();
      const extractPromise = tavilyExtract("https://example.com");
      await vi.advanceTimersByTimeAsync(2000);
      const result = await extractPromise;
      vi.useRealTimers();

      expect(result.url).toBe("https://example.com");
      expect(mockExtract).toHaveBeenCalledTimes(2);
    });
  });

  describe("extractCreditsUsed", () => {
    it("should extract credits from search response", () => {
      const response: TavilySearchResponse = {
        query: "test",
        response_time: 0.5,
        results: [],
        usage: {
          credits_used: 2,
        },
      };

      expect(extractCreditsUsed(response)).toBe(2);
    });

    it("should extract credits from extract response", () => {
      const response: TavilyExtractResponse = {
        url: "https://example.com",
        content: "test",
        usage: {
          credits_used: 1,
        },
      };

      expect(extractCreditsUsed(response)).toBe(1);
    });

    it("should default to 1 credit if usage not specified", () => {
      const response: TavilySearchResponse = {
        query: "test",
        response_time: 0.5,
        results: [],
      };

      expect(extractCreditsUsed(response)).toBe(1);
    });

    it("should return 1 credit when Tavily reports 0 credits", () => {
      const response: TavilySearchResponse = {
        query: "test",
        response_time: 0.5,
        results: [],
        usage: {
          credits_used: 0,
        },
      };

      expect(extractCreditsUsed(response)).toBe(1);
    });
  });
});
