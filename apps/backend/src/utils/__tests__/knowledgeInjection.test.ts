import type { ModelMessage } from "ai";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const {
  mockSearchDocuments,
  mockRerankSnippets,
  mockReserveRerankingCredits,
  mockAdjustRerankingCreditReservation,
  mockQueueRerankingCostVerification,
  mockRefundRerankingCredits,
} = vi.hoisted(() => {
  return {
    mockSearchDocuments: vi.fn(),
    mockRerankSnippets: vi.fn(),
    mockReserveRerankingCredits: vi.fn(),
    mockAdjustRerankingCreditReservation: vi.fn(),
    mockQueueRerankingCostVerification: vi.fn(),
    mockRefundRerankingCredits: vi.fn(),
  };
});

// Mock documentSearch
vi.mock("../documentSearch", () => ({
  searchDocuments: mockSearchDocuments,
}));

// Mock knowledgeReranking
vi.mock("../knowledgeReranking", () => ({
  rerankSnippets: mockRerankSnippets,
}));

// Mock knowledgeRerankingCredits
vi.mock("../knowledgeRerankingCredits", () => ({
  reserveRerankingCredits: mockReserveRerankingCredits,
  adjustRerankingCreditReservation: mockAdjustRerankingCreditReservation,
  queueRerankingCostVerification: mockQueueRerankingCostVerification,
  refundRerankingCredits: mockRefundRerankingCredits,
}));

// Import after mocks are set up
import type { DatabaseSchema } from "../../tables/schema";
import type { SearchResult } from "../documentSearch";
import { injectKnowledgeIntoMessages } from "../knowledgeInjection";
import type { AugmentedContext } from "../workspaceCreditContext";

describe("knowledgeInjection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const mockSearchResults: SearchResult[] = [
    {
      snippet: "First relevant snippet",
      documentName: "Document 1",
      documentId: "doc-1",
      folderPath: "/folder1",
      similarity: 0.9,
    },
    {
      snippet: "Second relevant snippet",
      documentName: "Document 2",
      documentId: "doc-2",
      folderPath: "",
      similarity: 0.8,
    },
  ];

  describe("injectKnowledgeIntoMessages", () => {
    it("should return original messages when knowledge injection is disabled", async () => {
      const agent = {
        enableKnowledgeInjection: false,
      };

      const messages: ModelMessage[] = [
        { role: "user", content: "Test query" },
      ];

      const result = await injectKnowledgeIntoMessages(
        "workspace-1",
        agent,
        messages
      );

      expect(result).toEqual(messages);
      expect(mockSearchDocuments).not.toHaveBeenCalled();
    });

    it("should return original messages when no user message found", async () => {
      const agent = {
        enableKnowledgeInjection: true,
      };

      const messages: ModelMessage[] = [
        { role: "system", content: "System message" },
        { role: "assistant", content: "Assistant message" },
      ];

      const result = await injectKnowledgeIntoMessages(
        "workspace-1",
        agent,
        messages
      );

      expect(result).toEqual(messages);
      expect(mockSearchDocuments).not.toHaveBeenCalled();
    });

    it("should return original messages when user message is empty", async () => {
      const agent = {
        enableKnowledgeInjection: true,
      };

      const messages: ModelMessage[] = [
        { role: "user", content: "" },
      ];

      const result = await injectKnowledgeIntoMessages(
        "workspace-1",
        agent,
        messages
      );

      expect(result).toEqual(messages);
      expect(mockSearchDocuments).not.toHaveBeenCalled();
    });

    it("should return original messages when no search results found", async () => {
      const agent = {
        enableKnowledgeInjection: true,
        knowledgeInjectionSnippetCount: 5,
      };

      mockSearchDocuments.mockResolvedValue([]);

      const messages: ModelMessage[] = [
        { role: "user", content: "Test query" },
      ];

      const result = await injectKnowledgeIntoMessages(
        "workspace-1",
        agent,
        messages
      );

      expect(result).toEqual(messages);
      expect(mockSearchDocuments).toHaveBeenCalledWith(
        "workspace-1",
        "Test query",
        5
      );
    });

    it("should inject knowledge before first user message", async () => {
      const agent = {
        enableKnowledgeInjection: true,
        knowledgeInjectionSnippetCount: 5,
      };

      mockSearchDocuments.mockResolvedValue(mockSearchResults);

      const messages: ModelMessage[] = [
        { role: "system", content: "System prompt" },
        { role: "user", content: "Test query" },
        { role: "assistant", content: "Previous response" },
      ];

      const result = await injectKnowledgeIntoMessages(
        "workspace-1",
        agent,
        messages
      );

      expect(result).toHaveLength(4);
      expect(result[0].role).toBe("system");
      expect(result[1].role).toBe("user");
      // Knowledge injection message should be before the original user message
      expect(typeof result[1].content).toBe("string");
      expect(result[1].content).toContain("Relevant Knowledge from Workspace Documents");
      expect(result[1].content).toContain("First relevant snippet");
      expect(result[1].content).toContain("Second relevant snippet");
      expect(result[2].role).toBe("user");
      expect(result[2].content).toBe("Test query");
      expect(result[3].role).toBe("assistant");
    });

    it("should use default snippet count of 5 when not specified", async () => {
      const agent = {
        enableKnowledgeInjection: true,
      };

      mockSearchDocuments.mockResolvedValue(mockSearchResults);

      const messages: ModelMessage[] = [
        { role: "user", content: "Test query" },
      ];

      await injectKnowledgeIntoMessages("workspace-1", agent, messages);

      expect(mockSearchDocuments).toHaveBeenCalledWith(
        "workspace-1",
        "Test query",
        5
      );
    });

    it("should use configured snippet count", async () => {
      const agent = {
        enableKnowledgeInjection: true,
        knowledgeInjectionSnippetCount: 10,
      };

      mockSearchDocuments.mockResolvedValue(mockSearchResults);

      const messages: ModelMessage[] = [
        { role: "user", content: "Test query" },
      ];

      await injectKnowledgeIntoMessages("workspace-1", agent, messages);

      expect(mockSearchDocuments).toHaveBeenCalledWith(
        "workspace-1",
        "Test query",
        10
      );
    });

    it("should clamp snippet count to valid range (1-50)", async () => {
      const agent = {
        enableKnowledgeInjection: true,
        knowledgeInjectionSnippetCount: 100, // Over limit
      };

      mockSearchDocuments.mockResolvedValue(mockSearchResults);

      const messages: ModelMessage[] = [
        { role: "user", content: "Test query" },
      ];

      await injectKnowledgeIntoMessages("workspace-1", agent, messages);

      expect(mockSearchDocuments).toHaveBeenCalledWith(
        "workspace-1",
        "Test query",
        50
      );
    });

    it("should clamp snippet count to minimum of 1", async () => {
      const agent = {
        enableKnowledgeInjection: true,
        knowledgeInjectionSnippetCount: 0, // Under limit
      };

      mockSearchDocuments.mockResolvedValue(mockSearchResults);

      const messages: ModelMessage[] = [
        { role: "user", content: "Test query" },
      ];

      await injectKnowledgeIntoMessages("workspace-1", agent, messages);

      expect(mockSearchDocuments).toHaveBeenCalledWith(
        "workspace-1",
        "Test query",
        1
      );
    });

    it("should extract query from string content", async () => {
      const agent = {
        enableKnowledgeInjection: true,
      };

      mockSearchDocuments.mockResolvedValue(mockSearchResults);

      const messages: ModelMessage[] = [
        { role: "user", content: "What is the meaning of life?" },
      ];

      await injectKnowledgeIntoMessages("workspace-1", agent, messages);

      expect(mockSearchDocuments).toHaveBeenCalledWith(
        "workspace-1",
        "What is the meaning of life?",
        5
      );
    });

    it("should extract query from array content with text parts", async () => {
      const agent = {
        enableKnowledgeInjection: true,
      };

      mockSearchDocuments.mockResolvedValue(mockSearchResults);

      const messages: ModelMessage[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "Test query from array" },
            { type: "image", image: "base64..." },
          ],
        },
      ];

      await injectKnowledgeIntoMessages("workspace-1", agent, messages);

      expect(mockSearchDocuments).toHaveBeenCalledWith(
        "workspace-1",
        "Test query from array",
        5
      );
    });

    it("should not re-rank when re-ranking is disabled", async () => {
      const agent = {
        enableKnowledgeInjection: true,
        enableKnowledgeReranking: false,
      };

      mockSearchDocuments.mockResolvedValue(mockSearchResults);

      const messages: ModelMessage[] = [
        { role: "user", content: "Test query" },
      ];

      await injectKnowledgeIntoMessages("workspace-1", agent, messages);

      expect(mockSearchDocuments).toHaveBeenCalled();
      expect(mockRerankSnippets).not.toHaveBeenCalled();
    });

    it("should not re-rank when re-ranking model is not specified", async () => {
      const agent = {
        enableKnowledgeInjection: true,
        enableKnowledgeReranking: true,
        // knowledgeRerankingModel is undefined
      };

      mockSearchDocuments.mockResolvedValue(mockSearchResults);

      const messages: ModelMessage[] = [
        { role: "user", content: "Test query" },
      ];

      await injectKnowledgeIntoMessages("workspace-1", agent, messages);

      expect(mockSearchDocuments).toHaveBeenCalled();
      expect(mockRerankSnippets).not.toHaveBeenCalled();
    });

    it("should re-rank when re-ranking is enabled and model is specified", async () => {
      const rerankedResults: SearchResult[] = [
        {
          snippet: "Second relevant snippet",
          documentName: "Document 2",
          documentId: "doc-2",
          folderPath: "",
          similarity: 0.95, // Re-ranked higher
        },
        {
          snippet: "First relevant snippet",
          documentName: "Document 1",
          documentId: "doc-1",
          folderPath: "/folder1",
          similarity: 0.85, // Re-ranked lower
        },
      ];

      const agent = {
        enableKnowledgeInjection: true,
        enableKnowledgeReranking: true,
        knowledgeRerankingModel: "cohere/rerank-v3",
      };

      mockSearchDocuments.mockResolvedValue(mockSearchResults);
      mockRerankSnippets.mockResolvedValue({ snippets: rerankedResults });

      const messages: ModelMessage[] = [
        { role: "user", content: "Test query" },
      ];

      const result = await injectKnowledgeIntoMessages(
        "workspace-1",
        agent,
        messages
      );

      expect(mockRerankSnippets).toHaveBeenCalledWith(
        "Test query",
        mockSearchResults,
        "cohere/rerank-v3",
        "workspace-1"
      );

      // Should use re-ranked results
      expect(result[0].content).toContain("Second relevant snippet");
      expect(result[0].content).toContain("First relevant snippet");
    });

    it("should fall back to original results if re-ranking fails", async () => {
      const agent = {
        enableKnowledgeInjection: true,
        enableKnowledgeReranking: true,
        knowledgeRerankingModel: "cohere/rerank-v3",
      };

      mockSearchDocuments.mockResolvedValue(mockSearchResults);
      mockRerankSnippets.mockRejectedValue(new Error("Re-ranking failed"));

      const messages: ModelMessage[] = [
        { role: "user", content: "Test query" },
      ];

      const result = await injectKnowledgeIntoMessages(
        "workspace-1",
        agent,
        messages
      );

      // Should use original results (not re-ranked)
      expect(result[0].content).toContain("First relevant snippet");
      expect(result[0].content).toContain("Second relevant snippet");
    });

    it("should format knowledge prompt correctly", async () => {
      const agent = {
        enableKnowledgeInjection: true,
      };

      mockSearchDocuments.mockResolvedValue(mockSearchResults);

      const messages: ModelMessage[] = [
        { role: "user", content: "Test query" },
      ];

      const result = await injectKnowledgeIntoMessages(
        "workspace-1",
        agent,
        messages
      );

      const knowledgeContent = result[0].content as string;
      expect(knowledgeContent).toContain("## Relevant Knowledge from Workspace Documents");
      expect(knowledgeContent).toContain("[1] Document: Document 1 (/folder1)");
      expect(knowledgeContent).toContain("Similarity: 90.0%");
      expect(knowledgeContent).toContain("First relevant snippet");
      expect(knowledgeContent).toContain("[2] Document: Document 2");
      expect(knowledgeContent).toContain("Similarity: 80.0%");
      expect(knowledgeContent).toContain("Second relevant snippet");
      expect(knowledgeContent).toContain(
        "Please use this information to provide a comprehensive and accurate response"
      );
    });

    it("should handle folder path in document name correctly", async () => {
      const resultsWithFolder: SearchResult[] = [
        {
          snippet: "Snippet with folder",
          documentName: "Document",
          documentId: "doc-1",
          folderPath: "/path/to/folder",
          similarity: 0.9,
        },
      ];

      const agent = {
        enableKnowledgeInjection: true,
      };

      mockSearchDocuments.mockResolvedValue(resultsWithFolder);

      const messages: ModelMessage[] = [
        { role: "user", content: "Test query" },
      ];

      const result = await injectKnowledgeIntoMessages(
        "workspace-1",
        agent,
        messages
      );

      const knowledgeContent = result[0].content as string;
      expect(knowledgeContent).toContain(
        "[1] Document: Document (/path/to/folder)"
      );
    });

    it("should handle empty folder path correctly", async () => {
      const resultsWithoutFolder: SearchResult[] = [
        {
          snippet: "Snippet without folder",
          documentName: "Document",
          documentId: "doc-1",
          folderPath: "",
          similarity: 0.9,
        },
      ];

      const agent = {
        enableKnowledgeInjection: true,
      };

      mockSearchDocuments.mockResolvedValue(resultsWithoutFolder);

      const messages: ModelMessage[] = [
        { role: "user", content: "Test query" },
      ];

      const result = await injectKnowledgeIntoMessages(
        "workspace-1",
        agent,
        messages
      );

      const knowledgeContent = result[0].content as string;
      expect(knowledgeContent).toContain("[1] Document: Document");
      expect(knowledgeContent).not.toContain("()");
    });

    it("should return original messages if search throws error", async () => {
      const agent = {
        enableKnowledgeInjection: true,
      };

      mockSearchDocuments.mockRejectedValue(new Error("Search failed"));

      const messages: ModelMessage[] = [
        { role: "user", content: "Test query" },
      ];

      const result = await injectKnowledgeIntoMessages(
        "workspace-1",
        agent,
        messages
      );

      // Should return original messages on error
      expect(result).toEqual(messages);
    });

    it("should return original messages when no user message exists (no query to search)", async () => {
      const agent = {
        enableKnowledgeInjection: true,
      };

      const messages: ModelMessage[] = [
        { role: "system", content: "System message" },
      ];

      const result = await injectKnowledgeIntoMessages(
        "workspace-1",
        agent,
        messages
      );

      // Should return original messages since there's no query to search for
      expect(result).toEqual(messages);
      expect(mockSearchDocuments).not.toHaveBeenCalled();
    });

    it("should handle multiple user messages correctly", async () => {
      const agent = {
        enableKnowledgeInjection: true,
      };

      mockSearchDocuments.mockResolvedValue(mockSearchResults);

      const messages: ModelMessage[] = [
        { role: "system", content: "System" },
        { role: "user", content: "First query" },
        { role: "assistant", content: "Response" },
        { role: "user", content: "Second query" },
      ];

      const result = await injectKnowledgeIntoMessages(
        "workspace-1",
        agent,
        messages
      );

      // Knowledge should be injected before the FIRST user message
      expect(result[1].role).toBe("user");
      expect(result[1].content).toContain("Relevant Knowledge");
      expect(result[2].role).toBe("user");
      expect(result[2].content).toBe("First query");
    });

    describe("credit management integration", () => {
      let mockDb: DatabaseSchema;
      let mockContext: AugmentedContext;

      beforeEach(() => {
        mockDb = {
          workspace: { get: vi.fn() },
          "credit-reservations": { get: vi.fn(), delete: vi.fn() },
        } as unknown as DatabaseSchema;
        mockContext = {
          addWorkspaceCreditTransaction: vi.fn(),
        } as unknown as AugmentedContext;
      });

      it("should reserve credits before re-ranking when db and context provided", async () => {
        const agent = {
          enableKnowledgeInjection: true,
          enableKnowledgeReranking: true,
          knowledgeRerankingModel: "cohere/rerank-v3",
        };

        mockSearchDocuments.mockResolvedValue(mockSearchResults);
        mockReserveRerankingCredits.mockResolvedValue({
          reservationId: "res-123",
          reservedAmount: 10_550,
          workspace: { creditBalance: 100_000_000 },
        });
        mockRerankSnippets.mockResolvedValue({
          snippets: mockSearchResults,
          costUsd: 0.01,
          generationId: "gen-123",
        });
        mockAdjustRerankingCreditReservation.mockResolvedValue(undefined);
        mockQueueRerankingCostVerification.mockResolvedValue(undefined);

        const messages: ModelMessage[] = [
          { role: "user", content: "Test query" },
        ];

        await injectKnowledgeIntoMessages(
          "workspace-1",
          agent,
          messages,
          mockDb,
          mockContext,
          "agent-1",
          "conversation-1",
          false // usesByok
        );

        expect(mockReserveRerankingCredits).toHaveBeenCalledWith(
          mockDb,
          "workspace-1",
          "cohere/rerank-v3",
          2, // documentCount
          3, // maxRetries
          mockContext,
          "agent-1",
          "conversation-1",
          false // usesByok
        );
      });

      it("should adjust credits after re-ranking with provisional cost", async () => {
        const agent = {
          enableKnowledgeInjection: true,
          enableKnowledgeReranking: true,
          knowledgeRerankingModel: "cohere/rerank-v3",
        };

        mockSearchDocuments.mockResolvedValue(mockSearchResults);
        mockReserveRerankingCredits.mockResolvedValue({
          reservationId: "res-123",
          reservedAmount: 10_550,
          workspace: { creditBalance: 100_000_000 },
        });
        mockRerankSnippets.mockResolvedValue({
          snippets: mockSearchResults,
          costUsd: 0.015, // Provisional cost
          generationId: "gen-123",
        });
        mockAdjustRerankingCreditReservation.mockResolvedValue(undefined);
        mockQueueRerankingCostVerification.mockResolvedValue(undefined);

        const messages: ModelMessage[] = [
          { role: "user", content: "Test query" },
        ];

        await injectKnowledgeIntoMessages(
          "workspace-1",
          agent,
          messages,
          mockDb,
          mockContext,
          "agent-1",
          "conversation-1"
        );

        expect(mockAdjustRerankingCreditReservation).toHaveBeenCalledWith(
          mockDb,
          "res-123",
          "workspace-1",
          0.015, // provisionalCostUsd
          "gen-123", // generationId
          mockContext,
          3, // maxRetries
          "agent-1",
          "conversation-1"
        );
      });

      it("should queue cost verification when generationId is available", async () => {
        const agent = {
          enableKnowledgeInjection: true,
          enableKnowledgeReranking: true,
          knowledgeRerankingModel: "cohere/rerank-v3",
        };

        mockSearchDocuments.mockResolvedValue(mockSearchResults);
        mockReserveRerankingCredits.mockResolvedValue({
          reservationId: "res-123",
          reservedAmount: 10_550,
          workspace: { creditBalance: 100_000_000 },
        });
        mockRerankSnippets.mockResolvedValue({
          snippets: mockSearchResults,
          costUsd: 0.01,
          generationId: "gen-123",
        });
        mockAdjustRerankingCreditReservation.mockResolvedValue(undefined);
        mockQueueRerankingCostVerification.mockResolvedValue(undefined);

        const messages: ModelMessage[] = [
          { role: "user", content: "Test query" },
        ];

        await injectKnowledgeIntoMessages(
          "workspace-1",
          agent,
          messages,
          mockDb,
          mockContext,
          "agent-1",
          "conversation-1"
        );

        expect(mockQueueRerankingCostVerification).toHaveBeenCalledWith(
          "res-123",
          "gen-123",
          "workspace-1",
          "agent-1",
          "conversation-1"
        );
      });

      it("should not queue cost verification when generationId is missing", async () => {
        const agent = {
          enableKnowledgeInjection: true,
          enableKnowledgeReranking: true,
          knowledgeRerankingModel: "cohere/rerank-v3",
        };

        mockSearchDocuments.mockResolvedValue(mockSearchResults);
        mockReserveRerankingCredits.mockResolvedValue({
          reservationId: "res-123",
          reservedAmount: 10_550,
          workspace: { creditBalance: 100_000_000 },
        });
        mockRerankSnippets.mockResolvedValue({
          snippets: mockSearchResults,
          costUsd: 0.01,
          // No generationId
        });
        mockAdjustRerankingCreditReservation.mockResolvedValue(undefined);

        const messages: ModelMessage[] = [
          { role: "user", content: "Test query" },
        ];

        await injectKnowledgeIntoMessages(
          "workspace-1",
          agent,
          messages,
          mockDb,
          mockContext
        );

        expect(mockQueueRerankingCostVerification).not.toHaveBeenCalled();
      });

      it("should skip credit management when db or context not provided", async () => {
        const agent = {
          enableKnowledgeInjection: true,
          enableKnowledgeReranking: true,
          knowledgeRerankingModel: "cohere/rerank-v3",
        };

        mockSearchDocuments.mockResolvedValue(mockSearchResults);
        mockRerankSnippets.mockResolvedValue({
          snippets: mockSearchResults,
        });

        const messages: ModelMessage[] = [
          { role: "user", content: "Test query" },
        ];

        await injectKnowledgeIntoMessages(
          "workspace-1",
          agent,
          messages
          // No db or context - optional parameters
        );

        expect(mockReserveRerankingCredits).not.toHaveBeenCalled();
        expect(mockAdjustRerankingCreditReservation).not.toHaveBeenCalled();
        expect(mockQueueRerankingCostVerification).not.toHaveBeenCalled();
      });

      it("should skip re-ranking when credit reservation fails", async () => {
        const agent = {
          enableKnowledgeInjection: true,
          enableKnowledgeReranking: true,
          knowledgeRerankingModel: "cohere/rerank-v3",
        };

        mockSearchDocuments.mockResolvedValue(mockSearchResults);
        mockReserveRerankingCredits.mockRejectedValue(
          new Error("Insufficient credits")
        );
        // When reservation fails, re-ranking is still attempted but without credit tracking
        mockRerankSnippets.mockResolvedValue({
          snippets: mockSearchResults,
        });

        const messages: ModelMessage[] = [
          { role: "user", content: "Test query" },
        ];

        const result = await injectKnowledgeIntoMessages(
          "workspace-1",
          agent,
          messages,
          mockDb,
          mockContext
        );

        // When credit reservation fails, re-ranking still happens but without credit tracking
        // The code logs a warning but continues with re-ranking
        expect(mockRerankSnippets).toHaveBeenCalled();
        // No credit adjustment should happen since reservation failed
        expect(mockAdjustRerankingCreditReservation).not.toHaveBeenCalled();
        expect(result[0].content).toContain("First relevant snippet");
      });

      it("should refund credits when re-ranking fails", async () => {
        const agent = {
          enableKnowledgeInjection: true,
          enableKnowledgeReranking: true,
          knowledgeRerankingModel: "cohere/rerank-v3",
        };

        mockSearchDocuments.mockResolvedValue(mockSearchResults);
        mockReserveRerankingCredits.mockResolvedValue({
          reservationId: "res-123",
          reservedAmount: 10_550,
          workspace: { creditBalance: 100_000_000 },
        });
        mockRerankSnippets.mockRejectedValue(new Error("Re-ranking failed"));
        mockRefundRerankingCredits.mockResolvedValue(undefined);

        const messages: ModelMessage[] = [
          { role: "user", content: "Test query" },
        ];

        await injectKnowledgeIntoMessages(
          "workspace-1",
          agent,
          messages,
          mockDb,
          mockContext,
          "agent-1",
          "conversation-1"
        );

        expect(mockRefundRerankingCredits).toHaveBeenCalledWith(
          mockDb,
          "res-123",
          "workspace-1",
          mockContext,
          3, // maxRetries
          "agent-1",
          "conversation-1"
        );
      });

      it("should skip credit management when BYOK is enabled", async () => {
        const agent = {
          enableKnowledgeInjection: true,
          enableKnowledgeReranking: true,
          knowledgeRerankingModel: "cohere/rerank-v3",
        };

        mockSearchDocuments.mockResolvedValue(mockSearchResults);
        mockReserveRerankingCredits.mockResolvedValue({
          reservationId: "byok",
          reservedAmount: 0,
          workspace: { creditBalance: 100_000_000 },
        });
        mockRerankSnippets.mockResolvedValue({
          snippets: mockSearchResults,
          costUsd: 0.01,
          generationId: "gen-123",
        });
        mockAdjustRerankingCreditReservation.mockResolvedValue(undefined);
        // queueRerankingCostVerification will be called but will skip internally for BYOK
        mockQueueRerankingCostVerification.mockResolvedValue(undefined);

        const messages: ModelMessage[] = [
          { role: "user", content: "Test query" },
        ];

        await injectKnowledgeIntoMessages(
          "workspace-1",
          agent,
          messages,
          mockDb,
          mockContext,
          "agent-1",
          "conversation-1",
          true // usesByok
        );

        // Should still call adjust, but it will skip for BYOK
        expect(mockAdjustRerankingCreditReservation).toHaveBeenCalledWith(
          mockDb,
          "byok", // BYOK reservation ID
          "workspace-1",
          0.01, // costUsd
          "gen-123", // generationId
          mockContext,
          3, // maxRetries
          "agent-1",
          "conversation-1"
        );
        // queueRerankingCostVerification is called but will skip internally for BYOK
        expect(mockQueueRerankingCostVerification).toHaveBeenCalledWith(
          "byok",
          "gen-123",
          "workspace-1",
          "agent-1",
          "conversation-1"
        );
        // The function itself handles BYOK and skips the actual queueing
      });

      it("should continue even if credit adjustment fails", async () => {
        const agent = {
          enableKnowledgeInjection: true,
          enableKnowledgeReranking: true,
          knowledgeRerankingModel: "cohere/rerank-v3",
        };

        mockSearchDocuments.mockResolvedValue(mockSearchResults);
        mockReserveRerankingCredits.mockResolvedValue({
          reservationId: "res-123",
          reservedAmount: 10_550,
          workspace: { creditBalance: 100_000_000 },
        });
        mockRerankSnippets.mockResolvedValue({
          snippets: mockSearchResults,
          costUsd: 0.01,
          generationId: "gen-123",
        });
        mockAdjustRerankingCreditReservation.mockRejectedValue(
          new Error("Adjustment failed")
        );

        const messages: ModelMessage[] = [
          { role: "user", content: "Test query" },
        ];

        // Should not throw
        const result = await injectKnowledgeIntoMessages(
          "workspace-1",
          agent,
          messages,
          mockDb,
          mockContext
        );

        // Should still inject knowledge
        expect(result[0].content).toContain("Relevant Knowledge");
      });

      it("should continue even if refund fails", async () => {
        const agent = {
          enableKnowledgeInjection: true,
          enableKnowledgeReranking: true,
          knowledgeRerankingModel: "cohere/rerank-v3",
        };

        mockSearchDocuments.mockResolvedValue(mockSearchResults);
        mockReserveRerankingCredits.mockResolvedValue({
          reservationId: "res-123",
          reservedAmount: 10_550,
          workspace: { creditBalance: 100_000_000 },
        });
        mockRerankSnippets.mockRejectedValue(new Error("Re-ranking failed"));
        mockRefundRerankingCredits.mockRejectedValue(
          new Error("Refund failed")
        );

        const messages: ModelMessage[] = [
          { role: "user", content: "Test query" },
        ];

        // Should not throw
        const result = await injectKnowledgeIntoMessages(
          "workspace-1",
          agent,
          messages,
          mockDb,
          mockContext
        );

        // Should still inject knowledge with original results
        expect(result[0].content).toContain("First relevant snippet");
      });
    });
  });
});
