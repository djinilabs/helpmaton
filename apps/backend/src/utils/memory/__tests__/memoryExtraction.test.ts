import { describe, it, expect, vi, beforeEach } from "vitest";

import type { AugmentedContext } from "../../workspaceCreditContext";
import {
  applyMemoryOperationsToGraph,
  extractConversationMemory,
} from "../memoryExtraction";

const mockGenerateText = vi.fn();
const mockCreateModel = vi.fn();
const mockGetDefaultModel = vi.fn();
const mockGetWorkspaceApiKey = vi.fn();
const mockValidateCreditsAndLimitsAndReserve = vi.fn();
const mockAdjustCreditsAfterLLMCall = vi.fn();
const mockCleanupReservationOnError = vi.fn();
const mockCleanupReservationWithoutTokenUsage = vi.fn();
const mockEnqueueCostVerificationIfNeeded = vi.fn();
const mockExtractTokenUsageAndCosts = vi.fn();
const mockCreateGraphDb = vi.fn();
const mockCreateRequestTimeout = vi.fn();
const mockCleanupRequestTimeout = vi.fn();

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

vi.mock("../../../http/utils/modelFactory", () => ({
  createModel: (...args: unknown[]) => mockCreateModel(...args),
  getDefaultModel: () => mockGetDefaultModel(),
}));

vi.mock("../../../http/utils/agent-keys", () => ({
  getWorkspaceApiKey: (...args: unknown[]) => mockGetWorkspaceApiKey(...args),
}));

vi.mock("../../../tables", () => ({
  database: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../creditValidation", () => ({
  validateCreditsAndLimitsAndReserve: (...args: unknown[]) =>
    mockValidateCreditsAndLimitsAndReserve(...args),
}));

vi.mock("../../../http/utils/generationCreditManagement", () => ({
  adjustCreditsAfterLLMCall: (...args: unknown[]) =>
    mockAdjustCreditsAfterLLMCall(...args),
  cleanupReservationOnError: (...args: unknown[]) =>
    mockCleanupReservationOnError(...args),
  cleanupReservationWithoutTokenUsage: (...args: unknown[]) =>
    mockCleanupReservationWithoutTokenUsage(...args),
  enqueueCostVerificationIfNeeded: (...args: unknown[]) =>
    mockEnqueueCostVerificationIfNeeded(...args),
}));

vi.mock("../../../http/utils/generationTokenExtraction", () => ({
  extractTokenUsageAndCosts: (...args: unknown[]) =>
    mockExtractTokenUsageAndCosts(...args),
}));

vi.mock("../../duckdb/graphDb", () => ({
  createGraphDb: (...args: unknown[]) => mockCreateGraphDb(...args),
}));

vi.mock("../../../http/utils/requestTimeout", () => ({
  createRequestTimeout: (...args: unknown[]) =>
    mockCreateRequestTimeout(...args),
  cleanupRequestTimeout: (...args: unknown[]) =>
    mockCleanupRequestTimeout(...args),
}));

describe("memoryExtraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateModel.mockResolvedValue({});
    mockGetDefaultModel.mockReturnValue("default-model");
    mockGetWorkspaceApiKey.mockResolvedValue(null);
    mockCreateRequestTimeout.mockReturnValue({
      signal: new AbortController().signal,
    });
    mockValidateCreditsAndLimitsAndReserve.mockResolvedValue(null);
    mockExtractTokenUsageAndCosts.mockReturnValue({
      tokenUsage: undefined,
      openrouterGenerationId: undefined,
      openrouterGenerationIds: [],
      provisionalCostUsd: undefined,
    });
  });

  it("extracts summary and memory operations from the LLM response", async () => {
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({
        summary: "Summary text",
        memory_operations: [
          {
            operation: "ADD",
            subject: "User",
            predicate: "has_name",
            object: "Alice",
            confidence: 1,
          },
        ],
      }),
    });

    const result = await extractConversationMemory({
      workspaceId: "workspace-1",
      agentId: "agent-1",
      conversationId: "conversation-1",
      conversationText: "User: Hello",
    });

    expect(mockValidateCreditsAndLimitsAndReserve).toHaveBeenCalled();
    expect(result?.summary).toBe("Summary text");
    expect(result?.memoryOperations).toHaveLength(1);
  });

  it("parses responses wrapped in json code fences", async () => {
    mockGenerateText.mockResolvedValue({
      text:
        "```json\n" +
        JSON.stringify({
          summary: "Summary text",
          memory_operations: [],
        }) +
        "\n```",
    });

    const result = await extractConversationMemory({
      workspaceId: "workspace-1",
      agentId: "agent-1",
      conversationId: "conversation-1",
      conversationText: "User: Hello",
    });

    expect(result?.summary).toBe("Summary text");
    expect(result?.memoryOperations).toHaveLength(0);
  });

  it("parses valid JSON inside code block with surrounding text", async () => {
    const payload = {
      summary: "Summary from block",
      memory_operations: [],
    };
    mockGenerateText.mockResolvedValue({
      text:
        "Here is the result:\n\n```json\n" +
        JSON.stringify(payload) +
        "\n```\n\nDone.",
    });

    const result = await extractConversationMemory({
      workspaceId: "workspace-1",
      agentId: "agent-1",
      conversationId: "conversation-1",
      conversationText: "User: Hello",
    });

    expect(result?.summary).toBe("Summary from block");
    expect(result?.memoryOperations).toHaveLength(0);
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
  });

  it("accepts numeric object (and subject/predicate) from LLM and coerces to string", async () => {
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({
        summary: "User shared quantity",
        memory_operations: [
          {
            operation: "ADD",
            subject: "User",
            predicate: "child_count",
            object: 3,
            confidence: 1,
          },
          {
            operation: "ADD",
            subject: "User",
            predicate: "preference",
            object: "JavaScript",
            confidence: 0.9,
          },
        ],
      }),
    });

    const result = await extractConversationMemory({
      workspaceId: "workspace-1",
      agentId: "agent-1",
      conversationId: "conversation-1",
      conversationText: "User: I have 3 children.",
    });

    expect(result?.summary).toBe("User shared quantity");
    expect(result?.memoryOperations).toHaveLength(2);
    expect(result?.memoryOperations[0].object).toBe("3");
    expect(typeof result?.memoryOperations[0].object).toBe("string");
    expect(result?.memoryOperations[1].object).toBe("JavaScript");
  });

  it("refeeds parse error and retries; succeeds on second attempt", async () => {
    // First attempt: invalid (missing required "object" field) → ZodError
    mockGenerateText
      .mockResolvedValueOnce({
        text: JSON.stringify({
          summary: "Bad",
          memory_operations: [
            {
              operation: "ADD",
              subject: "User",
              predicate: "has_name",
              // object missing → validation fails
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          summary: "Fixed",
          memory_operations: [
            {
              operation: "ADD",
              subject: "User",
              predicate: "has_name",
              object: "Alice",
              confidence: 1,
            },
          ],
        }),
      });

    const result = await extractConversationMemory({
      workspaceId: "workspace-1",
      agentId: "agent-1",
      conversationId: "conversation-1",
      conversationText: "User: My name is Alice.",
    });

    expect(mockGenerateText).toHaveBeenCalledTimes(2);
    expect(result?.summary).toBe("Fixed");
    expect(result?.memoryOperations).toHaveLength(1);
    expect(result?.memoryOperations[0].object).toBe("Alice");
  });

  it("throws after max attempts when parse keeps failing", async () => {
    mockGenerateText.mockResolvedValue({
      text: "```json\n{ invalid }\n```",
    });

    const err = await extractConversationMemory({
      workspaceId: "workspace-1",
      agentId: "agent-1",
      conversationId: "conversation-1",
      conversationText: "User: Hello",
    }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/failed after 2 attempts/);
    expect((err as Error).cause).toBeDefined();
    expect(mockGenerateText).toHaveBeenCalledTimes(2);
  });

  it("retries on empty response and succeeds on second attempt", async () => {
    mockGenerateText
      .mockResolvedValueOnce({ text: "" })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          summary: "Recovered",
          memory_operations: [],
        }),
      });

    const result = await extractConversationMemory({
      workspaceId: "workspace-1",
      agentId: "agent-1",
      conversationId: "conversation-1",
      conversationText: "User: Hi",
    });

    expect(mockGenerateText).toHaveBeenCalledTimes(2);
    expect(result?.summary).toBe("Recovered");
    expect(result?.memoryOperations).toHaveLength(0);
  });

  it("charges for empty response then retries (no refund on parse/empty)", async () => {
    mockGenerateText
      .mockResolvedValueOnce({ text: "" })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          summary: "Ok",
          memory_operations: [],
        }),
      });
    mockValidateCreditsAndLimitsAndReserve
      .mockResolvedValueOnce({
        reservationId: "res-1",
        reservedAmount: 100,
        workspace: { creditBalance: 0, currency: "usd" },
      })
      .mockResolvedValueOnce({
        reservationId: "res-2",
        reservedAmount: 100,
        workspace: { creditBalance: 0, currency: "usd" },
      });
    mockExtractTokenUsageAndCosts.mockReturnValue({
      tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      openrouterGenerationId: "gen-1",
      openrouterGenerationIds: ["gen-1"],
      provisionalCostUsd: 100,
    });

    const context = {
      addWorkspaceCreditTransaction: vi.fn(),
    } as unknown as AugmentedContext;

    const result = await extractConversationMemory({
      workspaceId: "workspace-1",
      agentId: "agent-1",
      conversationId: "conversation-1",
      conversationText: "User: Hi",
      context,
    });

    expect(result?.summary).toBe("Ok");
    expect(mockGenerateText).toHaveBeenCalledTimes(2);
    expect(mockAdjustCreditsAfterLLMCall).toHaveBeenCalledTimes(2);
  });

  it("throws after max attempts when both responses are empty", async () => {
    mockGenerateText.mockResolvedValue({ text: "" });

    await expect(
      extractConversationMemory({
        workspaceId: "workspace-1",
        agentId: "agent-1",
        conversationId: "conversation-1",
        conversationText: "User: Hello",
      }),
    ).rejects.toThrow("Memory extraction returned empty response");

    expect(mockGenerateText).toHaveBeenCalledTimes(2);
  });

  it("second attempt receives refeed messages (original + assistant + user error)", async () => {
    const invalidPayload = JSON.stringify({
      summary: "Bad",
      memory_operations: [
        { operation: "ADD", subject: "User", predicate: "p" },
        // missing object
      ],
    });
    mockGenerateText
      .mockResolvedValueOnce({ text: invalidPayload })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          summary: "Ok",
          memory_operations: [],
        }),
      });

    await extractConversationMemory({
      workspaceId: "workspace-1",
      agentId: "agent-1",
      conversationId: "conversation-1",
      conversationText: "User: Hello",
    });

    expect(mockGenerateText).toHaveBeenCalledTimes(2);
    const firstCall = mockGenerateText.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const secondCall = mockGenerateText.mock.calls[1][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(firstCall.messages).toHaveLength(1);
    expect(firstCall.messages[0].role).toBe("user");
    expect(secondCall.messages).toHaveLength(3);
    expect(secondCall.messages[0].role).toBe("user");
    expect(secondCall.messages[1].role).toBe("assistant");
    expect(secondCall.messages[1].content).toBe(invalidPayload);
    expect(secondCall.messages[2].role).toBe("user");
    expect(secondCall.messages[2].content).toMatch(/failed validation/i);
    expect(secondCall.messages[2].content).toMatch(/subject.*predicate.*object/i);
  });

  it("reserves and adjusts credits twice when retry succeeds", async () => {
    mockGenerateText
      .mockResolvedValueOnce({
        text: JSON.stringify({
          summary: "Bad",
          memory_operations: [{ operation: "ADD", subject: "U", predicate: "p" }],
        }),
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          summary: "Good",
          memory_operations: [],
        }),
      });
    mockValidateCreditsAndLimitsAndReserve
      .mockResolvedValueOnce({
        reservationId: "res-1",
        reservedAmount: 100,
        workspace: { creditBalance: 0, currency: "usd" },
      })
      .mockResolvedValueOnce({
        reservationId: "res-2",
        reservedAmount: 100,
        workspace: { creditBalance: 0, currency: "usd" },
      });
    mockExtractTokenUsageAndCosts.mockReturnValue({
      tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      openrouterGenerationId: "gen-1",
      openrouterGenerationIds: ["gen-1"],
      provisionalCostUsd: 100,
    });

    const context = {
      addWorkspaceCreditTransaction: vi.fn(),
    } as unknown as AugmentedContext;

    await extractConversationMemory({
      workspaceId: "workspace-1",
      agentId: "agent-1",
      conversationId: "conversation-1",
      conversationText: "User: Hello",
      context,
    });

    expect(mockValidateCreditsAndLimitsAndReserve).toHaveBeenCalledTimes(2);
    expect(mockAdjustCreditsAfterLLMCall).toHaveBeenCalledTimes(2);
    expect(mockEnqueueCostVerificationIfNeeded).toHaveBeenCalledTimes(2);
  });

  it("adjusts credits after a successful extraction when reservation exists", async () => {
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({
        summary: "Summary text",
        memory_operations: [],
      }),
    });
    mockValidateCreditsAndLimitsAndReserve.mockResolvedValue({
      reservationId: "reservation-1",
      reservedAmount: 100,
      workspace: { creditBalance: 0, currency: "usd" },
    });
    mockExtractTokenUsageAndCosts.mockReturnValue({
      tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      openrouterGenerationId: "gen-1",
      openrouterGenerationIds: ["gen-1"],
      provisionalCostUsd: 100,
    });

    const context = {
      addWorkspaceCreditTransaction: vi.fn(),
    } as unknown as AugmentedContext;

    await extractConversationMemory({
      workspaceId: "workspace-1",
      agentId: "agent-1",
      conversationId: "conversation-1",
      conversationText: "User: Hello",
      context,
    });

    expect(mockAdjustCreditsAfterLLMCall).toHaveBeenCalled();
    expect(mockEnqueueCostVerificationIfNeeded).toHaveBeenCalled();
  });

  it("cleans up reservation when token usage is missing", async () => {
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({
        summary: "Summary text",
        memory_operations: [],
      }),
    });
    mockValidateCreditsAndLimitsAndReserve.mockResolvedValue({
      reservationId: "reservation-2",
      reservedAmount: 100,
      workspace: { creditBalance: 0, currency: "usd" },
    });
    mockExtractTokenUsageAndCosts.mockReturnValue({
      tokenUsage: undefined,
      openrouterGenerationId: undefined,
      openrouterGenerationIds: [],
      provisionalCostUsd: undefined,
    });

    const context = {
      addWorkspaceCreditTransaction: vi.fn(),
    } as unknown as AugmentedContext;

    await extractConversationMemory({
      workspaceId: "workspace-1",
      agentId: "agent-1",
      conversationId: "conversation-1",
      conversationText: "User: Hello",
      context,
    });

    expect(mockCleanupReservationWithoutTokenUsage).toHaveBeenCalled();
  });

  it("applies memory operations to the graph database", async () => {
    const mockInsertFacts = vi.fn();
    const mockUpdateFacts = vi.fn();
    const mockDeleteFacts = vi.fn();
    const mockSave = vi.fn();
    const mockClose = vi.fn();
    const mockQueryGraph = vi
      .fn()
      .mockResolvedValueOnce([]) // ADD -> not found
      .mockResolvedValueOnce([{ id: "fact-1" }, { id: "fact-2" }]) // UPDATE -> existing
      .mockResolvedValueOnce([{ id: "fact-3" }]); // ADD -> existing

    mockCreateGraphDb.mockResolvedValue({
      insertFacts: mockInsertFacts,
      updateFacts: mockUpdateFacts,
      deleteFacts: mockDeleteFacts,
      queryGraph: mockQueryGraph,
      save: mockSave,
      close: mockClose,
    });

    await applyMemoryOperationsToGraph({
      workspaceId: "workspace-1",
      agentId: "agent-1",
      conversationId: "conversation-1",
      memoryOperations: [
        {
          operation: "ADD",
          subject: "User",
          predicate: "likes",
          object: "React",
          confidence: 1,
        },
        {
          operation: "UPDATE",
          subject: "User",
          predicate: "uses_tech",
          object: "AWS",
          confidence: 1,
        },
        {
          operation: "DELETE",
          subject: "User",
          predicate: "uses_tech",
          object: "GCP",
          confidence: 1,
        },
        {
          operation: "ADD",
          subject: "User",
          predicate: "works_at",
          object: "Helpmaton",
          confidence: 1,
        },
      ],
    });

    expect(mockInsertFacts).toHaveBeenCalled();
    expect(mockDeleteFacts).toHaveBeenCalledWith({ id: "fact-1" });
    expect(mockDeleteFacts).toHaveBeenCalledWith({ id: "fact-2" });
    expect(mockDeleteFacts).toHaveBeenCalledWith({
      source_id: "User",
      label: "uses_tech",
      target_id: "GCP",
    });
    expect(mockUpdateFacts).toHaveBeenCalledWith(
      { id: "fact-3" },
      expect.objectContaining({
        properties: expect.objectContaining({
          conversationId: "conversation-1",
        }),
      }),
    );
    expect(mockSave).toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();
  });
});
