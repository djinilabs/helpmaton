import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockGetWorkspaceApiKey } = vi.hoisted(() => {
  return {
    mockGetWorkspaceApiKey: vi.fn(),
  };
});

// Mock agentUtils
vi.mock("../../http/utils/agentUtils", () => ({
  getWorkspaceApiKey: mockGetWorkspaceApiKey,
}));

// Mock fetch globally
global.fetch = vi.fn();

// Import after mocks are set up
import type { SearchResult } from "../documentSearch";
import { getRerankingModels, rerankSnippets } from "../knowledgeReranking";

describe("knowledgeReranking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    // Setup default environment
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.DEFAULT_REFERER = "http://localhost:3000";

    // Default mock: no workspace API key
    mockGetWorkspaceApiKey.mockResolvedValue(null);
  });

  describe("getRerankingModels", () => {
    it("should filter models containing 'rerank' (case-insensitive)", () => {
      const models = [
        "openai/gpt-4",
        "cohere/rerank-v3",
        "jina-reranker-v1",
        "google/gemini-pro",
        "RERANK-MODEL-v2",
      ];

      const result = getRerankingModels(models);

      expect(result).toEqual([
        "cohere/rerank-v3",
        "jina-reranker-v1",
        "RERANK-MODEL-v2",
      ]);
    });

    it("should not filter models containing only 'rank' (must contain 'rerank')", () => {
      const models = [
        "openai/gpt-4",
        "cohere/rank-model",
        "jina-ranker-v1",
        "google/gemini-pro",
        "RANK-MODEL-v2",
      ];

      const result = getRerankingModels(models);

      // Models with only "rank" (not "rerank") should not be included
      expect(result).toEqual([]);
    });

    it("should return empty array when no re-ranking models found", () => {
      const models = ["openai/gpt-4", "google/gemini-pro", "anthropic/claude"];

      const result = getRerankingModels(models);

      expect(result).toEqual([]);
    });

    it("should return empty array for empty input", () => {
      const result = getRerankingModels([]);

      expect(result).toEqual([]);
    });

    it("should handle models with both 'rerank' and 'rank' in name", () => {
      const models = [
        "rerank-rank-model",
        "model-with-rerank-and-rank",
        "normal-model",
      ];

      const result = getRerankingModels(models);

      // Models containing "rerank" should be included (even if they also contain "rank")
      expect(result).toEqual([
        "rerank-rank-model",
        "model-with-rerank-and-rank",
      ]);
    });
  });

  describe("rerankSnippets", () => {
    const mockSnippets: SearchResult[] = [
      {
        snippet: "First snippet content",
        documentName: "Doc 1",
        documentId: "doc-1",
        folderPath: "/folder1",
        similarity: 0.8,
      },
      {
        snippet: "Second snippet content",
        documentName: "Doc 2",
        documentId: "doc-2",
        folderPath: "/folder2",
        similarity: 0.9,
      },
      {
        snippet: "Third snippet content",
        documentName: "Doc 3",
        documentId: "doc-3",
        folderPath: "",
        similarity: 0.7,
      },
    ];

    it("should return empty array for empty snippets", async () => {
      const result = await rerankSnippets("query", [], "model", "workspace-1");

      expect(result).toEqual({ snippets: [] });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("should use system API key when no workspace key available", async () => {
      mockGetWorkspaceApiKey.mockResolvedValue(null);

      const mockResponse = {
        results: [
          { index: 1, relevance_score: 0.95 },
          { index: 0, relevance_score: 0.85 },
          { index: 2, relevance_score: 0.75 },
        ],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await rerankSnippets("test query", mockSnippets, "rerank-model", "workspace-1");

      expect(mockGetWorkspaceApiKey).toHaveBeenCalledWith(
        "workspace-1",
        "openrouter"
      );
      expect(global.fetch).toHaveBeenCalledWith(
        "https://openrouter.ai/api/v1/rerank",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-openrouter-key",
          }),
        })
      );
    });

    it("should use workspace API key when available", async () => {
      mockGetWorkspaceApiKey.mockResolvedValue("workspace-key-123");

      const mockResponse = {
        results: [
          { index: 1, relevance_score: 0.95 },
          { index: 0, relevance_score: 0.85 },
        ],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await rerankSnippets(
        "test query",
        mockSnippets,
        "rerank-model",
        "workspace-1"
      );

      expect(mockGetWorkspaceApiKey).toHaveBeenCalledWith(
        "workspace-1",
        "openrouter"
      );
      expect(global.fetch).toHaveBeenCalledWith(
        "https://openrouter.ai/api/v1/rerank",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer workspace-key-123",
          }),
        })
      );
    });

    it("should re-rank snippets based on API response", async () => {
      const mockResponse = {
        results: [
          { index: 1, relevance_score: 0.95 },
          { index: 0, relevance_score: 0.85 },
          { index: 2, relevance_score: 0.75 },
        ],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await rerankSnippets(
        "test query",
        mockSnippets,
        "rerank-model",
        "workspace-1"
      );

      expect(result.snippets).toHaveLength(3);
      // Should be re-ordered by relevance_score (descending)
      expect(result.snippets[0].snippet).toBe("Second snippet content"); // index 1, score 0.95
      expect(result.snippets[0].similarity).toBe(0.95);
      expect(result.snippets[1].snippet).toBe("First snippet content"); // index 0, score 0.85
      expect(result.snippets[1].similarity).toBe(0.85);
      expect(result.snippets[2].snippet).toBe("Third snippet content"); // index 2, score 0.75
      expect(result.snippets[2].similarity).toBe(0.75);
    });

    it("should update similarity scores with re-ranking scores", async () => {
      const mockResponse = {
        results: [{ index: 0, relevance_score: 0.99 }],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await rerankSnippets(
        "test query",
        mockSnippets,
        "rerank-model",
        "workspace-1"
      );

      expect(result.snippets[0].similarity).toBe(0.99);
      expect(result.snippets[0].snippet).toBe("First snippet content");
    });

    it("should include snippets not in re-ranking results", async () => {
      const mockResponse = {
        results: [{ index: 1, relevance_score: 0.95 }],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await rerankSnippets(
        "test query",
        mockSnippets,
        "rerank-model",
        "workspace-1"
      );

      expect(result.snippets).toHaveLength(3);
      expect(result.snippets[0].snippet).toBe("Second snippet content");
      // Other snippets should be appended
      expect(
        result.snippets.some((r) => r.snippet === "First snippet content")
      ).toBe(true);
      expect(
        result.snippets.some((r) => r.snippet === "Third snippet content")
      ).toBe(true);
    });

    it("should fall back to original order on API error", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "Server error",
      });

      const result = await rerankSnippets(
        "test query",
        mockSnippets,
        "rerank-model",
        "workspace-1"
      );

      // Should return original snippets in original order
      expect(result.snippets).toEqual(mockSnippets);
    });

    it("should fall back to original order on network error", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Network error")
      );

      const result = await rerankSnippets(
        "test query",
        mockSnippets,
        "rerank-model",
        "workspace-1"
      );

      // Should return original snippets in original order
      expect(result.snippets).toEqual(mockSnippets);
    });

    it("should fall back to original order on invalid response format", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ invalid: "response" }),
      });

      const result = await rerankSnippets(
        "test query",
        mockSnippets,
        "rerank-model",
        "workspace-1"
      );

      // Should return original snippets in original order
      expect(result.snippets).toEqual(mockSnippets);
    });

    it("should fall back to original order when results is not an array", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: "not an array" }),
      });

      const result = await rerankSnippets(
        "test query",
        mockSnippets,
        "rerank-model",
        "workspace-1"
      );

      // Should return original snippets in original order
      expect(result.snippets).toEqual(mockSnippets);
    });

    it("should handle out-of-bounds indices in re-ranking results", async () => {
      const mockResponse = {
        results: [
          { index: 1, relevance_score: 0.95 },
          { index: 10, relevance_score: 0.85 }, // Out of bounds
          { index: -1, relevance_score: 0.75 }, // Invalid index
        ],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await rerankSnippets(
        "test query",
        mockSnippets,
        "rerank-model",
        "workspace-1"
      );

      // Should only include valid indices
      expect(result.snippets.length).toBeGreaterThanOrEqual(1);
      expect(result.snippets[0].snippet).toBe("Second snippet content");
    });

    it("should send correct request body to OpenRouter API", async () => {
      const mockResponse = {
        results: [{ index: 0, relevance_score: 0.9 }],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await rerankSnippets(
        "test query",
        mockSnippets,
        "rerank-model-v1",
        "workspace-1"
      );

      expect(global.fetch).toHaveBeenCalledWith(
        "https://openrouter.ai/api/v1/rerank",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:3000",
          }),
          body: JSON.stringify({
            model: "rerank-model-v1",
            query: "test query",
            documents: [
              "First snippet content",
              "Second snippet content",
              "Third snippet content",
            ],
          }),
        })
      );
    });

    it("should throw error if OPENROUTER_API_KEY is not set and no workspace key", async () => {
      delete process.env.OPENROUTER_API_KEY;
      mockGetWorkspaceApiKey.mockResolvedValue(null);

      await expect(
        rerankSnippets("test query", mockSnippets, "rerank-model", "workspace-1")
      ).rejects.toThrow("OPENROUTER_API_KEY is not set");
    });

    it("should throw error if workspaceId is missing", async () => {
      await expect(
        rerankSnippets("test query", mockSnippets, "rerank-model", "")
      ).rejects.toThrow(
        "workspaceId is required for knowledge re-ranking to ensure correct billing"
      );
    });
  });
});
