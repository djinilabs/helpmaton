import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  applyMemoryOperationsToGraph,
  extractConversationMemory,
} from "../memoryExtraction";

const mockGenerateText = vi.fn();
const mockCreateModel = vi.fn();
const mockGetDefaultModel = vi.fn();
const mockGetWorkspaceApiKey = vi.fn();
const mockValidateCreditsAndLimits = vi.fn();
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
  validateCreditsAndLimits: (...args: unknown[]) =>
    mockValidateCreditsAndLimits(...args),
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

    expect(mockValidateCreditsAndLimits).toHaveBeenCalled();
    expect(result?.summary).toBe("Summary text");
    expect(result?.memoryOperations).toHaveLength(1);
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
      .mockResolvedValueOnce([{ id: "fact-1" }]) // UPDATE -> existing
      .mockResolvedValueOnce([{ id: "fact-2" }]); // ADD -> existing

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
    expect(mockUpdateFacts).toHaveBeenCalled();
    expect(mockDeleteFacts).toHaveBeenCalledWith({
      source_id: "User",
      label: "uses_tech",
      target_id: "GCP",
    });
    expect(mockSave).toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();
  });
});
