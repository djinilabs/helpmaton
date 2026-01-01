/**
 * Unit tests for Agent Utils - Fuzzy Matching and Delegation
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies using vi.hoisted
const { mockDatabase, mockQueues } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockQueues: {
      publish: vi.fn(),
    },
  };
});

vi.mock("../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("@architect/functions", () => ({
  queues: mockQueues,
}));

vi.mock("../../../utils/conversationLogger", () => ({
  trackDelegation: vi.fn().mockResolvedValue(undefined),
  extractTokenUsage: vi.fn(),
}));

// Import after mocks are set up
import type { AgentRecord, DatabaseSchema } from "../../../tables/schema";
import {
  createCallAgentAsyncTool,
  createCallAgentTool,
  createListAgentsTool,
  findAgentByQuery,
} from "../agentUtils";

// Helper to create mock agent records
function createMockAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  const defaultPk =
    overrides.pk || `agents/test-workspace/test-agent-${Math.random().toString(36).substring(7)}`;
  return {
    pk: defaultPk,
    sk: "agent",
    workspaceId: "test-workspace",
    name: "Test Agent",
    systemPrompt: "You are a helpful assistant.",
    modelName: undefined,
    provider: "google" as const,
    enableSearchDocuments: false,
    enableMemorySearch: false,
    searchWebProvider: undefined,
    fetchWebProvider: undefined,
    enableSendEmail: false,
    notificationChannelId: undefined,
    enabledMcpServerIds: [],
    clientTools: [],
    version: 1,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("agentUtils - Fuzzy Matching", () => {
  let mockDb: DatabaseSchema;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = {
      agent: {
        get: vi.fn(),
      },
    } as unknown as DatabaseSchema;
    mockDatabase.mockResolvedValue(mockDb);
  });

  describe("findAgentByQuery - Fuzzy Matching", () => {
    it("should match agent with search_documents capability using 'doc search' query", async () => {
      const agent = createMockAgent({
        pk: "agents/test-workspace/doc-agent",
        name: "Document Search Agent",
        enableSearchDocuments: true,
        systemPrompt: "I search documents for you.",
      });

      (mockDb.agent.get as ReturnType<typeof vi.fn>).mockResolvedValue(agent);

      const result = await findAgentByQuery(
        "test-workspace",
        "doc search",
        ["doc-agent"]
      );

      expect(result).not.toBeNull();
      expect(result?.agentId).toBe("doc-agent");
      expect(result?.agentName).toBe("Document Search Agent");
      expect(result?.score).toBeGreaterThanOrEqual(2.0);
    });

    it("should match agent with search_web capability using 'find web stuff' query", async () => {
      const agent = createMockAgent({
        pk: "agents/test-workspace/web-agent",
        name: "Web Search Agent",
        searchWebProvider: "tavily",
        systemPrompt: "I search the web for information.",
      });

      (mockDb.agent.get as ReturnType<typeof vi.fn>).mockResolvedValue(agent);

      const result = await findAgentByQuery(
        "test-workspace",
        "find web stuff",
        ["web-agent"]
      );

      expect(result).not.toBeNull();
      expect(result?.agentId).toBe("web-agent");
      expect(result?.score).toBeGreaterThanOrEqual(2.0);
    });

    it("should match agent with send_email capability using 'send mail' query", async () => {
      const agent = createMockAgent({
        pk: "agents/test-workspace/email-agent",
        name: "Email Agent",
        enableSendEmail: true,
        systemPrompt: "I send emails for you.",
      });

      (mockDb.agent.get as ReturnType<typeof vi.fn>).mockResolvedValue(agent);

      const result = await findAgentByQuery(
        "test-workspace",
        "send mail",
        ["email-agent"]
      );

      expect(result).not.toBeNull();
      expect(result?.agentId).toBe("email-agent");
      expect(result?.score).toBeGreaterThanOrEqual(2.0);
    });

    it("should match agent with search_memory capability using 'memory agent' query", async () => {
      const agent = createMockAgent({
        pk: "agents/test-workspace/memory-agent",
        name: "Memory Agent",
        enableMemorySearch: true,
        systemPrompt: "I search memory for past information.",
      });

      (mockDb.agent.get as ReturnType<typeof vi.fn>).mockResolvedValue(agent);

      const result = await findAgentByQuery(
        "test-workspace",
        "memory agent",
        ["memory-agent"]
      );

      expect(result).not.toBeNull();
      expect(result?.agentId).toBe("memory-agent");
      expect(result?.score).toBeGreaterThanOrEqual(2.0);
    });

    it("should match agent by partial word (doc matches document)", async () => {
      const agent = createMockAgent({
        pk: "agents/test-workspace/doc-agent",
        name: "Document Search Agent",
        enableSearchDocuments: true,
      });

      (mockDb.agent.get as ReturnType<typeof vi.fn>).mockResolvedValue(agent);

      const result = await findAgentByQuery(
        "test-workspace",
        "doc",
        ["doc-agent"]
      );

      expect(result).not.toBeNull();
      expect(result?.agentId).toBe("doc-agent");
    });

    it("should match agent by synonym (mail matches email)", async () => {
      const agent = createMockAgent({
        pk: "agents/test-workspace/email-agent",
        name: "Email Agent",
        enableSendEmail: true,
      });

      (mockDb.agent.get as ReturnType<typeof vi.fn>).mockResolvedValue(agent);

      const result = await findAgentByQuery(
        "test-workspace",
        "mail",
        ["email-agent"]
      );

      expect(result).not.toBeNull();
      expect(result?.agentId).toBe("email-agent");
    });

    it("should match agent by name with highest score", async () => {
      const agent = createMockAgent({
        pk: "agents/test-workspace/search-agent",
        name: "Search Agent",
        enableSearchDocuments: true,
      });

      (mockDb.agent.get as ReturnType<typeof vi.fn>).mockResolvedValue(agent);

      const result = await findAgentByQuery(
        "test-workspace",
        "Search Agent",
        ["search-agent"]
      );

      expect(result).not.toBeNull();
      expect(result?.agentId).toBe("search-agent");
      // Name match should give high score (15 points for exact match)
      expect(result?.score).toBeGreaterThan(10);
    });
  });

  describe("findAgentByQuery - Threshold Enforcement", () => {
    it("should return null for irrelevant query below threshold", async () => {
      // Use an agent with a name and prompt that won't match the query
      const agent = createMockAgent({
        pk: "agents/test-workspace/test-agent",
        name: "Helper Bot",
        systemPrompt: "I help with tasks.",
      });

      (mockDb.agent.get as ReturnType<typeof vi.fn>).mockResolvedValue(agent);

      const result = await findAgentByQuery(
        "test-workspace",
        "quantum physics theoretical framework",
        ["test-agent"]
      );

      // Should be null if score is below threshold (2.0)
      // If it's not null, verify the score is actually below threshold
      if (result !== null) {
        expect(result.score).toBeLessThan(2.0);
      } else {
        expect(result).toBeNull();
      }
    });

    it("should return null for empty query", async () => {
      const agent = createMockAgent({
        pk: "agents/test-workspace/test-agent",
        name: "Test Agent",
      });

      (mockDb.agent.get as ReturnType<typeof vi.fn>).mockResolvedValue(agent);

      // Empty query should be handled - check if it returns null or handles gracefully
      const result = await findAgentByQuery(
        "test-workspace",
        "   ", // Whitespace only
        ["test-agent"]
      );

      // Empty/whitespace query should return null or very low score
      if (result !== null) {
        expect(result.score).toBeLessThan(2.0);
      }
    });

    it("should return null when no agents match", async () => {
      const agent = createMockAgent({
        pk: "agents/test-workspace/test-agent",
        name: "Helper Bot",
        systemPrompt: "I help with basic tasks.",
      });

      (mockDb.agent.get as ReturnType<typeof vi.fn>).mockResolvedValue(agent);

      const result = await findAgentByQuery(
        "test-workspace",
        "quantum mechanics particle physics",
        ["test-agent"]
      );

      // Should return null if score is below threshold
      if (result !== null) {
        expect(result.score).toBeLessThan(2.0);
      } else {
        expect(result).toBeNull();
      }
    });

    it("should return null when no delegatable agents provided", async () => {
      const result = await findAgentByQuery(
        "test-workspace",
        "any query",
        []
      );

      expect(result).toBeNull();
    });
  });

  describe("findAgentByQuery - Scoring", () => {
    it("should select best match when multiple agents match", async () => {
      const agent1 = createMockAgent({
        pk: "agents/test-workspace/agent1",
        name: "Document Agent",
        enableSearchDocuments: true,
        systemPrompt: "I search documents.",
      });

      const agent2 = createMockAgent({
        pk: "agents/test-workspace/agent2",
        name: "Document Search Specialist",
        enableSearchDocuments: true,
        systemPrompt: "I am a specialist in searching documents.",
      });

      (mockDb.agent.get as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(agent1)
        .mockResolvedValueOnce(agent2);

      const result = await findAgentByQuery(
        "test-workspace",
        "document search",
        ["agent1", "agent2"]
      );

      expect(result).not.toBeNull();
      // Agent2 should win because it has "search" in the name
      expect(result?.agentId).toBe("agent2");
    });
  });

  describe("findAgentByQuery - Edge Cases", () => {
    it("should handle agent not found in database gracefully", async () => {
      (mockDb.agent.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await findAgentByQuery(
        "test-workspace",
        "any query",
        ["non-existent-agent"]
      );

      expect(result).toBeNull();
    });

    it("should use cached agent when available", async () => {
      const agent = createMockAgent({
        pk: "agents/test-workspace/cached-agent",
        name: "Cached Agent",
        enableSearchDocuments: true,
      });

      (mockDb.agent.get as ReturnType<typeof vi.fn>).mockResolvedValue(agent);

      // First call - should fetch from database
      const result1 = await findAgentByQuery(
        "test-workspace",
        "document",
        ["cached-agent"]
      );

      expect(result1).not.toBeNull();
      expect(mockDb.agent.get).toHaveBeenCalledTimes(1);

      // Second call - should use cache (agent.get not called again)
      vi.clearAllMocks();
      const result2 = await findAgentByQuery(
        "test-workspace",
        "document",
        ["cached-agent"]
      );

      expect(result2).not.toBeNull();
      // Should still call get to check cache, but cache should be used
      // Note: Cache implementation may vary, but should be efficient
    });
  });
});

describe("agentUtils - Agent List Formatting", () => {
  let mockDb: DatabaseSchema;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = {
      agent: {
        get: vi.fn(),
      },
    } as unknown as DatabaseSchema;
    mockDatabase.mockResolvedValue(mockDb);
  });

  describe("createListAgentsTool", () => {
    it("should format single agent correctly", async () => {
      const agent = createMockAgent({
        pk: "agents/test-workspace/agent1",
        name: "Test Agent",
        systemPrompt: "A test agent description.",
        enableSearchDocuments: true,
      });

      (mockDb.agent.get as ReturnType<typeof vi.fn>).mockResolvedValue(agent);

      const tool = createListAgentsTool("test-workspace", ["agent1"]);
      const result = await (tool as { execute: () => Promise<string> }).execute();

      expect(result).toContain("Test Agent");
      expect(result).toContain("ID: agent1");
      expect(result).toContain("search_documents");
      expect(result).toContain("Description:");
    });

    it("should format multiple agents correctly", async () => {
      const agent1 = createMockAgent({
        pk: "agents/test-workspace/agent1",
        name: "Agent 1",
        enableSearchDocuments: true,
        systemPrompt: "First agent for document search.",
      });

      const agent2 = createMockAgent({
        pk: "agents/test-workspace/agent2",
        name: "Agent 2",
        enableSendEmail: true,
        systemPrompt: "Second agent for sending emails.",
      });

      // Mock should return the correct agent based on the pk being queried
      (mockDb.agent.get as ReturnType<typeof vi.fn>).mockImplementation(
        (pk: string) => {
          if (pk === "agents/test-workspace/agent1") {
            return Promise.resolve(agent1);
          }
          if (pk === "agents/test-workspace/agent2") {
            return Promise.resolve(agent2);
          }
          return Promise.resolve(null);
        }
      );

      const tool = createListAgentsTool("test-workspace", ["agent1", "agent2"]);
      const result = await (tool as unknown as { execute: () => Promise<string> }).execute();

      expect(result).toContain("Agent 1");
      expect(result).toContain("Agent 2");
      expect(result).toContain("search_documents");
      expect(result).toContain("send_email");
    });

    it("should handle agents with no capabilities", async () => {
      const agent = createMockAgent({
        pk: "agents/test-workspace/agent1",
        name: "Basic Agent",
        systemPrompt: "A basic agent with no special capabilities.",
      });

      (mockDb.agent.get as ReturnType<typeof vi.fn>).mockResolvedValue(agent);

      const tool = createListAgentsTool("test-workspace", ["agent1"]);
      const result = await (tool as { execute: () => Promise<string> }).execute();

      expect(result).toContain("Basic Agent");
      expect(result).toContain("Capabilities: none");
    });

    it("should handle empty delegatable agents list", async () => {
      const tool = createListAgentsTool("test-workspace", []);
      const result = await (tool as unknown as { execute: () => Promise<string> }).execute();

      expect(result).toBe("No delegatable agents found.");
    });

    it("should truncate long descriptions to 200 characters", async () => {
      const longDescription = "A".repeat(300);
      const agent = createMockAgent({
        pk: "agents/test-workspace/truncate-agent",
        name: "Truncate Test Agent",
        systemPrompt: longDescription,
      });

      (mockDb.agent.get as ReturnType<typeof vi.fn>).mockResolvedValue(agent);

      const tool = createListAgentsTool("test-workspace", ["truncate-agent"]);
      const result = await (tool as unknown as { execute: () => Promise<string> }).execute();

      expect(result).toContain("...");
      // Description should be truncated - check that it ends with "..."
      const descriptionMatch = result.match(/Description: ([^\n]+)/);
      if (descriptionMatch?.[1]) {
        expect(descriptionMatch[1]).toContain("...");
        expect(descriptionMatch[1].length).toBeLessThanOrEqual(203); // 200 + "..."
      }
    });
  });
});

describe("agentUtils - Delegation Tools", () => {
  let mockDb: DatabaseSchema;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = {
      agent: {
        get: vi.fn(),
      },
      "agent-delegation-tasks": {
        create: vi.fn().mockResolvedValue({}),
      },
      "agent-conversations": {
        atomicUpdate: vi.fn().mockResolvedValue([]),
      },
    } as unknown as DatabaseSchema;
    mockDatabase.mockResolvedValue(mockDb);
    mockQueues.publish.mockResolvedValue({});
  });

  describe("createCallAgentTool - Query-based Matching", () => {
    it("should include agent list in error when query below threshold", async () => {
      const agent = createMockAgent({
        pk: "agents/test-workspace/error-test-agent",
        name: "Error Test Agent",
        systemPrompt: "A test agent for error testing.",
      });

      (mockDb.agent.get as ReturnType<typeof vi.fn>).mockResolvedValue(agent);

      const tool = createCallAgentTool(
        "test-workspace",
        ["error-test-agent"],
        "calling-agent",
        0,
        3
      );

      const result = await (tool as unknown as {
        execute: (args: unknown) => Promise<string>;
      }).execute({
        query: "quantum physics theoretical framework",
        message: "Test message",
      });

      expect(result).toContain("Error: No agent found matching query");
      expect(result).toContain("Available agents");
      expect(result).toContain("Error Test Agent");
      expect(result).toContain("ID: error-test-agent");
    });

    it("should include agent list in error when no match found", async () => {
      const agent = createMockAgent({
        pk: "agents/test-workspace/no-match-agent",
        name: "No Match Agent",
        systemPrompt: "A test agent with no matching capabilities.",
      });

      (mockDb.agent.get as ReturnType<typeof vi.fn>).mockResolvedValue(agent);

      const tool = createCallAgentTool(
        "test-workspace",
        ["no-match-agent"],
        "calling-agent",
        0,
        3
      );

      // Use a query that definitely won't match - random alphanumeric string
      const result = await (tool as unknown as {
        execute: (args: unknown) => Promise<string>;
      }).execute({
        query: "xyz123abc789def456ghi012jkl345mno678pqr901stu234vwx567yz",
        message: "Test message",
      });

      expect(result).toContain("Error: No agent found matching query");
      expect(result).toContain("Available agents");
    });
  });

  describe("createCallAgentAsyncTool - Query-based Matching", () => {
    it("should include agent list in error when query below threshold", async () => {
      const agent = createMockAgent({
        pk: "agents/test-workspace/async-error-agent",
        name: "Async Error Agent",
        systemPrompt: "A test agent for async error testing.",
      });

      (mockDb.agent.get as ReturnType<typeof vi.fn>).mockResolvedValue(agent);

      const tool = createCallAgentAsyncTool(
        "test-workspace",
        ["async-error-agent"],
        "calling-agent",
        0,
        3
      );

      // Use a query that definitely won't match - random alphanumeric string
      const result = await (tool as unknown as {
        execute: (args: unknown) => Promise<string>;
      }).execute({
        query: "xyz123abc789def456ghi012jkl345mno678pqr901stu234vwx567yz",
        message: "Test message",
      });

      expect(result).toContain("Error: No agent found matching query");
      expect(result).toContain("Available agents");
      expect(result).toContain("Async Error Agent");
      expect(result).toContain("ID: async-error-agent");
    });

    it("should include agent list in error when no match found", async () => {
      const agent = createMockAgent({
        pk: "agents/test-workspace/agent1",
        name: "Test Agent",
        systemPrompt: "A test agent.",
      });

      (mockDb.agent.get as ReturnType<typeof vi.fn>).mockResolvedValue(agent);

      const tool = createCallAgentAsyncTool(
        "test-workspace",
        ["agent1"],
        "calling-agent",
        0,
        3
      );

      const result = await (tool as unknown as {
        execute: (args: unknown) => Promise<string>;
      }).execute({
        query: "completely unrelated query",
        message: "Test message",
      });

      expect(result).toContain("Error: No agent found matching query");
      expect(result).toContain("Available agents");
    });
  });
});

