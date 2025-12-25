import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  tavilySearch,
  tavilyExtract,
  extractCreditsUsed,
  type TavilySearchResponse,
  type TavilyExtractResponse,
} from "../tavily";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("tavily", () => {
  const originalEnv = process.env.TAVILY_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
    process.env.TAVILY_API_KEY = "test-api-key";
  });

  afterEach(() => {
    process.env.TAVILY_API_KEY = originalEnv;
  });

  describe("tavilySearch", () => {
    it("should successfully search with valid query", async () => {
      const mockResponse: TavilySearchResponse = {
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

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
        text: async () => JSON.stringify(mockResponse),
        headers: new Headers(),
      } as Response);

      const result = await tavilySearch("test query");

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.tavily.com/search",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: expect.stringContaining("test query"),
        })
      );
    });

    it("should throw error when API key is not set", async () => {
      delete process.env.TAVILY_API_KEY;

      await expect(tavilySearch("test query")).rejects.toThrow(
        "TAVILY_API_KEY environment variable is not set"
      );
    });

    it("should throw error on API error response", async () => {
      const mockResponse = {
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: async () => "Bad Request",
        headers: new Headers(),
      } as unknown as Response;
      
      mockFetch.mockResolvedValueOnce(mockResponse);

      await expect(tavilySearch("test query")).rejects.toThrow(
        "Tavily search API error"
      );
    });

    it("should retry on rate limit error", async () => {
      // First call: rate limit
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        text: async () => "Rate limit exceeded",
        headers: new Headers(),
      } as Response);

      // Second call: success
      const mockResponse: TavilySearchResponse = {
        query: "test query",
        response_time: 0.5,
        results: [],
        usage: {
          credits_used: 1,
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
        text: async () => JSON.stringify(mockResponse),
        headers: new Headers(),
      } as Response);

      // Use fake timers to speed up retry
      vi.useFakeTimers();
      const searchPromise = tavilySearch("test query");
      await vi.advanceTimersByTimeAsync(2000);
      const result = await searchPromise;
      vi.useRealTimers();

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should use default max_results when not provided", async () => {
      const mockResponse: TavilySearchResponse = {
        query: "test query",
        response_time: 0.5,
        results: [],
        usage: {
          credits_used: 1,
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
        text: async () => JSON.stringify(mockResponse),
        headers: new Headers(),
      } as Response);

      await tavilySearch("test query");

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.max_results).toBe(5);
    });
  });

  describe("tavilyExtract", () => {
    it("should successfully extract content from URL", async () => {
      const mockResponse: TavilyExtractResponse = {
        url: "https://example.com",
        title: "Example Page",
        content: "Example content",
        usage: {
          credits_used: 1,
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
        text: async () => JSON.stringify(mockResponse),
        headers: new Headers(),
      } as Response);

      const result = await tavilyExtract("https://example.com");

      expect(result).toEqual(mockResponse);
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.urls).toEqual(["https://example.com"]);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.tavily.com/extract",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        })
      );
    });

    it("should throw error when API key is not set", async () => {
      delete process.env.TAVILY_API_KEY;

      await expect(tavilyExtract("https://example.com")).rejects.toThrow(
        "TAVILY_API_KEY environment variable is not set"
      );
    });

    it("should throw error on API error response", async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "Not Found",
        headers: new Headers(),
      } as unknown as Response;
      
      mockFetch.mockResolvedValueOnce(mockResponse);

      await expect(tavilyExtract("https://example.com")).rejects.toThrow(
        "Tavily extract API error"
      );
    });

    it("should handle array response from API", async () => {
      // Tavily API returns an array when urls is provided as an array
      const mockArrayResponse: TavilyExtractResponse[] = [
        {
          url: "https://example.com",
          title: "Example Page",
          content: "Example content",
          usage: {
            credits_used: 1,
          },
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockArrayResponse,
        text: async () => JSON.stringify(mockArrayResponse),
        headers: new Headers(),
      } as Response);

      const result = await tavilyExtract("https://example.com");

      expect(result).toEqual(mockArrayResponse[0]);
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.urls).toEqual(["https://example.com"]);
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
  });
});

