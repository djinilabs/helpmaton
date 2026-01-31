import { generateText } from "ai";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Import after mocks are set up
import type { UIMessage } from "../../../utils/messageTypes";
import type { SubscriptionPlan } from "../../subscriptionPlans";
import type { FactRecord, TemporalGrain } from "../../vectordb/types";
import type { AugmentedContext } from "../../workspaceCreditContext";
import { calculateRetentionCutoff } from "../retentionPolicies";
import { searchMemory } from "../searchMemory";
import { summarizeWithLLM } from "../summarizeMemory";
import { formatTimeForGrain } from "../timeFormats";
import { writeToWorkingMemory, queueMemoryWrite } from "../writeMemory";

// Mock dependencies using vi.hoisted
const {
  mockGenerateEmbedding,
  mockGenerateEmbeddingWithUsage,
  mockResolveEmbeddingApiKey,
  mockSendWriteOperation,
  mockQuery,
  mockGetWorkspaceApiKey,
  mockCreateModel,
  mockValidateCreditsAndLimitsAndReserve,
  mockAdjustCreditsAfterLLMCall,
  mockCleanupReservationOnError,
  mockCleanupReservationWithoutTokenUsage,
  mockEnqueueCostVerificationIfNeeded,
  mockExtractTokenUsageAndCosts,
  mockDatabase,
} = vi.hoisted(() => {
  return {
    mockGenerateEmbedding: vi.fn(),
    mockGenerateEmbeddingWithUsage: vi.fn(),
    mockResolveEmbeddingApiKey: vi.fn(),
    mockSendWriteOperation: vi.fn(),
    mockQuery: vi.fn(),
    mockGetWorkspaceApiKey: vi.fn(),
    mockCreateModel: vi.fn(),
    mockValidateCreditsAndLimitsAndReserve: vi.fn(),
    mockAdjustCreditsAfterLLMCall: vi.fn(),
    mockCleanupReservationOnError: vi.fn(),
    mockCleanupReservationWithoutTokenUsage: vi.fn(),
    mockEnqueueCostVerificationIfNeeded: vi.fn(),
    mockExtractTokenUsageAndCosts: vi.fn(),
    mockDatabase: vi.fn(),
  };
});

// Mock modules
vi.mock("../../../http/utils/agentUtils", () => ({
  getWorkspaceApiKey: mockGetWorkspaceApiKey,
}));

vi.mock("../../../http/utils/agent-keys", () => ({
  getWorkspaceApiKey: mockGetWorkspaceApiKey,
}));

vi.mock("../../embedding", () => ({
  generateEmbedding: mockGenerateEmbedding,
  generateEmbeddingWithUsage: mockGenerateEmbeddingWithUsage,
  resolveEmbeddingApiKey: mockResolveEmbeddingApiKey,
}));

vi.mock("../../vectordb/queueClient", () => ({
  sendWriteOperation: mockSendWriteOperation,
}));

vi.mock("../../vectordb/readClient", () => ({
  query: mockQuery,
}));

vi.mock("../../vectordb/config", () => ({
  getS3BucketName: () => "test-bucket",
  DEFAULT_S3_REGION: "eu-west-2",
  MAX_QUERY_LIMIT: 1000,
  getS3ConnectionOptions: vi.fn().mockReturnValue({
    region: "eu-west-2",
  }),
}));

vi.mock("../../../http/utils/modelFactory", () => ({
  createModel: mockCreateModel,
  getDefaultModel: () => "google/gemini-2.5-flash",
}));

vi.mock("ai", async () => {
  const actual = await vi.importActual("ai");
  return {
    ...actual,
    generateText: vi.fn(),
  };
});

vi.mock("../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../http/utils/generationCreditManagement", () => ({
  adjustCreditsAfterLLMCall: mockAdjustCreditsAfterLLMCall,
  cleanupReservationOnError: mockCleanupReservationOnError,
  cleanupReservationWithoutTokenUsage: mockCleanupReservationWithoutTokenUsage,
  enqueueCostVerificationIfNeeded: mockEnqueueCostVerificationIfNeeded,
}));

vi.mock("../../../http/utils/generationTokenExtraction", () => ({
  extractTokenUsageAndCosts: mockExtractTokenUsageAndCosts,
}));

vi.mock("../../creditValidation", () => ({
  validateCreditsAndLimitsAndReserve: mockValidateCreditsAndLimitsAndReserve,
}));

describe("Memory System Integration", () => {
  const agentId = "test-agent-123";
  const workspaceId = "test-workspace-456";
  const subscriptionPlan: SubscriptionPlan = "pro";

  // In-memory storage for each grain, organized by time string
  const memoryStorage: Record<TemporalGrain, Map<string, FactRecord[]>> = {
    working: new Map(),
    daily: new Map(),
    weekly: new Map(),
    monthly: new Map(),
    quarterly: new Map(),
    yearly: new Map(),
    docs: new Map(), // Documents grain (not used in memory system, but required for type)
  };

  // Track all SQS operations for verification
  const sqsOperations: Array<{
    operation: string;
    agentId: string;
    grain: TemporalGrain;
    records?: FactRecord[];
    recordIds?: string[];
  }> = [];

  // Helper to get all records for a grain
  function getAllRecordsForGrain(grain: TemporalGrain): FactRecord[] {
    return Array.from(memoryStorage[grain].values()).flat();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Set environment variable for API key
    process.env.OPENROUTER_API_KEY = "test-api-key";

    // Clear storage
    Object.values(memoryStorage).forEach((map) => map.clear());
    sqsOperations.length = 0;

    // Mock workspace API key
    mockGetWorkspaceApiKey.mockResolvedValue(null);
    mockResolveEmbeddingApiKey.mockResolvedValue({
      apiKey: "test-api-key",
      usesByok: false,
    });

    mockDatabase.mockResolvedValue({});
    mockValidateCreditsAndLimitsAndReserve.mockResolvedValue(null);
    mockExtractTokenUsageAndCosts.mockReturnValue({
      tokenUsage: undefined,
      openrouterGenerationId: undefined,
      openrouterGenerationIds: [],
      provisionalCostUsd: undefined,
    });

    // Mock model creation
    mockCreateModel.mockResolvedValue({
      // Mock model object
    });

    // Mock embedding generation - return deterministic embeddings
    mockGenerateEmbedding.mockImplementation(async (text: string) => {
      // Generate a simple deterministic embedding based on text hash
      const hash = text
        .split("")
        .reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const embedding = Array.from({ length: 768 }, (_, i) => {
        return ((hash + i) % 100) / 1000; // Simple deterministic embedding
      });
      return Promise.resolve(embedding);
    });

    mockGenerateEmbeddingWithUsage.mockImplementation(async (text: string) => {
      const embedding = await mockGenerateEmbedding(text);
      return {
        embedding,
        usage: {
          promptTokens: 10,
          totalTokens: 10,
          cost: 0.000001,
        },
        id: `embedding-${text.length}`,
        fromCache: false,
      };
    });

    // Mock SQS write operation - store in memory
    // For rawFacts, generate embeddings (simulated)
    mockSendWriteOperation.mockImplementation(
      async (message: {
        operation: string;
        agentId: string;
        temporalGrain: TemporalGrain;
        workspaceId?: string;
        data: {
          records?: FactRecord[];
          rawFacts?: Array<{
            id: string;
            content: string;
            timestamp: string;
            metadata?: Record<string, unknown>;
            cacheKey?: string;
          }>;
          recordIds?: string[];
        };
      }) => {
        sqsOperations.push({
          operation: message.operation,
          agentId: message.agentId,
          grain: message.temporalGrain,
          records: message.data.records,
          recordIds: message.data.recordIds,
        });

        if (message.operation === "insert" || message.operation === "update") {
          let recordsToStore: FactRecord[] = [];

          // If rawFacts are provided, generate embeddings for them
          if (message.data.rawFacts && message.data.rawFacts.length > 0) {
            for (const rawFact of message.data.rawFacts) {
              // Generate embedding using the mock
              const embedding = await mockGenerateEmbedding(rawFact.content);
              recordsToStore.push({
                id: rawFact.id,
                content: rawFact.content,
                embedding,
                timestamp: rawFact.timestamp,
                metadata: rawFact.metadata,
              });
            }
          } else if (message.data.records) {
            // Use pre-generated records
            recordsToStore = message.data.records;
          }

          // Store records in memory
          for (const record of recordsToStore) {
            const timeKey =
              message.temporalGrain === "working"
                ? "global"
                : (record.metadata?.timeString as string) || "default";

            if (!memoryStorage[message.temporalGrain].has(timeKey)) {
              memoryStorage[message.temporalGrain].set(timeKey, []);
            }

            const existing =
              memoryStorage[message.temporalGrain].get(timeKey) || [];
            const filtered =
              message.operation === "update"
                ? existing.filter((item) => item.id !== record.id)
                : existing;
            // Create a new array to avoid reference issues
            const updated = [...filtered, record];
            memoryStorage[message.temporalGrain].set(timeKey, updated);
          }
        } else if (message.operation === "delete" && message.data.recordIds) {
          // Delete records by ID
          for (const [timeKey, records] of memoryStorage[
            message.temporalGrain
          ].entries()) {
            const filtered = records.filter(
              (r: FactRecord) => !message.data.recordIds!.includes(r.id),
            );
            if (filtered.length > 0) {
              memoryStorage[message.temporalGrain].set(timeKey, filtered);
            } else {
              memoryStorage[message.temporalGrain].delete(timeKey);
            }
          }
        }
      },
    );

    // Mock vector DB query - return records from memory storage
    mockQuery.mockImplementation(
      async (
        queryAgentId: string,
        grain: TemporalGrain,
        options?: {
          limit?: number;
          temporalFilter?: { startDate?: string; endDate?: string };
          vector?: number[];
        },
      ) => {
        if (queryAgentId !== agentId) {
          return [];
        }

        // Get all records for this grain
        const allRecords: FactRecord[] = [];
        for (const records of memoryStorage[grain].values()) {
          allRecords.push(...records);
        }

        // Apply temporal filter if provided
        let filtered = allRecords;
        if (options?.temporalFilter) {
          const { startDate, endDate } = options.temporalFilter;
          filtered = allRecords.filter((record) => {
            const timestamp = new Date(record.timestamp);
            if (startDate && timestamp < new Date(startDate)) {
              return false;
            }
            if (endDate && timestamp > new Date(endDate)) {
              return false;
            }
            return true;
          });
        }

        // Apply limit
        const limit = options?.limit || 100;
        return filtered.slice(0, limit);
      },
    );

    // Mock LLM summarization - create realistic summaries that preserve key information
    vi.mocked(generateText).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generateText has complex types
      async (params: any) => {
        const system = (params.system as string) || "";
        const messages =
          (params.messages as Array<{ role: string; content: string }>) || [];
        // Return immediately (no actual async delay)
        const userMessage = messages.find(
          (m: { role: string; content: string }) => m.role === "user",
        );
        const content = (userMessage?.content as string) || "";

        // Extract key information from content
        const lines = content.split("\n\n---\n\n");
        const facts: string[] = [];
        const people: Set<string> = new Set();
        const events: string[] = [];

        // Extract important facts, people, and events
        for (const line of lines) {
          const lowerLine = line.toLowerCase();
          // Extract people names (simple heuristic)
          if (
            lowerLine.includes("john") ||
            lowerLine.includes("sarah") ||
            lowerLine.includes("alice") ||
            lowerLine.includes("bob")
          ) {
            if (lowerLine.includes("john")) people.add("John");
            if (lowerLine.includes("sarah")) people.add("Sarah");
            if (lowerLine.includes("alice")) people.add("Alice");
            if (lowerLine.includes("bob")) people.add("Bob");
          }

          // Extract events
          if (
            lowerLine.includes("meeting") ||
            lowerLine.includes("discussion") ||
            lowerLine.includes("project")
          ) {
            if (lowerLine.includes("meeting")) events.push("meeting");
            if (lowerLine.includes("discussion")) events.push("discussion");
            if (lowerLine.includes("project")) events.push("project work");
          }

          if (line.includes("User said:") || line.includes("Assistant said:")) {
            const fact = line
              .replace(/User said: /, "")
              .replace(/Assistant said: /, "")
              .trim();
            if (fact.length > 0) {
              facts.push(fact);
            }
          }
        }

        // Create summary based on grain type with progressive abstraction
        // Check system prompt for grain type keywords (check in order from most specific to least)
        const systemLower = system.toLowerCase();

        // Check for specific phrases that uniquely identify each grain type
        // Order matters - check most specific first
        if (systemLower.includes("year's worth of quarterly summaries")) {
          return {
            text: `Yearly Summary: Comprehensive overview of ${facts.length} events throughout the year. Major achievements, team growth, and significant project milestones.`,
          } as Awaited<ReturnType<typeof generateText>>;
        } else if (
          systemLower.includes("quarter's worth of monthly summaries")
        ) {
          return {
            text: `Quarterly Summary: High-level overview of ${facts.length} events. Major themes: team collaboration, project development, and knowledge sharing. Key milestones achieved.`,
          } as Awaited<ReturnType<typeof generateText>>;
        } else if (systemLower.includes("month's worth of weekly summaries")) {
          return {
            text: `Monthly Summary: Overview of ${
              facts.length
            } events throughout the month. Key patterns: ${
              events.join(", ") || "consistent collaboration"
            }. Active participants: ${
              Array.from(people).join(", ") || "team"
            }. Notable achievements and ongoing projects.`,
          } as Awaited<ReturnType<typeof generateText>>;
        } else if (systemLower.includes("week's worth of daily summaries")) {
          return {
            text: `Weekly Summary: ${
              facts.length
            } significant interactions across the week. Major themes: ${
              events.join(", ") || "collaboration and development"
            }. Key participants: ${
              Array.from(people).join(", ") || "team members"
            }. Notable progress on project milestones.`,
          } as Awaited<ReturnType<typeof generateText>>;
        } else if (systemLower.includes("daily events from working memory")) {
          // Default to daily summary
          const peopleList = Array.from(people).join(", ");
          return {
            text: `Daily Summary (${
              facts.length
            } interactions): Key events included ${
              events.slice(0, 3).join(", ") || "various activities"
            }. Important people: ${
              peopleList || "team members"
            }. Main topics: ${
              facts.slice(0, 3).join("; ") || "general discussion"
            }.`,
          } as Awaited<ReturnType<typeof generateText>>;
        } else {
          // Fallback: default to daily summary
          const peopleList = Array.from(people).join(", ");
          return {
            text: `Daily Summary (${
              facts.length
            } interactions): Key events included ${
              events.slice(0, 3).join(", ") || "various activities"
            }. Important people: ${
              peopleList || "team members"
            }. Main topics: ${
              facts.slice(0, 3).join("; ") || "general discussion"
            }.`,
          } as Awaited<ReturnType<typeof generateText>>;
        }
      },
    );
  });

  it("charges memory extraction with reservation and verification", async () => {
    const context = {
      addWorkspaceCreditTransaction: vi.fn(),
    } as unknown as AugmentedContext;
    const mockText = JSON.stringify({
      summary: "Summary text",
      memory_operations: [],
    });
    vi.mocked(generateText).mockResolvedValue({
      text: mockText,
    } as Awaited<ReturnType<typeof generateText>>);
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

    await writeToWorkingMemory(
      agentId,
      workspaceId,
      "conv-memory-charge",
      [
        {
          role: "user",
          content: "Hello, I'm John.",
        },
      ],
      { enabled: true, modelName: "openrouter/gemini", prompt: null },
      context,
    );

    expect(mockValidateCreditsAndLimitsAndReserve).toHaveBeenCalled();
    expect(mockAdjustCreditsAfterLLMCall).toHaveBeenCalled();
    expect(mockEnqueueCostVerificationIfNeeded).toHaveBeenCalled();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should simulate complete memory lifecycle: conversations → working → day → week → month → quarter → year with retention", async () => {
    // ============================================
    // PHASE 1: Initial Conversations (Week 1)
    // ============================================
    const week1Start = new Date("2024-01-15T10:00:00Z"); // Monday, Jan 15
    vi.setSystemTime(week1Start);

    // Day 1 conversations
    const day1Conversations: Array<{ id: string; messages: UIMessage[] }> = [
      {
        id: "conv-day1-1",
        messages: [
          {
            role: "user",
            content: "Hello, I'm John. I need help with my React project.",
          },
          {
            role: "assistant",
            content:
              "Hi John! I'd be happy to help with your React project. What specific aspect do you need assistance with?",
          },
          {
            role: "user",
            content: "I'm having trouble with state management using hooks.",
          },
          {
            role: "assistant",
            content:
              "State management with hooks can be tricky. Are you using useState, useReducer, or a state management library?",
          },
        ],
      },
      {
        id: "conv-day1-2",
        messages: [
          {
            role: "user",
            content: "I met with Sarah today to discuss the project timeline.",
          },
          {
            role: "assistant",
            content:
              "That sounds productive! What did you and Sarah decide about the timeline?",
          },
        ],
      },
    ];

    // Write conversations to working memory
    for (const conv of day1Conversations) {
      await writeToWorkingMemory(agentId, workspaceId, conv.id, conv.messages);
    }

    // Verify working memory
    const workingRecordsAfterDay1 = getAllRecordsForGrain("working");
    expect(workingRecordsAfterDay1.length).toBeGreaterThan(0);
    expect(
      workingRecordsAfterDay1.some((r: FactRecord) =>
        r.content.includes("John"),
      ),
    ).toBe(true);
    expect(
      workingRecordsAfterDay1.some((r: FactRecord) =>
        r.content.includes("Sarah"),
      ),
    ).toBe(true);

    // Day 2 conversations
    vi.setSystemTime(new Date("2024-01-16T14:00:00Z"));
    const day2Conversations: Array<{ id: string; messages: UIMessage[] }> = [
      {
        id: "conv-day2-1",
        messages: [
          {
            role: "user",
            content: "Sarah and I finalized the project requirements.",
          },
          {
            role: "assistant",
            content:
              "Great! Having clear requirements is essential. What are the main features you'll be building?",
          },
        ],
      },
    ];

    for (const conv of day2Conversations) {
      await writeToWorkingMemory(agentId, workspaceId, conv.id, conv.messages);
    }

    // Day 3-7: Add more conversations to build up a week
    for (let day = 3; day <= 7; day++) {
      vi.setSystemTime(new Date(`2024-01-${14 + day}T10:00:00Z`));
      const conv: UIMessage[] = [
        {
          role: "user",
          content: `Day ${day}: Continued work on the React project. Discussed with team members.`,
        },
        {
          role: "assistant",
          content: `That's great progress! Keep up the good work on day ${day}.`,
        },
      ];
      await writeToWorkingMemory(
        agentId,
        workspaceId,
        `conv-day${day}-1`,
        conv,
      );
    }

    // ============================================
    // PHASE 2: Daily Summarization (End of Week 1)
    // ============================================
    // Advance to Day 8 (start of Week 2) to trigger daily summarization
    vi.setSystemTime(new Date("2024-01-22T00:00:00Z"));

    // Summarize Day 1 working memory into day summary
    const day1WorkingMemory = await mockQuery(agentId, "working", {
      limit: 1000,
      temporalFilter: {
        startDate: new Date("2024-01-15T00:00:00Z").toISOString(),
        endDate: new Date("2024-01-15T23:59:59Z").toISOString(),
      },
    });

    expect(day1WorkingMemory.length).toBeGreaterThan(0);

    const day1Content = day1WorkingMemory.map((r: FactRecord) => r.content);
    const day1Summary = await summarizeWithLLM(
      day1Content,
      "daily",
      workspaceId,
      agentId,
    );

    expect(day1Summary).toContain("Daily Summary");
    expect(day1Summary).toContain("John");
    expect(day1Summary).toContain("Sarah");

    // Create day summary record
    const day1Embedding = await mockGenerateEmbedding(day1Summary);
    const day1TimeString = formatTimeForGrain("daily", new Date("2024-01-15"));
    const day1Record: FactRecord = {
      id: `day-${day1TimeString}-summary`,
      content: day1Summary,
      embedding: day1Embedding,
      timestamp: new Date("2024-01-15T12:00:00Z").toISOString(),
      metadata: {
        agentId,
        workspaceId,
        grain: "daily",
        timeString: day1TimeString,
      },
    };

    await queueMemoryWrite(agentId, "daily", [day1Record]);

    // Verify day summary was created
    const dayRecords = getAllRecordsForGrain("daily");
    expect(dayRecords.length).toBeGreaterThan(0);
    expect(dayRecords[0].content).toContain("Daily Summary");

    // Create summaries for days 2-7 (simulated)
    for (let day = 2; day <= 7; day++) {
      const dayDate = new Date(`2024-01-${14 + day}T12:00:00Z`);
      const dayTimeString = formatTimeForGrain("daily", dayDate);
      const dayEmbedding = await mockGenerateEmbedding(
        `Daily Summary: Day ${day} activities`,
      );
      const dayRecord: FactRecord = {
        id: `day-${dayTimeString}-summary`,
        content: `Daily Summary: Day ${day} activities included project work, discussions with team members, and feature development.`,
        embedding: dayEmbedding,
        timestamp: dayDate.toISOString(),
        metadata: {
          agentId,
          workspaceId,
          grain: "daily",
          timeString: dayTimeString,
        },
      };
      await queueMemoryWrite(agentId, "daily", [dayRecord]);
    }

    // ============================================
    // PHASE 3: Weekly Summarization (End of Week 2)
    // ============================================
    vi.setSystemTime(new Date("2024-01-22T00:00:00Z")); // Start of Week 2

    // Get all daily summaries from Week 1
    const week1DailySummaries = await mockQuery(agentId, "daily", {
      limit: 1000,
      temporalFilter: {
        startDate: new Date("2024-01-15T00:00:00Z").toISOString(),
        endDate: new Date("2024-01-21T23:59:59Z").toISOString(),
      },
    });

    expect(week1DailySummaries.length).toBeGreaterThanOrEqual(7);

    const week1Content = week1DailySummaries.map((r: FactRecord) => r.content);
    const week1Summary = await summarizeWithLLM(
      week1Content,
      "weekly",
      workspaceId,
      agentId,
    );

    expect(week1Summary).toContain("Weekly Summary");
    expect(week1Summary).toContain("John");
    expect(week1Summary).toContain("Sarah");

    const week1Embedding = await mockGenerateEmbedding(week1Summary);
    const week1TimeString = formatTimeForGrain(
      "weekly",
      new Date("2024-01-15"),
    );
    const week1Record: FactRecord = {
      id: `week-${week1TimeString}-summary`,
      content: week1Summary,
      embedding: week1Embedding,
      timestamp: new Date("2024-01-18T12:00:00Z").toISOString(),
      metadata: {
        agentId,
        workspaceId,
        grain: "weekly",
        timeString: week1TimeString,
      },
    };

    await queueMemoryWrite(agentId, "weekly", [week1Record]);

    // Verify weekly summary was created
    const weekRecords = getAllRecordsForGrain("weekly");
    expect(weekRecords.length).toBeGreaterThan(0);
    expect(weekRecords[0].content).toContain("Weekly Summary");

    // ============================================
    // PHASE 4: Monthly Summarization (End of Month 1)
    // ============================================
    // Create additional weekly summaries for the month (simulated)
    for (let week = 2; week <= 4; week++) {
      const weekStartDate = new Date(2024, 0, 15 + (week - 1) * 7 + 1); // January, day calculation
      const weekTimeString = formatTimeForGrain("weekly", weekStartDate);
      const weekEmbedding = await mockGenerateEmbedding(
        `Weekly Summary: Week ${week}`,
      );
      const weekMidDate = new Date(2024, 0, 15 + (week - 1) * 7 + 3); // Mid-week date
      const weekRecord: FactRecord = {
        id: `week-${weekTimeString}-summary`,
        content: `Weekly Summary: Week ${week} activities included continued project development and team collaboration.`,
        embedding: weekEmbedding,
        timestamp: weekMidDate.toISOString(),
        metadata: {
          agentId,
          workspaceId,
          grain: "weekly",
          timeString: weekTimeString,
        },
      };
      await queueMemoryWrite(agentId, "weekly", [weekRecord]);
    }

    // Advance to start of Month 2
    vi.setSystemTime(new Date("2024-02-01T00:00:00Z"));

    // Get all weekly summaries from January
    const januaryWeeklySummaries = await mockQuery(agentId, "weekly", {
      limit: 1000,
      temporalFilter: {
        startDate: new Date("2024-01-01T00:00:00Z").toISOString(),
        endDate: new Date("2024-01-31T23:59:59Z").toISOString(),
      },
    });

    expect(januaryWeeklySummaries.length).toBeGreaterThan(0);

    const monthContent = januaryWeeklySummaries.map(
      (r: FactRecord) => r.content,
    );
    const monthSummary = await summarizeWithLLM(
      monthContent,
      "monthly",
      workspaceId,
      agentId,
    );

    expect(monthSummary).toContain("Monthly Summary");

    const monthEmbedding = await mockGenerateEmbedding(monthSummary);
    const monthTimeString = formatTimeForGrain(
      "monthly",
      new Date("2024-01-01"),
    );
    const monthRecord: FactRecord = {
      id: `month-${monthTimeString}-summary`,
      content: monthSummary,
      embedding: monthEmbedding,
      timestamp: new Date("2024-01-15T12:00:00Z").toISOString(),
      metadata: {
        agentId,
        workspaceId,
        grain: "monthly",
        timeString: monthTimeString,
      },
    };

    await queueMemoryWrite(agentId, "monthly", [monthRecord]);

    // Verify monthly summary was created
    const monthRecords = getAllRecordsForGrain("monthly");
    expect(monthRecords.length).toBeGreaterThan(0);
    expect(monthRecords[0].content).toContain("Monthly Summary");

    // ============================================
    // PHASE 5: Quarterly Summarization (End of Q1)
    // ============================================
    // Create additional monthly summaries for Q1 (simulated)
    for (let month = 2; month <= 3; month++) {
      const monthDate = new Date(2024, month - 1, 1); // month is 1-indexed, Date month is 0-indexed
      const monthTimeString = formatTimeForGrain("monthly", monthDate);
      const monthEmbedding = await mockGenerateEmbedding(
        `Monthly Summary: Month ${month}`,
      );
      const monthMidDate = new Date(2024, month - 1, 15);
      const monthRecord: FactRecord = {
        id: `month-${monthTimeString}-summary`,
        content: `Monthly Summary: Month ${month} activities included project milestones and team growth.`,
        embedding: monthEmbedding,
        timestamp: monthMidDate.toISOString(),
        metadata: {
          agentId,
          workspaceId,
          grain: "monthly",
          timeString: monthTimeString,
        },
      };
      await queueMemoryWrite(agentId, "monthly", [monthRecord]);
    }

    // Advance to start of Q2
    vi.setSystemTime(new Date("2024-04-01T00:00:00Z"));

    // Get all monthly summaries from Q1
    const q1MonthlySummaries = await mockQuery(agentId, "monthly", {
      limit: 1000,
      temporalFilter: {
        startDate: new Date("2024-01-01T00:00:00Z").toISOString(),
        endDate: new Date("2024-03-31T23:59:59Z").toISOString(),
      },
    });

    expect(q1MonthlySummaries.length).toBeGreaterThan(0);

    const quarterContent = q1MonthlySummaries.map((r: FactRecord) => r.content);
    const quarterSummary = await summarizeWithLLM(
      quarterContent,
      "quarterly",
      workspaceId,
      agentId,
    );

    expect(quarterSummary).toContain("Quarterly Summary");

    const quarterEmbedding = await mockGenerateEmbedding(quarterSummary);
    const quarterTimeString = formatTimeForGrain(
      "quarterly",
      new Date("2024-01-01"),
    );
    const quarterRecord: FactRecord = {
      id: `quarter-${quarterTimeString}-summary`,
      content: quarterSummary,
      embedding: quarterEmbedding,
      timestamp: new Date("2024-02-15T12:00:00Z").toISOString(),
      metadata: {
        agentId,
        workspaceId,
        grain: "quarterly",
        timeString: quarterTimeString,
      },
    };

    await queueMemoryWrite(agentId, "quarterly", [quarterRecord]);

    // Verify quarterly summary was created
    const quarterRecords = getAllRecordsForGrain("quarterly");
    expect(quarterRecords.length).toBeGreaterThan(0);
    expect(quarterRecords[0].content).toContain("Quarterly Summary");

    // ============================================
    // PHASE 6: Yearly Summarization (End of Year)
    // ============================================
    // Create additional quarterly summaries for the year (simulated)
    for (let quarter = 2; quarter <= 4; quarter++) {
      const quarterMonth = (quarter - 1) * 3; // 0-indexed month
      const quarterDate = new Date(2024, quarterMonth, 1);
      const quarterTimeString = formatTimeForGrain("quarterly", quarterDate);
      const quarterEmbedding = await mockGenerateEmbedding(
        `Quarterly Summary: Q${quarter}`,
      );
      const quarterMidDate = new Date(2024, quarterMonth + 1, 15); // Mid-quarter
      const quarterRecord: FactRecord = {
        id: `quarter-${quarterTimeString}-summary`,
        content: `Quarterly Summary: Q${quarter} achievements and milestones.`,
        embedding: quarterEmbedding,
        timestamp: quarterMidDate.toISOString(),
        metadata: {
          agentId,
          workspaceId,
          grain: "quarterly",
          timeString: quarterTimeString,
        },
      };
      await queueMemoryWrite(agentId, "quarterly", [quarterRecord]);
    }

    // Advance to start of next year
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));

    // Get all quarterly summaries from 2024
    const year2024QuarterlySummaries = await mockQuery(agentId, "quarterly", {
      limit: 1000,
      temporalFilter: {
        startDate: new Date("2024-01-01T00:00:00Z").toISOString(),
        endDate: new Date("2024-12-31T23:59:59Z").toISOString(),
      },
    });

    expect(year2024QuarterlySummaries.length).toBeGreaterThan(0);

    const yearContent = year2024QuarterlySummaries.map(
      (r: FactRecord) => r.content,
    );
    const yearSummary = await summarizeWithLLM(
      yearContent,
      "yearly",
      workspaceId,
      agentId,
    );

    expect(yearSummary).toContain("Yearly Summary");

    const yearEmbedding = await mockGenerateEmbedding(yearSummary);
    const yearTimeString = formatTimeForGrain("yearly", new Date("2024-01-01"));
    const yearRecord: FactRecord = {
      id: `year-${yearTimeString}-summary`,
      content: yearSummary,
      embedding: yearEmbedding,
      timestamp: new Date("2024-06-15T12:00:00Z").toISOString(),
      metadata: {
        agentId,
        workspaceId,
        grain: "yearly",
        timeString: yearTimeString,
      },
    };

    await queueMemoryWrite(agentId, "yearly", [yearRecord]);

    // Verify yearly summary was created
    const yearRecords = getAllRecordsForGrain("yearly");
    expect(yearRecords.length).toBeGreaterThan(0);
    expect(yearRecords[0].content).toContain("Yearly Summary");

    // ============================================
    // PHASE 7: Memory Search Across All Grains
    // ============================================
    vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));

    // Search working memory
    const workingSearchResults = await searchMemory({
      agentId,
      workspaceId,
      grain: "working",
      minimumDaysAgo: 0,
      maximumDaysAgo: 180,
      maxResults: 10,
    });

    expect(workingSearchResults.length).toBeGreaterThan(0);
    expect(workingSearchResults[0].content).toBeTruthy();
    expect(workingSearchResults[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Search daily summaries
    const dailySearchResults = await searchMemory({
      agentId,
      workspaceId,
      grain: "daily",
      minimumDaysAgo: 0,
      maximumDaysAgo: 180,
      maxResults: 10,
    });

    expect(dailySearchResults.length).toBeGreaterThan(0);
    expect(dailySearchResults[0].content).toContain("Daily Summary");

    // Search weekly summaries
    const weeklySearchResults = await searchMemory({
      agentId,
      workspaceId,
      grain: "weekly",
      minimumDaysAgo: 0,
      maximumDaysAgo: 180,
      maxResults: 10,
    });

    expect(weeklySearchResults.length).toBeGreaterThan(0);
    expect(weeklySearchResults[0].content).toContain("Weekly Summary");

    // ============================================
    // PHASE 8: Retention Policy Cleanup
    // ============================================
    vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));

    // Create some recent daily records that won't be deleted (within retention period)
    const recentDate1 = new Date("2024-05-20T12:00:00Z"); // 26 days ago (within 120 day retention)
    const recentDate2 = new Date("2024-06-10T12:00:00Z"); // 5 days ago
    const recentTimeString1 = formatTimeForGrain("daily", recentDate1);
    const recentTimeString2 = formatTimeForGrain("daily", recentDate2);

    const recentEmbedding1 = await mockGenerateEmbedding(
      "Recent daily summary 1",
    );
    const recentEmbedding2 = await mockGenerateEmbedding(
      "Recent daily summary 2",
    );

    const recentRecord1: FactRecord = {
      id: `day-${recentTimeString1}-recent`,
      content:
        "Daily Summary: Recent activities from May 20th. Continued work with John and Sarah on the React project.",
      embedding: recentEmbedding1,
      timestamp: recentDate1.toISOString(),
      metadata: {
        agentId,
        workspaceId,
        grain: "daily",
        timeString: recentTimeString1,
      },
    };

    const recentRecord2: FactRecord = {
      id: `day-${recentTimeString2}-recent`,
      content:
        "Daily Summary: Recent activities from June 10th. Team collaboration with John continued.",
      embedding: recentEmbedding2,
      timestamp: recentDate2.toISOString(),
      metadata: {
        agentId,
        workspaceId,
        grain: "daily",
        timeString: recentTimeString2,
      },
    };

    await queueMemoryWrite(agentId, "daily", [recentRecord1, recentRecord2]);

    // Calculate cutoff for daily grain with pro plan (120 days)
    const dailyCutoff = calculateRetentionCutoff("daily", subscriptionPlan);
    expect(dailyCutoff.getTime()).toBeLessThan(new Date().getTime());

    // Get all daily records
    const allDailyRecords = getAllRecordsForGrain("daily");

    // Filter records older than cutoff
    const recordsToDelete = allDailyRecords.filter((record) => {
      const recordDate = new Date(record.timestamp);
      return recordDate < dailyCutoff;
    });

    // Simulate deletion via SQS
    if (recordsToDelete.length > 0) {
      await mockSendWriteOperation({
        operation: "delete",
        agentId,
        temporalGrain: "daily",
        data: {
          recordIds: recordsToDelete.map((r: FactRecord) => r.id),
        },
      });
    }

    // Verify old records were deleted but recent ones remain
    const remainingDailyRecords = getAllRecordsForGrain("daily");
    expect(remainingDailyRecords.length).toBeGreaterThan(0); // Should have recent records
    for (const record of remainingDailyRecords) {
      const recordDate = new Date(record.timestamp);
      expect(recordDate.getTime()).toBeGreaterThanOrEqual(
        dailyCutoff.getTime(),
      );
    }

    // ============================================
    // PHASE 9: Verify Complete Memory Hierarchy
    // ============================================
    const finalWorkingCount = getAllRecordsForGrain("working").length;
    const finalDailyCount = getAllRecordsForGrain("daily").length;
    const finalWeeklyCount = getAllRecordsForGrain("weekly").length;
    const finalMonthlyCount = getAllRecordsForGrain("monthly").length;
    const finalQuarterlyCount = getAllRecordsForGrain("quarterly").length;
    const finalYearlyCount = getAllRecordsForGrain("yearly").length;

    // Verify all grains have records
    expect(finalWorkingCount).toBeGreaterThan(0);
    expect(finalDailyCount).toBeGreaterThan(0);
    expect(finalWeeklyCount).toBeGreaterThan(0);
    expect(finalMonthlyCount).toBeGreaterThan(0);
    expect(finalQuarterlyCount).toBeGreaterThan(0);
    expect(finalYearlyCount).toBeGreaterThan(0);

    // Verify summaries reference correct grain
    const allWeeklySummaries = getAllRecordsForGrain("weekly");
    expect(
      allWeeklySummaries.every(
        (r: FactRecord) => r.metadata?.grain === "weekly",
      ),
    ).toBe(true);

    const allMonthlySummaries = getAllRecordsForGrain("monthly");
    expect(
      allMonthlySummaries.every(
        (r: FactRecord) => r.metadata?.grain === "monthly",
      ),
    ).toBe(true);

    const allQuarterlySummaries = getAllRecordsForGrain("quarterly");
    expect(
      allQuarterlySummaries.every(
        (r: FactRecord) => r.metadata?.grain === "quarterly",
      ),
    ).toBe(true);

    const allYearlySummaries = getAllRecordsForGrain("yearly");
    expect(
      allYearlySummaries.every(
        (r: FactRecord) => r.metadata?.grain === "yearly",
      ),
    ).toBe(true);

    // Verify that summaries preserve key information through the hierarchy
    // The original conversations mentioned "John" and "Sarah"
    // These should appear in daily and weekly summaries, but may be abstracted in higher levels
    const dailySummaries = getAllRecordsForGrain("daily");
    const hasJohnInDaily = dailySummaries.some((r: FactRecord) =>
      r.content.toLowerCase().includes("john"),
    );
    expect(hasJohnInDaily).toBe(true);

    const weeklySummaries = getAllRecordsForGrain("weekly");
    const hasJohnInWeekly = weeklySummaries.some((r: FactRecord) =>
      r.content.toLowerCase().includes("john"),
    );
    expect(hasJohnInWeekly).toBe(true);

    // Verify SQS operations were tracked
    expect(sqsOperations.length).toBeGreaterThan(0);
    const writeOperations = sqsOperations.filter(
      (op) => op.operation === "insert" || op.operation === "update",
    );
    expect(writeOperations.length).toBeGreaterThan(0);

    // Verify time strings are correctly formatted
    const dailyTimeStrings = dailySummaries.map(
      (r) => r.metadata?.timeString as string,
    );
    for (const timeString of dailyTimeStrings) {
      expect(timeString).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }

    const weeklyTimeStrings = weeklySummaries.map(
      (r) => r.metadata?.timeString as string,
    );
    for (const timeString of weeklyTimeStrings) {
      expect(timeString).toMatch(/^\d{4}-W\d+$/);
    }
  }, 120000); // 120 second timeout for comprehensive integration test

  it("should handle retention cleanup for different subscription plans correctly", async () => {
    const baseDate = new Date("2024-06-15T12:00:00Z");
    vi.setSystemTime(baseDate);

    // Create records with different ages
    const veryOldRecord: FactRecord = {
      id: "very-old",
      content: "Conversation from 200 days ago",
      embedding: [0.1, 0.2, 0.3],
      timestamp: new Date("2023-11-27T12:00:00Z").toISOString(), // 200 days ago
      metadata: {
        agentId,
        workspaceId,
        grain: "daily",
        timeString: "2023-11-27",
      },
    };

    const oldRecord: FactRecord = {
      id: "old",
      content: "Conversation from 50 days ago",
      embedding: [0.2, 0.3, 0.4],
      timestamp: new Date("2024-04-26T12:00:00Z").toISOString(), // 50 days ago
      metadata: {
        agentId,
        workspaceId,
        grain: "daily",
        timeString: "2024-04-26",
      },
    };

    const recentRecord: FactRecord = {
      id: "recent",
      content: "Conversation from 10 days ago",
      embedding: [0.3, 0.4, 0.5],
      timestamp: new Date("2024-06-05T12:00:00Z").toISOString(), // 10 days ago
      metadata: {
        agentId,
        workspaceId,
        grain: "daily",
        timeString: "2024-06-05",
      },
    };

    memoryStorage.daily.set("2023-11-27", [veryOldRecord]);
    memoryStorage.daily.set("2024-04-26", [oldRecord]);
    memoryStorage.daily.set("2024-06-05", [recentRecord]);

    // Test free plan retention (30 days)
    const freeCutoff = calculateRetentionCutoff("daily", "free");
    const freeRecords = getAllRecordsForGrain("daily");
    const freeRecordsToKeep = freeRecords.filter(
      (r) => new Date(r.timestamp) >= freeCutoff,
    );

    // Free plan: only recent record should be kept (30 days retention)
    expect(freeRecordsToKeep.length).toBe(1);
    expect(freeRecordsToKeep[0].id).toBe("recent");

    // Test starter plan retention (60 days)
    const starterCutoff = calculateRetentionCutoff("daily", "starter");
    const starterRecords = getAllRecordsForGrain("daily");
    const starterRecordsToKeep = starterRecords.filter(
      (r) => new Date(r.timestamp) >= starterCutoff,
    );

    // Starter plan: recent and old records should be kept (60 days retention)
    expect(starterRecordsToKeep.length).toBe(2);
    expect(starterRecordsToKeep.map((r: FactRecord) => r.id).sort()).toEqual([
      "old",
      "recent",
    ]);

    // Test pro plan retention (120 days)
    const proCutoff = calculateRetentionCutoff("daily", "pro");
    const proRecords = getAllRecordsForGrain("daily");
    const proRecordsToKeep = proRecords.filter(
      (r) => new Date(r.timestamp) >= proCutoff,
    );

    // Pro plan: recent and old records should be kept (120 days retention)
    // Very old record (200 days) is still too old even for pro plan
    expect(proRecordsToKeep.length).toBe(2);
    expect(proRecordsToKeep.map((r: FactRecord) => r.id).sort()).toEqual([
      "old",
      "recent",
    ]);
  });

  it("should search memory with semantic search across time ranges", async () => {
    const baseDate = new Date("2024-06-15T12:00:00Z");
    vi.setSystemTime(baseDate);

    // Create records in different grains with different content
    const dailyRecord: FactRecord = {
      id: "daily-search-1",
      content: "Daily summary: Discussed React project with John and Sarah",
      embedding: [0.1, 0.2, 0.3],
      timestamp: new Date("2024-06-10T12:00:00Z").toISOString(),
      metadata: {
        agentId,
        workspaceId,
        grain: "daily",
        timeString: "2024-06-10",
      },
    };

    const weeklyRecord: FactRecord = {
      id: "weekly-search-1",
      content:
        "Weekly summary: Team collaboration on React project throughout the week",
      embedding: [0.2, 0.3, 0.4],
      timestamp: new Date("2024-06-01T12:00:00Z").toISOString(),
      metadata: {
        agentId,
        workspaceId,
        grain: "weekly",
        timeString: "2024-W22",
      },
    };

    memoryStorage.daily.set("2024-06-10", [dailyRecord]);
    memoryStorage.weekly.set("2024-W22", [weeklyRecord]);

    // Search daily memory with time range
    const dailyResults = await searchMemory({
      agentId,
      workspaceId,
      grain: "daily",
      minimumDaysAgo: 0,
      maximumDaysAgo: 30,
      maxResults: 10,
    });

    expect(dailyResults.length).toBeGreaterThan(0);
    expect(dailyResults[0].content).toContain("Daily summary");
    expect(dailyResults[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Search weekly memory with time range
    const weeklyResults = await searchMemory({
      agentId,
      workspaceId,
      grain: "weekly",
      minimumDaysAgo: 0,
      maximumDaysAgo: 60,
      maxResults: 10,
    });

    expect(weeklyResults.length).toBeGreaterThan(0);
    expect(weeklyResults[0].content).toContain("Weekly summary");

    // Search with semantic query
    const semanticResults = await searchMemory({
      agentId,
      workspaceId,
      grain: "daily",
      minimumDaysAgo: 0,
      maximumDaysAgo: 30,
      maxResults: 10,
      queryText: "React project",
    });

    expect(semanticResults.length).toBeGreaterThan(0);
  }, 30000); // 30 second timeout
});
