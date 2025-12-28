import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { jinaFetch } from "../jina";

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
});

