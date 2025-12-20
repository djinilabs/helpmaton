import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockQuery } = vi.hoisted(() => {
  return {
    mockQuery: vi.fn(),
  };
});

// Mock LanceDB readClient
vi.mock("../vectordb/readClient", () => ({
  query: mockQuery,
}));

// Mock fetch globally
global.fetch = vi.fn();

// Import after mocks are set up
import {
  splitDocumentIntoSnippets,
  cosineSimilarity,
  searchDocuments,
} from "../documentSearch";
import { generateEmbedding } from "../embedding";

describe("documentSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    // Setup mock LanceDB query to return empty results by default
    mockQuery.mockResolvedValue([]);

    // Setup default environment
    process.env.GEMINI_API_KEY = "test-api-key";
    process.env.GEMINI_REFERER = "http://localhost:3000";
  });

  describe("splitDocumentIntoSnippets", () => {
    it("should return empty array for empty content", () => {
      expect(splitDocumentIntoSnippets("")).toEqual([]);
      expect(splitDocumentIntoSnippets("   ")).toEqual([]);
    });

    it("should split content by paragraphs", () => {
      const content = "Paragraph 1\n\nParagraph 2\n\nParagraph 3";
      const snippets = splitDocumentIntoSnippets(content, 100);

      expect(snippets.length).toBeGreaterThan(0);
      expect(snippets[0]).toContain("Paragraph 1");
    });

    it("should combine small paragraphs into chunks", () => {
      const content = "Short para 1\n\nShort para 2\n\nShort para 3";
      const snippets = splitDocumentIntoSnippets(content, 200);

      // Should combine multiple small paragraphs
      expect(snippets.length).toBeLessThan(3);
    });

    it("should split large paragraphs that exceed chunk size", () => {
      const longParagraph = "A".repeat(5000);
      const snippets = splitDocumentIntoSnippets(longParagraph, 2000);

      expect(snippets.length).toBeGreaterThan(1);
      // With overlap, chunks may be slightly larger than chunkSize
      // Allow up to chunkSize + overlap (2000 + 200 = 2200)
      snippets.forEach((snippet) => {
        expect(snippet.length).toBeLessThanOrEqual(2200);
      });
    });

    it("should try to break at sentence boundaries when splitting large paragraphs", () => {
      const content = "Sentence one. Sentence two. " + "A".repeat(3000);
      const snippets = splitDocumentIntoSnippets(content, 2000);

      // Should prefer breaking at sentence boundaries
      expect(snippets.length).toBeGreaterThan(1);
    });

    it("should handle content with no paragraphs by splitting by character count", () => {
      const content = "A".repeat(5000);
      const snippets = splitDocumentIntoSnippets(content, 1000);

      expect(snippets.length).toBeGreaterThan(1);
      // With overlap, chunks may be slightly larger than chunkSize
      // Allow up to chunkSize + overlap (1000 + 200 = 1200)
      snippets.forEach((snippet) => {
        expect(snippet.length).toBeLessThanOrEqual(1200);
      });
    });

    it("should respect custom chunk size", () => {
      const content = "A".repeat(5000);
      const snippets = splitDocumentIntoSnippets(content, 500);

      expect(snippets.length).toBeGreaterThan(5);
      // With overlap, chunks may be slightly larger than chunkSize
      // Allow up to chunkSize + overlap (500 + 200 = 700)
      snippets.forEach((snippet) => {
        expect(snippet.length).toBeLessThanOrEqual(700);
      });
    });

    it("should filter out empty snippets", () => {
      const content = "Valid content\n\n\n\nMore valid content";
      const snippets = splitDocumentIntoSnippets(content, 100);

      snippets.forEach((snippet) => {
        expect(snippet.length).toBeGreaterThan(0);
      });
    });
  });

  describe("cosineSimilarity", () => {
    it("should calculate cosine similarity correctly", () => {
      const vecA = [1, 0, 0];
      const vecB = [1, 0, 0];

      const similarity = cosineSimilarity(vecA, vecB);
      expect(similarity).toBe(1); // Identical vectors should have similarity of 1
    });

    it("should return 0 for orthogonal vectors", () => {
      const vecA = [1, 0, 0];
      const vecB = [0, 1, 0];

      const similarity = cosineSimilarity(vecA, vecB);
      expect(similarity).toBe(0);
    });

    it("should return -1 for opposite vectors", () => {
      const vecA = [1, 0, 0];
      const vecB = [-1, 0, 0];

      const similarity = cosineSimilarity(vecA, vecB);
      expect(similarity).toBe(-1);
    });

    it("should handle vectors of different magnitudes", () => {
      const vecA = [1, 2, 3];
      const vecB = [2, 4, 6]; // Same direction, different magnitude

      const similarity = cosineSimilarity(vecA, vecB);
      expect(similarity).toBeCloseTo(1, 5);
    });

    it("should throw error for vectors of different lengths", () => {
      const vecA = [1, 2, 3];
      const vecB = [1, 2];

      expect(() => cosineSimilarity(vecA, vecB)).toThrow(
        "Vectors must have the same length"
      );
    });

    it("should return 0 for zero vectors", () => {
      const vecA = [0, 0, 0];
      const vecB = [1, 2, 3];

      const similarity = cosineSimilarity(vecA, vecB);
      expect(similarity).toBe(0);
    });

    it("should handle high-dimensional vectors", () => {
      const vecA = Array(768).fill(0.1);
      const vecB = Array(768).fill(0.1);

      const similarity = cosineSimilarity(vecA, vecB);
      expect(similarity).toBeCloseTo(1, 5);
    });
  });

  describe("generateEmbedding", () => {
    beforeEach(() => {
      // Clear all caches before each test
      // clearWorkspaceCache removed - no longer needed with LanceDB
      // Clear fetch mocks
      vi.clearAllMocks();
    });

    it("should generate embedding successfully", async () => {
      const mockResponse = {
        embedding: {
          values: Array(768).fill(0.1),
        },
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const embedding = await generateEmbedding(
        "test text",
        "test-api-key",
        "test-cache-key"
      );

      expect(embedding).toEqual(mockResponse.embedding.values);
      expect(global.fetch).toHaveBeenCalled();
    });

    it("should use cached embedding if available", async () => {
      const cachedEmbedding = Array(768).fill(0.2);
      const uniqueCacheKey = `test-cache-key-${Date.now()}`;

      // First call - generate and cache
      const mockResponse = {
        embedding: {
          values: cachedEmbedding,
        },
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const firstResult = await generateEmbedding(
        "test text",
        "test-api-key",
        uniqueCacheKey
      );

      expect(firstResult).toEqual(cachedEmbedding);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Second call - should use cache (no fetch call)
      const secondResult = await generateEmbedding(
        "test text",
        "test-api-key",
        uniqueCacheKey
      );

      expect(secondResult).toEqual(cachedEmbedding);
      // Should still only call fetch once (cached on second call)
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("should throw error for empty text", async () => {
      await expect(generateEmbedding("", "test-api-key")).rejects.toThrow(
        "Text cannot be empty"
      );

      await expect(generateEmbedding("   ", "test-api-key")).rejects.toThrow(
        "Text cannot be empty"
      );
    });

    it("should handle abort signal", async () => {
      const abortController = new AbortController();
      abortController.abort();

      await expect(
        generateEmbedding(
          "test text",
          "test-api-key",
          undefined,
          abortController.signal
        )
      ).rejects.toThrow("Operation aborted");
    });

    it("should retry on throttling errors with exponential backoff", async () => {
      vi.useFakeTimers();

      // First two calls fail with 429, third succeeds
      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: async () => "quota exceeded",
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: async () => "rate limit",
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            embedding: { values: Array(768).fill(0.1) },
          }),
        });

      const embeddingPromise = generateEmbedding(
        "test text",
        "test-api-key",
        undefined // No cache key to avoid cache interference
      );

      // Fast-forward timers to allow retries
      await vi.runAllTimersAsync();

      const embedding = await embeddingPromise;

      expect(embedding).toBeDefined();
      expect(embedding.length).toBe(768);
      expect(global.fetch).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    });

    it("should throw error for referrer restriction errors without retrying", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => "referrer restriction error",
      });

      await expect(
        generateEmbedding("test text", "test-api-key", undefined)
      ).rejects.toThrow("referrer restriction");

      // Should not retry
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("should throw error for invalid response format", async () => {
      // Mock successful response but with invalid structure
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ invalid: "response" }), // Missing embedding field
      });

      await expect(
        generateEmbedding("test text", "test-api-key", undefined)
      ).rejects.toThrow("Invalid embedding response format");
    });

    it("should handle network errors with retry", async () => {
      vi.useFakeTimers();

      // First call fails with network error, second succeeds
      (global.fetch as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new TypeError("fetch failed: network error"))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            embedding: { values: Array(768).fill(0.1) },
          }),
        });

      const embeddingPromise = generateEmbedding("test text", "test-api-key");

      // Fast-forward timers to allow retry
      await vi.runAllTimersAsync();

      const embedding = await embeddingPromise;

      expect(embedding).toBeDefined();
      expect(embedding.length).toBe(768);
      expect(global.fetch).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });

  describe("searchDocuments", () => {
    beforeEach(() => {
      // Clear caches
      // clearWorkspaceCache removed - no longer needed with LanceDB
    });

    it("should return empty array for empty query", async () => {
      const results = await searchDocuments("workspace-123", "");
      expect(results).toEqual([]);

      const results2 = await searchDocuments("workspace-123", "   ");
      expect(results2).toEqual([]);
    });

    it("should return empty array when no documents exist", async () => {
      mockQuery.mockResolvedValue([]);

      // Mock embedding generation for query
      const mockEmbedding = Array(768).fill(0.1);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({
          embedding: { values: mockEmbedding },
        }),
      });

      const results = await searchDocuments("workspace-123", "test query");

      expect(mockQuery).toHaveBeenCalledWith("workspace-123", "docs", {
        vector: mockEmbedding,
        filter: "\"workspaceId\" = 'workspace-123'",
        limit: 5,
      });
      expect(results).toEqual([]);
    });

    it("should perform search after indexing documents", async () => {
      // Mock LanceDB query results
      const mockQueryResults = [
        {
          id: "doc-1:0",
          content: "This is test content for searching.",
          embedding: Array(768).fill(0.1),
          timestamp: new Date().toISOString(),
          metadata: {
            documentId: "doc-1",
            documentName: "Test Document",
            folderPath: "",
            workspaceId: "workspace-123",
          },
          distance: 0.5,
        },
      ];

      mockQuery.mockResolvedValue(mockQueryResults);

      // Mock embedding generation for query
      const mockEmbedding = Array(768).fill(0.1);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({
          embedding: { values: mockEmbedding },
        }),
      });

      const results = await searchDocuments("workspace-123", "test query", 5);

      expect(mockQuery).toHaveBeenCalledWith("workspace-123", "docs", {
        vector: mockEmbedding,
        filter: "\"workspaceId\" = 'workspace-123'",
        limit: 5,
      });
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(1);
      expect(results[0].snippet).toBe("This is test content for searching.");
      expect(results[0].documentName).toBe("Test Document");
      expect(results[0].documentId).toBe("doc-1");
    });

    it("should wait for existing indexing promise", async () => {
      // Mock LanceDB query results
      const mockQueryResults = [
        {
          id: "doc-1:0",
          content: "Test content",
          embedding: Array(768).fill(0.1),
          timestamp: new Date().toISOString(),
          metadata: {
            documentId: "doc-1",
            documentName: "Test Document",
            folderPath: "",
            workspaceId: "workspace-123",
          },
          distance: 0.5,
        },
      ];

      mockQuery.mockResolvedValue(mockQueryResults);

      const mockEmbedding = Array(768).fill(0.1);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({
          embedding: { values: mockEmbedding },
        }),
      });

      // Start two searches concurrently
      const [results1, results2] = await Promise.all([
        searchDocuments("workspace-123", "query 1"),
        searchDocuments("workspace-123", "query 2"),
      ]);

      // Both should complete successfully
      expect(results1).toBeDefined();
      expect(results2).toBeDefined();
      expect(Array.isArray(results1)).toBe(true);
      expect(Array.isArray(results2)).toBe(true);
    });

    it("should escape single quotes in workspaceId to prevent SQL injection", async () => {
      // Mock LanceDB query results
      mockQuery.mockResolvedValue([]);

      const mockEmbedding = Array(768).fill(0.1);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({
          embedding: { values: mockEmbedding },
        }),
      });

      // Test with workspaceId containing single quote (SQL injection attempt)
      const maliciousWorkspaceId = "workspace' OR '1'='1";
      await searchDocuments(maliciousWorkspaceId, "test query");

      // Verify that the filter was called with properly escaped workspaceId
      expect(mockQuery).toHaveBeenCalledWith(
        maliciousWorkspaceId,
        "docs",
        expect.objectContaining({
          filter: "\"workspaceId\" = 'workspace'' OR ''1''=''1'", // Column name quoted, single quotes doubled
        })
      );
    });
  });

  // clearWorkspaceCache test removed - function no longer exists with LanceDB migration
});
