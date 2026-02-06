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

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

function chatCompletionsResponse(
  content: string,
  cost = 0.001,
  id = "gen-123"
) {
  return {
    ok: true,
    text: async () =>
      JSON.stringify({
        choices: [{ message: { content } }],
        usage: { cost },
        id,
      }),
  };
}

// Import after mocks are set up
import type { SearchResult } from "../documentSearch";
import { getRerankingModels, rerankSnippets } from "../knowledgeReranking";
import { DEFAULT_MAX_SNIPPET_CHARS } from "../rerankPrompt";

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

    it("should include chat models suitable for reranking when in list", () => {
      const models = ["openai/gpt-4o-mini", "google/gemini-pro"];
      const result = getRerankingModels(models);
      expect(result).toContain("openai/gpt-4o-mini");
      expect(result).toHaveLength(1);
    });

    it("should include any provider's gpt-4o-style models by pattern", () => {
      const models = ["anthropic/gpt-4o", "openai/gpt-4.1-mini", "other/gpt-4o-mini"];
      const result = getRerankingModels(models);
      expect(result).toContain("anthropic/gpt-4o");
      expect(result).toContain("openai/gpt-4.1-mini");
      expect(result).toContain("other/gpt-4o-mini");
      expect(result).toHaveLength(3);
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

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        chatCompletionsResponse("[1, 0, 2]")
      );

      await rerankSnippets("test query", mockSnippets, "rerank-model", "workspace-1");

      expect(mockGetWorkspaceApiKey).toHaveBeenCalledWith(
        "workspace-1",
        "openrouter"
      );
      expect(global.fetch).toHaveBeenCalledWith(
        OPENROUTER_CHAT_URL,
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

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        chatCompletionsResponse("[1, 0, 2]")
      );

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
        OPENROUTER_CHAT_URL,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer workspace-key-123",
          }),
        })
      );
    });

    it("should re-rank snippets based on API response", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        chatCompletionsResponse("[1, 0, 2]")
      );

      const result = await rerankSnippets(
        "test query",
        mockSnippets,
        "rerank-model",
        "workspace-1"
      );

      expect(result.snippets).toHaveLength(3);
      expect(result.snippets[0].snippet).toBe("Second snippet content");
      expect(result.snippets[0].similarity).toBe(1);
      expect(result.snippets[1].snippet).toBe("First snippet content");
      expect(result.snippets[1].similarity).toBe(0.99);
      expect(result.snippets[2].snippet).toBe("Third snippet content");
      expect(result.snippets[2].similarity).toBe(0.98);
    });

    it("should assign similarity by rank (first = 1.0)", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        chatCompletionsResponse("[0]")
      );

      const result = await rerankSnippets(
        "test query",
        mockSnippets,
        "rerank-model",
        "workspace-1"
      );

      expect(result.snippets[0].similarity).toBe(1);
      expect(result.snippets[0].snippet).toBe("First snippet content");
    });

    it("should include snippets not in re-ranking results", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        chatCompletionsResponse("[1]")
      );

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

    it("should fall back to original order when API returns HTML instead of JSON", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        text: async () =>
          "<!DOCTYPE html><html><body>Gateway Error</body></html>",
      });

      const result = await rerankSnippets(
        "test query",
        mockSnippets,
        "rerank-model",
        "workspace-1"
      );

      expect(result.snippets).toEqual(mockSnippets);
    });

    it("should fall back to original order on invalid response format", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        chatCompletionsResponse("not a json array")
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

    it("should fall back when model output has no parseable indices array", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        chatCompletionsResponse("Here are the results: (none)")
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

    it("should handle out-of-bounds indices in model output", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        chatCompletionsResponse("[1, 10, -1]")
      );

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

    it("should truncate long snippets in prompt to avoid context overflow", async () => {
      const longSnippet = "x".repeat(DEFAULT_MAX_SNIPPET_CHARS + 100);
      const snippetsWithLong: SearchResult[] = [
        { ...mockSnippets[0], snippet: longSnippet },
        mockSnippets[1],
      ];
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        chatCompletionsResponse("[0, 1]")
      );

      await rerankSnippets("query", snippetsWithLong, "model", "workspace-1");

      const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(call[1].body);
      const content = body.messages[0].content;
      expect(content).toContain("...");
      expect(content).not.toContain("x".repeat(DEFAULT_MAX_SNIPPET_CHARS + 1));
    });

    it("should send chat completions request with model, messages, max_tokens, temperature", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        chatCompletionsResponse("[0]")
      );

      await rerankSnippets(
        "test query",
        mockSnippets,
        "rerank-model-v1",
        "workspace-1"
      );

      const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe(OPENROUTER_CHAT_URL);
      const body = JSON.parse(call[1].body);
      expect(body.model).toBe("rerank-model-v1");
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].role).toBe("user");
      expect(body.messages[0].content).toContain("test query");
      expect(body.messages[0].content).toContain("First snippet content");
      expect(body.max_tokens).toBe(200);
      expect(body.temperature).toBe(0);
      expect(call[1].headers).toMatchObject({
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
      });
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
