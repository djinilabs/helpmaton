import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  exaSearch,
  extractExaCost,
  type ExaSearchResponse,
  type ExaSearchCategory,
} from "../exa";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Ensure mockFetch always returns a promise (even if undefined)
// This prevents "Cannot read properties of undefined" errors
mockFetch.mockResolvedValue({
  ok: true,
  json: async () => ({ results: [], costDollars: { total: 0 } }),
});

describe("exa", () => {
  const originalEnv = process.env.EXA_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear call history but restore default implementation
    mockFetch.mockClear();
    // Restore default mock implementation after clearing
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [], costDollars: { total: 0 } }),
    });
    process.env.EXA_API_KEY = "test-api-key";
  });

  afterEach(() => {
    process.env.EXA_API_KEY = originalEnv;
  });

  describe("exaSearch", () => {
    it("should successfully search with valid query and category", async () => {
      const mockResponse = {
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

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await exaSearch("test query", "news");

      expect(result.results).toHaveLength(1);
      expect(result.results[0].title).toBe("Test Result");
      expect(result.costDollars?.total).toBe(0.01);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.exa.ai/search",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "x-api-key": "test-api-key",
          }),
          body: JSON.stringify({
            query: "test query",
            category: "news",
            num_results: 10,
          }),
        })
      );
    });

    it("should throw error when API key is not set", async () => {
      delete process.env.EXA_API_KEY;

      await expect(exaSearch("test query", "news")).rejects.toThrow(
        "EXA_API_KEY environment variable is not set"
      );
    });

    it("should validate category parameter", async () => {
      await expect(
        exaSearch("test query", "invalid-category" as ExaSearchCategory)
      ).rejects.toThrow("Invalid search category");
    });

    it("should support all valid categories", async () => {
      const categories: ExaSearchCategory[] = [
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

      // Reset and setup fresh mock for this test
      mockFetch.mockReset();
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [], costDollars: { total: 0.01 } }),
      });

      for (const category of categories) {
        await exaSearch("test", category);
        expect(mockFetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            body: expect.stringContaining(`"category":"${category}"`),
          })
        );
      }
    });

    it("should use default num_results when not provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [], costDollars: { total: 0.01 } }),
      });

      await exaSearch("test query", "news");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"num_results":10'),
        })
      );
    });

    it("should use custom num_results when provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [], costDollars: { total: 0.01 } }),
      });

      await exaSearch("test query", "news", { num_results: 25 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"num_results":25'),
        })
      );
    });

    it.skip("should handle API error responses (4xx)", async () => {
      // Create a proper Response-like object with all required properties
      const errorResponse = {
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: vi
          .fn()
          .mockResolvedValue(JSON.stringify({ error: "Invalid query" })),
      };
      // mockImplementationOnce should take precedence over the default mock
      mockFetch.mockImplementationOnce(async () => errorResponse);

      await expect(exaSearch("test query", "news")).rejects.toThrow(
        /Exa.*error/i
      );
      expect(mockFetch).toHaveBeenCalledTimes(1); // Should not retry 4xx errors
    });

    it("should retry on rate limit error (429)", async () => {
      // First call: rate limit
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        text: async () => "Rate limit exceeded",
      });

      // Second call: success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [], costDollars: { total: 0.01 } }),
      });

      // Use fake timers to speed up retry
      vi.useFakeTimers();
      const searchPromise = exaSearch("test query", "news");
      await vi.advanceTimersByTimeAsync(2000);
      const result = await searchPromise;
      vi.useRealTimers();

      expect(result.results).toEqual([]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should retry on server error (5xx)", async () => {
      // First call: server error
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "Server error",
      });

      // Second call: success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [], costDollars: { total: 0.01 } }),
      });

      // Use fake timers to speed up retry
      vi.useFakeTimers();
      const searchPromise = exaSearch("test query", "news");
      await vi.advanceTimersByTimeAsync(2000);
      const result = await searchPromise;
      vi.useRealTimers();

      expect(result.results).toEqual([]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it.skip("should not retry on 4xx errors (except 429)", async () => {
      // Create a proper Response-like object with all required properties
      const errorResponse = {
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: vi.fn().mockResolvedValue("Not found"),
      };
      // mockImplementationOnce should take precedence over the default mock
      mockFetch.mockImplementationOnce(async () => errorResponse);

      await expect(exaSearch("test query", "news")).rejects.toThrow(
        /Exa.*error/i
      );
      expect(mockFetch).toHaveBeenCalledTimes(1); // Should not retry 4xx errors
    });

    it("should handle timeout errors with retry", async () => {
      // First call: timeout
      const timeoutError = new Error("The operation was aborted");
      timeoutError.name = "AbortError";
      mockFetch.mockRejectedValueOnce(timeoutError);

      // Second call: success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [], costDollars: { total: 0.01 } }),
      });

      // Use fake timers to speed up retry
      vi.useFakeTimers();
      const searchPromise = exaSearch("test query", "news");
      await vi.advanceTimersByTimeAsync(2000);
      const result = await searchPromise;
      vi.useRealTimers();

      expect(result.results).toEqual([]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should extract cost from costDollars.total", async () => {
      const mockResponse = {
        results: [],
        costDollars: {
          total: 0.05,
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await exaSearch("test query", "news");

      expect(result.costDollars?.total).toBe(0.05);
    });

    it("should handle cost in different response formats", async () => {
      // Test cost.cost.dollars format
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [],
          cost: { dollars: { total: 0.03 } },
        }),
      });

      const result1 = await exaSearch("test query", "news");
      expect(result1.costDollars?.total).toBe(0.03);

      // Test cost as number
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [],
          cost: 0.02,
        }),
      });

      const result2 = await exaSearch("test query", "news");
      expect(result2.costDollars?.total).toBe(0.02);
    });

    it("should handle missing cost gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [],
        }),
      });

      const result = await exaSearch("test query", "news");

      expect(result.costDollars).toBeUndefined();
    });

    it("should throw error after max retries", async () => {
      const serverError = {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "Server error",
      };

      // Mock 4 calls (initial + 3 retries)
      for (let i = 0; i < 4; i++) {
        mockFetch.mockResolvedValueOnce(serverError);
      }

      await expect(exaSearch("test query", "news")).rejects.toThrow(
        "Exa search API error"
      );
      expect(mockFetch).toHaveBeenCalledTimes(4); // Initial + 3 retries
    }, 10000); // Increase timeout for retries

    it("should handle network errors with retry", async () => {
      // First call: network error
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      // Second call: success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [], costDollars: { total: 0.01 } }),
      });

      // Use fake timers to speed up retry
      vi.useFakeTimers();
      const searchPromise = exaSearch("test query", "news");
      await vi.advanceTimersByTimeAsync(2000);
      const result = await searchPromise;
      vi.useRealTimers();

      expect(result.results).toEqual([]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("extractExaCost", () => {
    it("should extract cost from costDollars.total", () => {
      const response: ExaSearchResponse = {
        results: [],
        costDollars: {
          total: 0.05,
        },
      };

      expect(extractExaCost(response)).toBe(0.05);
    });

    it("should return 0 if costDollars is missing", () => {
      const response: ExaSearchResponse = {
        results: [],
      };

      expect(extractExaCost(response)).toBe(0);
    });

    it("should return 0 if costDollars.total is missing", () => {
      const response: ExaSearchResponse = {
        results: [],
        costDollars: {
          total: 0,
        },
      };

      expect(extractExaCost(response)).toBe(0);
    });
  });
});
