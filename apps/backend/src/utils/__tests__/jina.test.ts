import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { jinaFetch, jinaSearch } from "../jina";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("jina", () => {
  const originalEnv = process.env.JINA_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  afterEach(() => {
    if (originalEnv) {
      process.env.JINA_API_KEY = originalEnv;
    } else {
      delete process.env.JINA_API_KEY;
    }
  });

  describe("jinaFetch", () => {
    it("should successfully fetch content with valid URL", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        text: async () => "# Test Title\n\nThis is test content from Jina Reader API.",
        headers: new Headers(),
      };

      mockFetch.mockResolvedValueOnce(mockResponse);

      const result = await jinaFetch("https://example.com/article");

      expect(result).toEqual({
        url: "https://example.com/article",
        content: "# Test Title\n\nThis is test content from Jina Reader API.",
        title: "Test Title",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://r.jina.ai/https://example.com/article",
        {
          method: "GET",
          headers: {
            Accept: "text/plain",
            "User-Agent": "Helpmaton/1.0",
          },
          signal: expect.any(AbortSignal),
        }
      );
    });

    it("should include API key in headers when provided", async () => {
      process.env.JINA_API_KEY = "test-api-key";

      const mockResponse = {
        ok: true,
        status: 200,
        text: async () => "Test content",
        headers: new Headers(),
      };

      mockFetch.mockResolvedValueOnce(mockResponse);

      await jinaFetch("https://example.com/article");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://r.jina.ai/https://example.com/article",
        {
          method: "GET",
          headers: {
            Accept: "text/plain",
            "User-Agent": "Helpmaton/1.0",
            Authorization: "Bearer test-api-key",
          },
          signal: expect.any(AbortSignal),
        }
      );
    });

    it("should accept API key from options parameter", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        text: async () => "Test content",
        headers: new Headers(),
      };

      mockFetch.mockResolvedValueOnce(mockResponse);

      await jinaFetch("https://example.com/article", {
        apiKey: "custom-api-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://r.jina.ai/https://example.com/article",
        {
          method: "GET",
          headers: {
            Accept: "text/plain",
            "User-Agent": "Helpmaton/1.0",
            Authorization: "Bearer custom-api-key",
          },
          signal: expect.any(AbortSignal),
        }
      );
    });

    it("should throw error on invalid URL", async () => {
      await expect(jinaFetch("not-a-url")).rejects.toThrow("Invalid URL");
    });

    it("should throw error on 429 rate limit and retry", async () => {
      const rateLimitResponse = {
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        text: async () => "Rate limit exceeded",
        headers: new Headers({
          "Retry-After": "1",
        }),
      };

      const successResponse = {
        ok: true,
        status: 200,
        text: async () => "Success after retry",
        headers: new Headers(),
      };

      // First call: rate limit, second call: success
      mockFetch
        .mockResolvedValueOnce(rateLimitResponse)
        .mockResolvedValueOnce(successResponse);

      // Mock sleep to avoid actual delays in tests
      vi.spyOn(global, "setTimeout").mockImplementation(
        (fn: () => void) => {
          fn();
          return {} as NodeJS.Timeout;
        }
      );

      const result = await jinaFetch("https://example.com/article");

      expect(result.content).toBe("Success after retry");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should throw error on 500 server error and retry", async () => {
      const serverErrorResponse = {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "Server error",
        headers: new Headers(),
      };

      const successResponse = {
        ok: true,
        status: 200,
        text: async () => "Success after retry",
        headers: new Headers(),
      };

      // First call: server error, second call: success
      mockFetch
        .mockResolvedValueOnce(serverErrorResponse)
        .mockResolvedValueOnce(successResponse);

      // Mock sleep to avoid actual delays in tests
      vi.spyOn(global, "setTimeout").mockImplementation(
        (fn: () => void) => {
          fn();
          return {} as NodeJS.Timeout;
        }
      );

      const result = await jinaFetch("https://example.com/article");

      expect(result.content).toBe("Success after retry");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should throw error after max retries", async () => {
      const errorResponse = {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "Server error",
        headers: new Headers(),
      };

      // All calls fail
      mockFetch.mockResolvedValue(errorResponse);

      // Mock sleep to avoid actual delays in tests
      vi.spyOn(global, "setTimeout").mockImplementation(
        (fn: () => void) => {
          fn();
          return {} as NodeJS.Timeout;
        }
      );

      await expect(
        jinaFetch("https://example.com/article")
      ).rejects.toThrow("Jina Reader API error");

      // Should retry 3 times (4 total attempts: initial + 3 retries)
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it("should extract title from markdown content", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        text: async () => "# My Article Title\n\nArticle content here.",
        headers: new Headers(),
      };

      mockFetch.mockResolvedValueOnce(mockResponse);

      const result = await jinaFetch("https://example.com/article");

      expect(result.title).toBe("My Article Title");
    });

    it("should use domain name as fallback title if no markdown title", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        text: async () => "Plain text content without markdown title.",
        headers: new Headers(),
      };

      mockFetch.mockResolvedValueOnce(mockResponse);

      const result = await jinaFetch("https://example.com/article");

      expect(result.title).toBe("example.com");
    });

    it("should handle timeout errors and retry", async () => {
      const timeoutError = new Error("timeout");
      timeoutError.name = "AbortError";

      const successResponse = {
        ok: true,
        status: 200,
        text: async () => "Success after timeout retry",
        headers: new Headers(),
      };

      // First call: timeout, second call: success
      mockFetch
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce(successResponse);

      // Mock sleep to avoid actual delays in tests
      vi.spyOn(global, "setTimeout").mockImplementation(
        (fn: () => void) => {
          fn();
          return {} as NodeJS.Timeout;
        }
      );

      const result = await jinaFetch("https://example.com/article");

      expect(result.content).toBe("Success after timeout retry");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should work without API key", async () => {
      delete process.env.JINA_API_KEY;

      const mockResponse = {
        ok: true,
        status: 200,
        text: async () => "Test content",
        headers: new Headers(),
      };

      mockFetch.mockResolvedValueOnce(mockResponse);

      const result = await jinaFetch("https://example.com/article");

      expect(result.content).toBe("Test content");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://r.jina.ai/https://example.com/article",
        expect.objectContaining({
          headers: expect.not.objectContaining({
            Authorization: expect.anything(),
          }),
        })
      );
    });
  });

  describe("jinaSearch", () => {
    it("should successfully search with valid query", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: async () => ({
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
        }),
        headers: new Headers(),
      };

      mockFetch.mockResolvedValueOnce(mockResponse);

      const result = await jinaSearch("AI news");

      expect(result.query).toBe("AI news");
      expect(result.results.length).toBe(2);
      expect(result.results[0].title).toBe("Article 1");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://s.jina.ai/q=AI%20news",
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            "User-Agent": "Helpmaton/1.0",
            "X-Respond-With": "no-content",
          },
          signal: expect.any(AbortSignal),
        }
      );
    });

    it("should include API key in headers when provided", async () => {
      process.env.JINA_API_KEY = "test-api-key";

      const mockResponse = {
        ok: true,
        status: 200,
        json: async () => ({
          results: [],
        }),
        headers: new Headers(),
      };

      mockFetch.mockResolvedValueOnce(mockResponse);

      await jinaSearch("test query");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://s.jina.ai/q=test%20query",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-api-key",
            "X-Respond-With": "no-content",
          }),
        })
      );
    });

    it("should respect max_results parameter by limiting results", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            { title: "Result 1", url: "https://example.com/1", content: "Content 1" },
            { title: "Result 2", url: "https://example.com/2", content: "Content 2" },
            { title: "Result 3", url: "https://example.com/3", content: "Content 3" },
            { title: "Result 4", url: "https://example.com/4", content: "Content 4" },
            { title: "Result 5", url: "https://example.com/5", content: "Content 5" },
            { title: "Result 6", url: "https://example.com/6", content: "Content 6" },
          ],
        }),
        headers: new Headers(),
      };

      mockFetch.mockResolvedValueOnce(mockResponse);

      const result = await jinaSearch("test query", { max_results: 3 });

      expect(result.results.length).toBe(3);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://s.jina.ai/q=test%20query",
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-Respond-With": "no-content",
          }),
        })
      );
    });

    it("should clamp max_results to valid range", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: async () => ({
          results: Array(15).fill(null).map((_, i) => ({
            title: `Result ${i + 1}`,
            url: `https://example.com/${i + 1}`,
            content: `Content ${i + 1}`,
          })),
        }),
        headers: new Headers(),
      };

      mockFetch.mockResolvedValueOnce(mockResponse);

      // Test max clamping (should limit to 10 even if API returns more)
      const result1 = await jinaSearch("test query", { max_results: 20 });
      expect(result1.results.length).toBe(10);

      mockFetch.mockClear();
      mockFetch.mockResolvedValueOnce(mockResponse);

      // Test min clamping (should limit to 1 even if API returns more)
      const result2 = await jinaSearch("test query", { max_results: 0 });
      expect(result2.results.length).toBe(1);
    });

    it("should throw error on empty query", async () => {
      await expect(jinaSearch("")).rejects.toThrow("Search query is required");
      await expect(jinaSearch("   ")).rejects.toThrow("Search query is required");
    });

    it("should throw error on 429 rate limit and retry", async () => {
      const rateLimitResponse = {
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        text: async () => "Rate limit exceeded",
        headers: new Headers({
          "Retry-After": "1",
        }),
      };

      const successResponse = {
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            {
              title: "Result after retry",
              url: "https://example.com/article",
              content: "Search results after retry",
            },
          ],
        }),
        headers: new Headers(),
      };

      mockFetch
        .mockResolvedValueOnce(rateLimitResponse)
        .mockResolvedValueOnce(successResponse);

      vi.spyOn(global, "setTimeout").mockImplementation(
        (fn: () => void) => {
          fn();
          return {} as NodeJS.Timeout;
        }
      );

      const result = await jinaSearch("test query");

      expect(result.query).toBe("test query");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should throw error after max retries", async () => {
      const errorResponse = {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "Server error",
        headers: new Headers(),
      };

      mockFetch.mockResolvedValue(errorResponse);

      vi.spyOn(global, "setTimeout").mockImplementation(
        (fn: () => void) => {
          fn();
          return {} as NodeJS.Timeout;
        }
      );

      await expect(jinaSearch("test query")).rejects.toThrow(
        "Jina Search API error"
      );

      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it("should parse results with structured data", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            {
              title: "Article 1",
              url: "https://example.com/article1",
              content: "Content 1",
              score: 0.95,
            },
            {
              title: "Article 2",
              url: "https://example.com/article2",
              content: "Content 2",
              score: 0.85,
            },
          ],
        }),
        headers: new Headers(),
      };

      mockFetch.mockResolvedValueOnce(mockResponse);

      const result = await jinaSearch("test query");

      expect(result.results).toHaveLength(2);
      expect(result.results[0].title).toBe("Article 1");
      expect(result.results[0].url).toBe("https://example.com/article1");
      expect(result.results[0].score).toBe(0.95);
    });

    it("should handle alternative response format with data array", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              title: "Article 1",
              url: "https://example.com/article1",
              description: "Description 1",
              score: 0.95,
            },
          ],
        }),
        headers: new Headers(),
      };

      mockFetch.mockResolvedValueOnce(mockResponse);

      const result = await jinaSearch("test query");

      expect(result.results).toHaveLength(1);
      expect(result.results[0].title).toBe("Article 1");
      expect(result.results[0].content).toBe("Description 1");
    });

    it("should extract answer if available", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: async () => ({
          answer: "Summary answer",
          results: [],
        }),
        headers: new Headers(),
      };

      mockFetch.mockResolvedValueOnce(mockResponse);

      const result = await jinaSearch("test query");

      expect(result.answer).toBe("Summary answer");
    });
  });
});

