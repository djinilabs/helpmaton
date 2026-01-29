import type { ModelMessage } from "ai";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const {
  mockSearchDocuments,
  mockSearchMemory,
  mockExtractEntitiesFromPrompt,
  mockSearchGraphByEntities,
  mockRerankSnippets,
  mockReserveRerankingCredits,
  mockAdjustRerankingCreditReservation,
  mockQueueRerankingCostVerification,
  mockRefundRerankingCredits,
  mockSentryCaptureException,
} = vi.hoisted(() => {
  return {
    mockSearchDocuments: vi.fn(),
    mockSearchMemory: vi.fn(),
    mockExtractEntitiesFromPrompt: vi.fn(),
    mockSearchGraphByEntities: vi.fn(),
    mockRerankSnippets: vi.fn(),
    mockReserveRerankingCredits: vi.fn(),
    mockAdjustRerankingCreditReservation: vi.fn(),
    mockQueueRerankingCostVerification: vi.fn(),
    mockRefundRerankingCredits: vi.fn(),
    mockSentryCaptureException: vi.fn(),
  };
});

// Mock documentSearch
vi.mock("../documentSearch", () => ({
  searchDocuments: mockSearchDocuments,
}));

vi.mock("../memory/searchMemory", () => ({
  searchMemory: mockSearchMemory,
}));

vi.mock("../knowledgeInjection/entityExtraction", () => ({
  extractEntitiesFromPrompt: mockExtractEntitiesFromPrompt,
}));

vi.mock("../knowledgeInjection/graphSearch", () => ({
  searchGraphByEntities: mockSearchGraphByEntities,
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

vi.mock("../sentry", () => ({
  ensureError: vi.fn((error) => error),
  Sentry: {
    captureException: mockSentryCaptureException,
  },
}));

// Import after mocks are set up
import type { DatabaseSchema } from "../../tables/schema";
import { InsufficientCreditsError } from "../creditErrors";
import type { SearchResult } from "../documentSearch";
import { injectKnowledgeIntoMessages } from "../knowledgeInjection";
import type { AugmentedContext } from "../workspaceCreditContext";

describe("knowledgeInjection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const mockSearchResults: Array<SearchResult & { source: "document" }> = [
    {
      snippet: "First relevant snippet",
      documentName: "Document 1",
      documentId: "doc-1",
      folderPath: "/folder1",
      similarity: 0.9,
      source: "document",
    },
    {
      snippet: "Second relevant snippet",
      documentName: "Document 2",
      documentId: "doc-2",
      folderPath: "",
      similarity: 0.8,
      source: "document",
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
        messages,
      );

      expect(result.modelMessages).toEqual(messages);
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
        messages,
      );

      expect(result.modelMessages).toEqual(messages);
      expect(mockSearchDocuments).not.toHaveBeenCalled();
    });

    it("should return original messages when user message is empty", async () => {
      const agent = {
        enableKnowledgeInjection: true,
      };

      const messages: ModelMessage[] = [{ role: "user", content: "" }];

      const result = await injectKnowledgeIntoMessages(
        "workspace-1",
        agent,
        messages,
      );

      expect(result.modelMessages).toEqual(messages);
      expect(mockSearchDocuments).not.toHaveBeenCalled();
    });

    it("should inject memory and graph snippets when configured", async () => {
      const agent = {
        enableKnowledgeInjection: true,
        enableKnowledgeInjectionFromMemories: true,
        enableKnowledgeInjectionFromDocuments: false,
      };

      mockSearchMemory.mockResolvedValue([
        {
          content: "User prefers TypeScript",
          date: "2026-01-01",
          timestamp: "2026-01-01T12:00:00.000Z",
          similarity: 0.9,
        },
      ]);
      mockExtractEntitiesFromPrompt.mockResolvedValue(["User"]);
      mockSearchGraphByEntities.mockResolvedValue([
        {
          snippet: "Subject: User\nPredicate: likes\nObject: React",
          similarity: 1,
          subject: "User",
          predicate: "likes",
          object: "React",
        },
      ]);

      const messages: ModelMessage[] = [
        { role: "user", content: "What tools does the user like?" },
      ];

      const result = await injectKnowledgeIntoMessages(
        "workspace-1",
        agent,
        messages,
        undefined,
        undefined,
        "agent-1",
      );

      expect(mockSearchDocuments).not.toHaveBeenCalled();
      expect(mockSearchMemory).toHaveBeenCalled();
      expect(mockExtractEntitiesFromPrompt).toHaveBeenCalled();
      expect(mockSearchGraphByEntities).toHaveBeenCalled();
      expect(result.knowledgeInjectionMessage).toBeDefined();
      const snippets =
        result.knowledgeInjectionMessage &&
        result.knowledgeInjectionMessage.role === "user" &&
        "knowledgeSnippets" in result.knowledgeInjectionMessage
          ? (result.knowledgeInjectionMessage.knowledgeSnippets ?? [])
          : [];
      expect(snippets).toHaveLength(2);
      expect(
        snippets.map((snippet: { source?: string }) => snippet.source),
      ).toEqual(expect.arrayContaining(["memory", "graph"]));
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
        messages,
      );

      expect(result.modelMessages).toEqual(messages);
      expect(mockSearchDocuments).toHaveBeenCalledWith(
        "workspace-1",
        "Test query",
        10,
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
        messages,
      );

      expect(result.modelMessages).toHaveLength(4);
      expect(result.modelMessages[0].role).toBe("system");
      expect(result.modelMessages[1].role).toBe("user");
      // Knowledge injection message should be before the original user message
      expect(typeof result.modelMessages[1].content).toBe("string");
      expect(result.modelMessages[1].content).toContain(
        "Knowledge from Workspace Documents",
      );
      expect(result.modelMessages[1].content).toContain(
        "First relevant snippet",
      );
      expect(result.modelMessages[1].content).toContain(
        "Second relevant snippet",
      );
      expect(result.modelMessages[2].role).toBe("user");
      expect(result.modelMessages[2].content).toBe("Test query");
      expect(result.modelMessages[3].role).toBe("assistant");
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
        10,
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
        20,
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
        50,
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
        2,
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
        10,
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
        10,
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
      const rerankedResults: Array<SearchResult & { source: "document" }> = [
        {
          snippet: "Second relevant snippet",
          documentName: "Document 2",
          documentId: "doc-2",
          folderPath: "",
          similarity: 0.95, // Re-ranked higher
          source: "document",
        },
        {
          snippet: "First relevant snippet",
          documentName: "Document 1",
          documentId: "doc-1",
          folderPath: "/folder1",
          similarity: 0.85, // Re-ranked lower
          source: "document",
        },
      ];

      const agent = {
        enableKnowledgeInjection: true,
        enableKnowledgeReranking: true,
        knowledgeRerankingModel: "cohere/rerank-v3",
      };

      const mockDb: DatabaseSchema = {
        workspace: { get: vi.fn() },
        "credit-reservations": { get: vi.fn(), delete: vi.fn() },
      } as unknown as DatabaseSchema;

      const mockContext: AugmentedContext = {
        addWorkspaceCreditTransaction: vi.fn(),
      } as unknown as AugmentedContext;

      mockSearchDocuments.mockResolvedValue(mockSearchResults);
      mockReserveRerankingCredits.mockResolvedValue({
        reservationId: "res-123",
        reservedAmount: 1000,
        workspace: { creditBalance: 100_000_000_000 },
      });
      mockRerankSnippets.mockResolvedValue({
        snippets: rerankedResults,
        costUsd: 0.001,
        generationId: "gen-123",
      });

      const messages: ModelMessage[] = [
        { role: "user", content: "Test query" },
      ];

      const result = await injectKnowledgeIntoMessages(
        "workspace-1",
        agent,
        messages,
        mockDb,
        mockContext,
      );

      expect(mockRerankSnippets).toHaveBeenCalledWith(
        "Test query",
        mockSearchResults,
        "cohere/rerank-v3",
        "workspace-1",
      );

      // Should use re-ranked results
      expect(result.modelMessages[0].content).toContain(
        "Second relevant snippet",
      );
      expect(result.modelMessages[0].content).toContain(
        "First relevant snippet",
      );

      // Should create re-ranking request message
      expect(result.rerankingRequestMessage).toBeDefined();
      expect(result.rerankingRequestMessage?.role).toBe("system");
      if (
        result.rerankingRequestMessage &&
        Array.isArray(result.rerankingRequestMessage.content)
      ) {
        // First element should be text content
        expect(result.rerankingRequestMessage.content[0]).toHaveProperty(
          "type",
          "text",
        );
        // Second element should be reranking-request content
        const requestContent = result.rerankingRequestMessage.content[1];
        expect(requestContent).toHaveProperty("type", "reranking-request");
        if (
          typeof requestContent === "object" &&
          requestContent !== null &&
          "type" in requestContent &&
          requestContent.type === "reranking-request"
        ) {
          expect(requestContent.query).toBe("Test query");
          expect(requestContent.model).toBe("cohere/rerank-v3");
          expect(requestContent.documentCount).toBe(2);
          expect(requestContent.documentNames).toBeDefined();
          expect(Array.isArray(requestContent.documentNames)).toBe(true);
        }
      }

      // Should create re-ranking result message
      expect(result.rerankingResultMessage).toBeDefined();
      expect(result.rerankingResultMessage?.role).toBe("system");
      if (
        result.rerankingResultMessage &&
        Array.isArray(result.rerankingResultMessage.content)
      ) {
        // First element should be text content with model and cost
        const textContent = result.rerankingResultMessage.content[0];
        expect(textContent).toHaveProperty("type", "text");
        if (
          typeof textContent === "object" &&
          textContent !== null &&
          "type" in textContent &&
          textContent.type === "text"
        ) {
          expect(textContent.text).toContain("**Model:**");
          expect(textContent.text).toContain("cohere/rerank-v3");
          expect(textContent.text).toContain("**Cost:**");
          expect(textContent.text).toContain("$0.001");
        }
        // Second element should be reranking-result content
        const resultContent = result.rerankingResultMessage.content[1];
        expect(resultContent).toHaveProperty("type", "reranking-result");
        if (
          typeof resultContent === "object" &&
          resultContent !== null &&
          "type" in resultContent &&
          resultContent.type === "reranking-result"
        ) {
          expect(resultContent.model).toBe("cohere/rerank-v3");
          expect(resultContent.documentCount).toBe(2);
          expect(resultContent.costUsd).toBe(1_000_000); // 0.001 USD = 1_000_000 nano-dollars
          expect(resultContent.generationId).toBe("gen-123");
          expect(resultContent.rerankedDocuments).toHaveLength(2);
        }
      }
    });

    it("should fall back to original results if re-ranking fails", async () => {
      const agent = {
        enableKnowledgeInjection: true,
        enableKnowledgeReranking: true,
        knowledgeRerankingModel: "cohere/rerank-v3",
      };

      const mockDb: DatabaseSchema = {
        workspace: { get: vi.fn() },
        "credit-reservations": { get: vi.fn(), delete: vi.fn() },
      } as unknown as DatabaseSchema;

      const mockContext: AugmentedContext = {
        addWorkspaceCreditTransaction: vi.fn(),
      } as unknown as AugmentedContext;

      mockSearchDocuments.mockResolvedValue(mockSearchResults);
      mockReserveRerankingCredits.mockResolvedValue({
        reservationId: "res-123",
        reservedAmount: 1000,
        workspace: { creditBalance: 100_000_000_000 },
      });
      mockRerankSnippets.mockRejectedValue(new Error("Re-ranking failed"));

      const messages: ModelMessage[] = [
        { role: "user", content: "Test query" },
      ];

      const result = await injectKnowledgeIntoMessages(
        "workspace-1",
        agent,
        messages,
        mockDb,
        mockContext,
      );

      // Should still create re-ranking request message
      expect(result.rerankingRequestMessage).toBeDefined();

      // Should create error result message
      expect(result.rerankingResultMessage).toBeDefined();
      if (
        result.rerankingResultMessage &&
        Array.isArray(result.rerankingResultMessage.content)
      ) {
        // First element should be text content with model, cost, and error
        const textContent = result.rerankingResultMessage.content[0];
        expect(textContent).toHaveProperty("type", "text");
        if (
          typeof textContent === "object" &&
          textContent !== null &&
          "type" in textContent &&
          textContent.type === "text"
        ) {
          expect(textContent.text).toContain("**Model:**");
          expect(textContent.text).toContain("cohere/rerank-v3");
          expect(textContent.text).toContain("**Cost:**");
          expect(textContent.text).toContain("$0.000000");
          expect(textContent.text).toContain("**Error:**");
          expect(textContent.text).toContain("Re-ranking failed");
        }
        // Second element should be reranking-result content
        const resultContent = result.rerankingResultMessage.content[1];
        if (
          typeof resultContent === "object" &&
          resultContent !== null &&
          "type" in resultContent &&
          resultContent.type === "reranking-result"
        ) {
          expect(resultContent.error).toBeDefined();
          expect(resultContent.costUsd).toBe(0); // No cost if re-ranking failed
        }
      }

      // Should use original results
      expect(result.modelMessages[0].content).toContain(
        "First relevant snippet",
      );
      expect(result.modelMessages[0].content).toContain(
        "Second relevant snippet",
      );
    });

    it("should not create re-ranking messages when re-ranking is disabled", async () => {
      const agent = {
        enableKnowledgeInjection: true,
        enableKnowledgeReranking: false,
      };

      mockSearchDocuments.mockResolvedValue(mockSearchResults);

      const messages: ModelMessage[] = [
        { role: "user", content: "Test query" },
      ];

      const result = await injectKnowledgeIntoMessages(
        "workspace-1",
        agent,
        messages,
      );

      // Should not call re-ranking
      expect(mockRerankSnippets).not.toHaveBeenCalled();

      // Should not create re-ranking messages
      expect(result.rerankingRequestMessage).toBeUndefined();
      expect(result.rerankingResultMessage).toBeUndefined();

      // Should still create knowledge injection message
      expect(result.knowledgeInjectionMessage).toBeDefined();
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
        messages,
      );

      const knowledgeContent = result.modelMessages[0].content as string;
      expect(knowledgeContent).toContain(
        "## Knowledge from Workspace Documents",
      );
      expect(knowledgeContent).toContain("[1] Document: Document 1 (/folder1)");
      expect(knowledgeContent).toContain("Similarity: 90.0%");
      expect(knowledgeContent).toContain("First relevant snippet");
      expect(knowledgeContent).toContain("[2] Document: Document 2");
      expect(knowledgeContent).toContain("Similarity: 80.0%");
      expect(knowledgeContent).toContain("Second relevant snippet");
      expect(knowledgeContent).toContain(
        "Please use this information to provide a comprehensive and accurate response",
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
        messages,
      );

      const knowledgeContent = result.modelMessages[0].content as string;
      expect(knowledgeContent).toContain(
        "[1] Document: Document (/path/to/folder)",
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
        messages,
      );

      const knowledgeContent = result.modelMessages[0].content as string;
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
        messages,
      );

      // Should return original messages on error
      expect(result.modelMessages).toEqual(messages);
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
        messages,
      );

      // Should return original messages since there's no query to search for
      expect(result.modelMessages).toEqual(messages);
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
        messages,
      );

      // Knowledge should be injected before the FIRST user message
      expect(result.modelMessages[1].role).toBe("user");
      expect(result.modelMessages[1].content).toContain("Knowledge from");
      expect(result.modelMessages[2].role).toBe("user");
      expect(result.modelMessages[2].content).toBe("First query");
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
          workspace: { creditBalance: 100_000_000_000 },
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
          false, // usesByok
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
          false, // usesByok
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
          workspace: { creditBalance: 100_000_000_000 },
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
          "conversation-1",
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
          "conversation-1",
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
          workspace: { creditBalance: 100_000_000_000 },
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
        );

        expect(mockQueueRerankingCostVerification).toHaveBeenCalledWith(
          "res-123",
          "gen-123",
          "workspace-1",
          "agent-1",
          "conversation-1",
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
          workspace: { creditBalance: 100_000_000_000 },
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
          mockContext,
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
          messages,
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
          new Error("Insufficient credits"),
        );
        // When reservation fails, the error is caught and original messages are returned
        mockRerankSnippets.mockResolvedValue({
          snippets: mockSearchResults,
        });

        const messages: ModelMessage[] = [
          { role: "user", content: "Test query" },
        ];

        // When credit reservation fails, the error is caught and original messages are returned
        const result = await injectKnowledgeIntoMessages(
          "workspace-1",
          agent,
          messages,
          mockDb,
          mockContext,
        );

        // Should return original messages when credit reservation fails
        expect(result.modelMessages).toEqual(messages);
        // Re-ranking should not be called when reservation fails
        expect(mockRerankSnippets).not.toHaveBeenCalled();
        // No credit adjustment should happen since reservation failed
        expect(mockAdjustRerankingCreditReservation).not.toHaveBeenCalled();
      });

      it("should not report credit user errors to Sentry", async () => {
        const agent = {
          enableKnowledgeInjection: true,
          enableKnowledgeReranking: true,
          knowledgeRerankingModel: "cohere/rerank-v3",
        };

        mockSearchDocuments.mockResolvedValue(mockSearchResults);
        mockReserveRerankingCredits.mockRejectedValue(
          new InsufficientCreditsError("workspace-1", 1_000, 0, "usd"),
        );
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
          mockContext,
        );

        expect(result.modelMessages).toEqual(messages);
        expect(mockSentryCaptureException).not.toHaveBeenCalled();
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
          workspace: { creditBalance: 100_000_000_000 },
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
          "conversation-1",
        );

        expect(mockRefundRerankingCredits).toHaveBeenCalledWith(
          mockDb,
          "res-123",
          "workspace-1",
          mockContext,
          3, // maxRetries
          "agent-1",
          "conversation-1",
        );
      });

      it("should skip credit management when BYOK is enabled", async () => {
        const agent = {
          enableKnowledgeInjection: true,
          enableKnowledgeReranking: true,
          knowledgeRerankingModel: "cohere/rerank-v3",
        };

        mockSearchDocuments.mockResolvedValue(mockSearchResults);
        // When BYOK is enabled, reserveRerankingCredits is not called
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
          true, // usesByok
        );

        // When BYOK is enabled, credit reservation is skipped, so rerankingReservationId is undefined
        // Therefore adjustRerankingCreditReservation should not be called
        expect(mockReserveRerankingCredits).not.toHaveBeenCalled();
        expect(mockAdjustRerankingCreditReservation).not.toHaveBeenCalled();
        expect(mockQueueRerankingCostVerification).not.toHaveBeenCalled();
        // Re-ranking still happens, just without credit tracking
        expect(mockRerankSnippets).toHaveBeenCalled();
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
          workspace: { creditBalance: 100_000_000_000 },
        });
        mockRerankSnippets.mockResolvedValue({
          snippets: mockSearchResults,
          costUsd: 0.01,
          generationId: "gen-123",
        });
        mockAdjustRerankingCreditReservation.mockRejectedValue(
          new Error("Adjustment failed"),
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
          mockContext,
        );

        // Should still inject knowledge
        expect(result.modelMessages[0].content).toContain("Knowledge from");
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
          workspace: { creditBalance: 100_000_000_000 },
        });
        mockRerankSnippets.mockRejectedValue(new Error("Re-ranking failed"));
        mockRefundRerankingCredits.mockRejectedValue(
          new Error("Refund failed"),
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
          mockContext,
        );

        // Should still inject knowledge with original results
        expect(result.modelMessages[0].content).toContain(
          "First relevant snippet",
        );
      });
    });
  });
});
