import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const {
  mockQuery,
  mockEmbeddingsGenerate,
  mockReserveEmbeddingCredits,
  mockAdjustEmbeddingCreditReservation,
  mockRefundEmbeddingCredits,
  mockGetWorkspaceApiKey,
} = vi.hoisted(() => {
  return {
    mockQuery: vi.fn(),
    mockEmbeddingsGenerate: vi.fn(),
    mockReserveEmbeddingCredits: vi.fn(),
    mockAdjustEmbeddingCreditReservation: vi.fn(),
    mockRefundEmbeddingCredits: vi.fn(),
    mockGetWorkspaceApiKey: vi.fn(),
  };
});

// Mock LanceDB readClient
vi.mock("../vectordb/readClient", () => ({
  query: mockQuery,
}));

vi.mock("@openrouter/sdk", () => {
  class OpenRouterMock {
    embeddings = {
      generate: mockEmbeddingsGenerate,
    };
  }
  return { OpenRouter: OpenRouterMock };
});

vi.mock("../embeddingCredits", () => ({
  reserveEmbeddingCredits: mockReserveEmbeddingCredits,
  adjustEmbeddingCreditReservation: mockAdjustEmbeddingCreditReservation,
  refundEmbeddingCredits: mockRefundEmbeddingCredits,
}));

vi.mock("../../http/utils/agent-keys", () => ({
  getWorkspaceApiKey: (...args: unknown[]) => mockGetWorkspaceApiKey(...args),
}));

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
    process.env.OPENROUTER_API_KEY = "test-api-key";
    mockGetWorkspaceApiKey.mockResolvedValue(null);
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
        "Vectors must have the same length",
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
      // Clear OpenRouter mocks
      vi.clearAllMocks();
    });

    it("should generate embedding successfully", async () => {
      const mockEmbedding = Array(768).fill(0.1);
      mockEmbeddingsGenerate.mockResolvedValueOnce({
        data: [{ embedding: mockEmbedding }],
      });

      const embedding = await generateEmbedding(
        "test text",
        "test-api-key",
        "test-cache-key",
      );

      expect(embedding).toEqual(mockEmbedding);
      expect(mockEmbeddingsGenerate).toHaveBeenCalled();
    });

    it("should use cached embedding if available", async () => {
      const cachedEmbedding = Array(768).fill(0.2);
      const uniqueCacheKey = `test-cache-key-${Date.now()}`;

      // First call - generate and cache
      mockEmbeddingsGenerate.mockResolvedValueOnce({
        data: [{ embedding: cachedEmbedding }],
      });

      const firstResult = await generateEmbedding(
        "test text",
        "test-api-key",
        uniqueCacheKey,
      );

      expect(firstResult).toEqual(cachedEmbedding);
      expect(mockEmbeddingsGenerate).toHaveBeenCalledTimes(1);

      // Second call - should use cache (no fetch call)
      const secondResult = await generateEmbedding(
        "test text",
        "test-api-key",
        uniqueCacheKey,
      );

      expect(secondResult).toEqual(cachedEmbedding);
      // Should still only call fetch once (cached on second call)
      expect(mockEmbeddingsGenerate).toHaveBeenCalledTimes(1);
    });

    it("should throw error for empty text", async () => {
      await expect(generateEmbedding("", "test-api-key")).rejects.toThrow(
        "Text cannot be empty",
      );

      await expect(generateEmbedding("   ", "test-api-key")).rejects.toThrow(
        "Text cannot be empty",
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
          abortController.signal,
        ),
      ).rejects.toThrow("Operation aborted");
    });

    it("should retry on throttling errors with exponential backoff", async () => {
      vi.useFakeTimers();

      // First two calls fail with 429, third succeeds
      const firstError = new Error("quota exceeded");
      (firstError as { statusCode?: number }).statusCode = 429;
      const secondError = new Error("rate limit");
      (secondError as { statusCode?: number }).statusCode = 429;
      mockEmbeddingsGenerate
        .mockRejectedValueOnce(firstError)
        .mockRejectedValueOnce(secondError)
        .mockResolvedValueOnce({
          data: [{ embedding: Array(768).fill(0.1) }],
        });

      const embeddingPromise = generateEmbedding(
        "test text",
        "test-api-key",
        undefined, // No cache key to avoid cache interference
      );

      // Fast-forward timers to allow retries
      await vi.runAllTimersAsync();

      const embedding = await embeddingPromise;

      expect(embedding).toBeDefined();
      expect(embedding.length).toBe(768);
      expect(mockEmbeddingsGenerate).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    });

    it("should throw error for non-retryable errors without retrying", async () => {
      const authError = new Error("unauthorized");
      (authError as { statusCode?: number }).statusCode = 403;
      mockEmbeddingsGenerate.mockRejectedValueOnce(authError);

      await expect(
        generateEmbedding("test text", "test-api-key", undefined),
      ).rejects.toThrow("unauthorized");

      // Should not retry
      expect(mockEmbeddingsGenerate).toHaveBeenCalledTimes(1);
    });

    it("should throw error for invalid response format", async () => {
      vi.useFakeTimers();
      // Mock responses with invalid structure for all validation attempts
      mockEmbeddingsGenerate
        .mockResolvedValueOnce({
          data: [{ notEmbedding: [] }],
        })
        .mockResolvedValueOnce({
          data: [{ notEmbedding: [] }],
        })
        .mockResolvedValueOnce({
          data: [{ notEmbedding: [] }],
        });

      const embeddingPromise = generateEmbedding(
        "test text",
        "test-api-key",
        undefined,
      );
      const expectation = expect(embeddingPromise).rejects.toThrow(
        "Invalid embedding response format",
      );

      await vi.runAllTimersAsync();
      await expectation;

      vi.useRealTimers();
    });

    it("should retry on response validation failures and succeed", async () => {
      vi.useFakeTimers();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      mockEmbeddingsGenerate
        .mockResolvedValueOnce({
          data: [{ notEmbedding: [] }],
        })
        .mockResolvedValueOnce({
          data: [{ notEmbedding: [] }],
        })
        .mockResolvedValueOnce({
          data: [{ embedding: Array(768).fill(0.1) }],
        });

      const embeddingPromise = generateEmbedding(
        "test text",
        "test-api-key",
        undefined,
      );

      await vi.runAllTimersAsync();

      const embedding = await embeddingPromise;
      expect(embedding.length).toBe(768);
      expect(mockEmbeddingsGenerate).toHaveBeenCalledTimes(3);
      expect(warnSpy).toHaveBeenCalledTimes(2);

      warnSpy.mockRestore();
      vi.useRealTimers();
    });

    it("should throw after exhausting response validation retries", async () => {
      vi.useFakeTimers();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      mockEmbeddingsGenerate
        .mockResolvedValueOnce({
          data: [{ notEmbedding: [] }],
        })
        .mockResolvedValueOnce({
          data: [{ notEmbedding: [] }],
        })
        .mockResolvedValueOnce({
          data: [{ notEmbedding: [] }],
        });

      const embeddingPromise = generateEmbedding(
        "test text",
        "test-api-key",
        undefined,
      );
      const expectation = expect(embeddingPromise).rejects.toThrow(
        "Invalid embedding response format",
      );

      await vi.runAllTimersAsync();
      await expectation;
      expect(mockEmbeddingsGenerate).toHaveBeenCalledTimes(3);
      expect(warnSpy).toHaveBeenCalledTimes(2);

      warnSpy.mockRestore();
      vi.useRealTimers();
    });

    it("should handle network errors with retry", async () => {
      vi.useFakeTimers();

      // First call fails with network error, second succeeds
      mockEmbeddingsGenerate
        .mockRejectedValueOnce(new TypeError("fetch failed: network error"))
        .mockResolvedValueOnce({
          data: [{ embedding: Array(768).fill(0.1) }],
        });

      const embeddingPromise = generateEmbedding("test text", "test-api-key");

      // Fast-forward timers to allow retry
      await vi.runAllTimersAsync();

      const embedding = await embeddingPromise;

      expect(embedding).toBeDefined();
      expect(embedding.length).toBe(768);
      expect(mockEmbeddingsGenerate).toHaveBeenCalledTimes(2);

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
      mockEmbeddingsGenerate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });

      const results = await searchDocuments("workspace-123", "test query");

      expect(mockQuery).toHaveBeenCalledWith("workspace-123", "docs", {
        vector: mockEmbedding,
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
      mockEmbeddingsGenerate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });

      const results = await searchDocuments("workspace-123", "test query", 5);

      expect(mockQuery).toHaveBeenCalledWith("workspace-123", "docs", {
        vector: mockEmbedding,
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
      mockEmbeddingsGenerate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
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

    it("should use workspaceId for database isolation (no filter needed)", async () => {
      // Mock LanceDB query results
      mockQuery.mockResolvedValue([]);

      const mockEmbedding = Array(768).fill(0.1);
      mockEmbeddingsGenerate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });

      // Test with workspaceId - each workspace has its own isolated database
      // No filter needed since workspace isolation is handled at the database path level
      const workspaceId = "workspace-123";
      await searchDocuments(workspaceId, "test query");

      // Verify that query was called without filter (workspace isolation via database path)
      expect(mockQuery).toHaveBeenCalledWith(
        workspaceId,
        "docs",
        expect.objectContaining({
          vector: mockEmbedding,
          limit: 5,
        }),
      );
      // Verify no filter is used (workspace isolation is at database level)
      const queryCall = mockQuery.mock.calls[0];
      expect(queryCall[2]).not.toHaveProperty("filter");
    });

    it("should reserve and adjust credits when context is provided", async () => {
      const mockEmbedding = Array(768).fill(0.1);
      mockEmbeddingsGenerate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
        usage: { promptTokens: 12, totalTokens: 12, cost: 0.000001 },
        id: "gen-123",
      });
      mockQuery.mockResolvedValue([]);
      mockReserveEmbeddingCredits.mockResolvedValue({
        reservationId: "res-1",
        reservedAmount: 1000,
        workspace: { creditBalance: 0 },
        estimatedTokens: 3,
      });

      const context = {
        addWorkspaceCreditTransaction: vi.fn(),
      };

      await searchDocuments("workspace-123", "test query", 5, {
        db: {} as never,
        context: context as never,
        agentId: "agent-123",
        conversationId: "conv-123",
      });

      expect(mockReserveEmbeddingCredits).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "workspace-123",
          text: "test query",
          usesByok: false,
          context,
          agentId: "agent-123",
          conversationId: "conv-123",
        }),
      );
      expect(mockAdjustEmbeddingCreditReservation).toHaveBeenCalledWith(
        expect.objectContaining({
          reservationId: "res-1",
          workspaceId: "workspace-123",
          usage: expect.objectContaining({
            promptTokens: 12,
          }),
          context,
        }),
      );
    });

    it("should mark BYOK when a workspace key is available", async () => {
      const mockEmbedding = Array(768).fill(0.1);
      mockEmbeddingsGenerate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
        usage: { promptTokens: 12, totalTokens: 12, cost: 0.000001 },
        id: "gen-123",
      });
      mockQuery.mockResolvedValue([]);
      mockReserveEmbeddingCredits.mockResolvedValue({
        reservationId: "byok",
        reservedAmount: 0,
        workspace: { creditBalance: 0 },
        estimatedTokens: 3,
      });
      mockGetWorkspaceApiKey.mockResolvedValue("workspace-key");

      const context = {
        addWorkspaceCreditTransaction: vi.fn(),
      };

      await searchDocuments("workspace-123", "test query", 5, {
        db: {} as never,
        context: context as never,
      });

      expect(mockReserveEmbeddingCredits).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "workspace-123",
          usesByok: true,
        }),
      );
      expect(mockGetWorkspaceApiKey).toHaveBeenCalledWith(
        "workspace-123",
        "openrouter",
      );
    });

    it("should refund credits when embedding generation fails", async () => {
      mockEmbeddingsGenerate.mockRejectedValueOnce(new Error("Embedding failed"));
      mockReserveEmbeddingCredits.mockResolvedValue({
        reservationId: "res-2",
        reservedAmount: 1000,
        workspace: { creditBalance: 0 },
        estimatedTokens: 3,
      });

      const context = {
        addWorkspaceCreditTransaction: vi.fn(),
      };

      await expect(
        searchDocuments("workspace-123", "test query", 5, {
          db: {} as never,
          context: context as never,
        }),
      ).rejects.toThrow("Embedding failed");

      expect(mockRefundEmbeddingCredits).toHaveBeenCalledWith(
        expect.objectContaining({
          reservationId: "res-2",
          workspaceId: "workspace-123",
          context,
        }),
      );
    });
  });

  // clearWorkspaceCache test removed - function no longer exists with LanceDB migration
});
