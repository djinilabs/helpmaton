import { describe, it, expect, vi } from "vitest";

import type {
  AgentConversationRecord,
  WorkspaceCreditTransactionRecord,
 DatabaseSchema } from "../../tables/schema";
import {
  aggregateConversations,
  aggregateToolTransactionsStream,
  mergeUsageStats,
  queryToolAggregatesForDate,
} from "../aggregation";

/**
 * Minimal conversation record for aggregation tests.
 * aggregateConversations skips conversations without tokenUsage.
 */
function minimalConversation(overrides: Partial<AgentConversationRecord> = {}): AgentConversationRecord {
  return {
    pk: "conversations/ws-1/agent-1/conv-1",
    sk: "conversation",
    workspaceId: "ws-1",
    agentId: "agent-1",
    conversationId: "conv-1",
    conversationType: "stream",
    messages: [],
    tokenUsage: {
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
    },
    ...overrides,
  } as AgentConversationRecord;
}

describe("aggregateConversations", () => {
  it("does not add conversation costUsd to stats.costUsd (cost comes from transactions to avoid double-count)", () => {
    const conversations: AgentConversationRecord[] = [
      minimalConversation({
        costUsd: 1_000_000_000, // 1 USD in nano-dollars
        rerankingCostUsd: 0,
      }),
      minimalConversation({
        conversationId: "conv-2",
        pk: "conversations/ws-1/agent-1/conv-2",
        costUsd: 500_000_000, // 0.50 USD
        rerankingCostUsd: 0,
      }),
    ];

    const stats = aggregateConversations(conversations);

    // Text-generation cost must not be included; it comes from transactions.
    expect(stats.costUsd).toBe(0);
    expect(stats.costByType.textGeneration).toBe(0);
  });

  it("does not add conversation rerankingCostUsd (reranking comes from tool-execution transactions only)", () => {
    const conversations: AgentConversationRecord[] = [
      minimalConversation({
        costUsd: 1_000_000_000,
        rerankingCostUsd: 100_000_000, // 0.10 USD - stored on conv but not summed here
      }),
      minimalConversation({
        conversationId: "conv-2",
        pk: "conversations/ws-1/agent-1/conv-2",
        rerankingCostUsd: 50_000_000, // 0.05 USD
      }),
    ];

    const stats = aggregateConversations(conversations);

    // Reranking is aggregated from tool-execution (tool_call "rerank") transactions only.
    expect(stats.rerankingCostUsd).toBe(0);
  });

  it("still aggregates tokens, message counts, and conversation count", () => {
    const conversations: AgentConversationRecord[] = [
      minimalConversation({
        tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        messages: [{ role: "user" }, { role: "assistant" }],
      }),
      minimalConversation({
        conversationId: "conv-2",
        pk: "conversations/ws-1/agent-1/conv-2",
        tokenUsage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
        messages: [{ role: "user" }, { role: "assistant" }, { role: "user" }],
      }),
    ];

    const stats = aggregateConversations(conversations);

    expect(stats.inputTokens).toBe(30);
    expect(stats.outputTokens).toBe(15);
    expect(stats.totalTokens).toBe(45);
    expect(stats.conversationCount).toBe(2);
    // conv1: 1 user, 1 assistant; conv2: 2 user, 1 assistant
    expect(stats.messagesIn).toBe(3);
    expect(stats.messagesOut).toBe(2);
    expect(stats.totalMessages).toBe(5);
  });

  it("skips conversations without tokenUsage", () => {
    const withUsage = minimalConversation({
      tokenUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    const withoutUsage = minimalConversation({
      conversationId: "conv-no-usage",
      pk: "conversations/ws-1/agent-1/conv-no-usage",
      tokenUsage: undefined,
    });

    const stats = aggregateConversations([withUsage, withoutUsage]);

    expect(stats.conversationCount).toBe(2);
    expect(stats.inputTokens).toBe(1);
    expect(stats.outputTokens).toBe(1);
  });
});

describe("mergeUsageStats (no double-count)", () => {
  it("merged costUsd is sum of inputs; conversation costUsd=0 plus transaction costUsd yields no double-count", () => {
    const conversationStats = aggregateConversations([
      minimalConversation({
        costUsd: 2_000_000_000, // would have been 2 USD if we added it
        rerankingCostUsd: 100_000_000, // not added; reranking comes from tool stream
      }),
    ]);

    expect(conversationStats.costUsd).toBe(0);
    expect(conversationStats.rerankingCostUsd).toBe(0);

    const transactionStats = {
      ...conversationStats,
      costUsd: 2_000_000_000, // 2 USD from text-generation transactions
      rerankingCostUsd: 0,
    };

    const merged = mergeUsageStats(conversationStats, transactionStats);

    expect(merged.costUsd).toBe(2_000_000_000);
    expect(merged.rerankingCostUsd).toBe(0);
  });

  it("reranking comes from tool stream only; merge yields single reranking count (no double-count)", () => {
    const conversationStats = aggregateConversations([
      minimalConversation({
        costUsd: 0,
        rerankingCostUsd: 100_000_000, // on conv but not summed; tool stream is source
      }),
    ]);

    expect(conversationStats.rerankingCostUsd).toBe(0);

    const toolStats = {
      ...conversationStats,
      costUsd: 0,
      rerankingCostUsd: 100_000_000, // from aggregateToolTransactionsStream (rerank txns)
      costByType: { ...conversationStats.costByType, reranking: 100_000_000 },
      toolExpenses: {
        "rerank-openrouter": { costUsd: 100_000_000, callCount: 1 },
      },
    };

    const merged = mergeUsageStats(conversationStats, toolStats);

    expect(merged.rerankingCostUsd).toBe(100_000_000);
    expect(merged.costByType.reranking).toBe(100_000_000);
  });
});

async function* streamTransactions(
  items: WorkspaceCreditTransactionRecord[]
): AsyncGenerator<WorkspaceCreditTransactionRecord, void, unknown> {
  for (const t of items) {
    yield t;
  }
}

const baseTransaction = {
  pk: "workspaces/ws-1",
  sk: "transactions/txn-1",
  createdAt: new Date().toISOString(),
  source: "tool-execution" as const,
  amountNanoUsd: -50_000_000, // 0.05 USD debit
  supplier: "openrouter",
} as WorkspaceCreditTransactionRecord;

describe("aggregateToolTransactionsStream (reranking no double-count)", () => {
  it("puts rerank transaction cost in rerankingCostUsd and costByType.reranking, not in costUsd", async () => {
    const transactions = [
      {
        ...baseTransaction,
        tool_call: "rerank",
        amountNanoUsd: -100_000_000, // 0.10 USD
      },
    ] as WorkspaceCreditTransactionRecord[];

    const stats = await aggregateToolTransactionsStream(
      streamTransactions(transactions)
    );

    expect(stats.rerankingCostUsd).toBe(100_000_000);
    expect(stats.costByType.reranking).toBe(100_000_000);
    expect(stats.costUsd).toBe(0);
    expect(stats.toolExpenses["rerank-openrouter"]).toEqual({
      costUsd: 100_000_000,
      callCount: 1,
    });
  });

  it("puts non-rerank tool transaction cost in costUsd and toolExpenses", async () => {
    const transactions = [
      {
        ...baseTransaction,
        tool_call: "search_web",
        supplier: "tavily",
        amountNanoUsd: -30_000_000, // 0.03 USD
      },
    ] as WorkspaceCreditTransactionRecord[];

    const stats = await aggregateToolTransactionsStream(
      streamTransactions(transactions)
    );

    expect(stats.costUsd).toBe(30_000_000);
    expect(stats.rerankingCostUsd).toBe(0);
    expect(stats.costByType.tavily).toBe(30_000_000);
    expect(stats.toolExpenses["search_web-tavily"]).toEqual({
      costUsd: 30_000_000,
      callCount: 1,
    });
  });

  it("splits rerank and non-rerank tool costs correctly", async () => {
    const transactions = [
      {
        ...baseTransaction,
        sk: "transactions/txn-1",
        tool_call: "rerank",
        amountNanoUsd: -100_000_000,
      },
      {
        ...baseTransaction,
        sk: "transactions/txn-2",
        tool_call: "search_web",
        supplier: "tavily",
        amountNanoUsd: -20_000_000,
      },
    ] as WorkspaceCreditTransactionRecord[];

    const stats = await aggregateToolTransactionsStream(
      streamTransactions(transactions)
    );

    expect(stats.rerankingCostUsd).toBe(100_000_000);
    expect(stats.costUsd).toBe(20_000_000);
    expect(stats.costByType.reranking).toBe(100_000_000);
    expect(stats.costByType.tavily).toBe(20_000_000);
    expect(stats.toolExpenses["rerank-openrouter"].costUsd).toBe(100_000_000);
    expect(stats.toolExpenses["search_web-tavily"].costUsd).toBe(20_000_000);
  });
});

describe("queryToolAggregatesForDate (GSI fallback)", () => {
  it("uses GSI when available (single query, no fallback)", async () => {
    const gsiItems = [
      {
        pk: "tool-aggregates/ws-1/2020-01-01",
        sk: "search_web-tavily",
        date: "2020-01-01",
        aggregateType: "agent" as const,
        workspaceId: "ws-1",
        agentId: "agent-1",
        toolCall: "search_web",
        supplier: "tavily",
        costUsd: 10_000_000,
        callCount: 1,
      },
    ];
    const mockQuery = vi.fn().mockResolvedValue({ items: gsiItems });
    const db = {
      "tool-usage-aggregates": { query: mockQuery },
    } as unknown as DatabaseSchema;

    const result = await queryToolAggregatesForDate(db, {
      workspaceId: "ws-1",
      agentId: "agent-1",
      date: "2020-01-01",
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        IndexName: "byWorkspaceIdAndAgentId",
        ExpressionAttributeValues: {
          ":workspaceId": "ws-1",
          ":agentIdDate": "agent-1#2020-01-01",
        },
      }),
    );
    expect(result.costUsd).toBe(10_000_000);
    expect(result.toolExpenses["search_web-tavily"].callCount).toBe(1);
  });

  it("falls back to byWorkspaceIdAndDate + filter when byWorkspaceIdAndAgentId index is missing", async () => {
    const fallbackItems = [
      {
        pk: "tool-aggregates/ws-1/2020-01-01",
        sk: "search_web-tavily",
        date: "2020-01-01",
        aggregateType: "agent" as const,
        workspaceId: "ws-1",
        agentId: "agent-1",
        toolCall: "search_web",
        supplier: "tavily",
        costUsd: 50_000_000,
        callCount: 2,
      },
    ];
    let queryCallCount = 0;
    const mockQuery = vi.fn().mockImplementation((params: { IndexName?: string }) => {
      queryCallCount += 1;
      if (params.IndexName === "byWorkspaceIdAndAgentId") {
        throw new Error(
          "Error querying table tool-usage-aggregates: @aws-lite/client: DynamoDB.Query: The table does not have the specified index: byWorkspaceIdAndAgentId",
        );
      }
      if (params.IndexName === "byWorkspaceIdAndDate") {
        return Promise.resolve({ items: fallbackItems });
      }
      return Promise.resolve({ items: [] });
    });

    const db = {
      "tool-usage-aggregates": { query: mockQuery },
    } as unknown as DatabaseSchema;

    const result = await queryToolAggregatesForDate(db, {
      workspaceId: "ws-1",
      agentId: "agent-1",
      date: "2020-01-01",
    });

    expect(queryCallCount).toBe(2);
    expect(mockQuery).toHaveBeenNthCalledWith(1, expect.objectContaining({
      IndexName: "byWorkspaceIdAndAgentId",
      KeyConditionExpression: "workspaceId = :workspaceId AND agentIdDate = :agentIdDate",
      ExpressionAttributeValues: {
        ":workspaceId": "ws-1",
        ":agentIdDate": "agent-1#2020-01-01",
      },
    }));
    expect(mockQuery).toHaveBeenNthCalledWith(2, expect.objectContaining({
      IndexName: "byWorkspaceIdAndDate",
      KeyConditionExpression: "workspaceId = :workspaceId AND #date = :date",
      FilterExpression: "agentId = :agentId",
      ExpressionAttributeNames: { "#date": "date" },
      ExpressionAttributeValues: {
        ":workspaceId": "ws-1",
        ":date": "2020-01-01",
        ":agentId": "agent-1",
      },
    }));
    expect(result.costUsd).toBe(50_000_000);
    expect(result.toolExpenses["search_web-tavily"]).toEqual({
      costUsd: 50_000_000,
      callCount: 2,
    });
  });

  it("rethrows when query fails with a different error", async () => {
    const mockQuery = vi.fn().mockRejectedValue(new Error("Network error"));
    const db = {
      "tool-usage-aggregates": { query: mockQuery },
    } as unknown as DatabaseSchema;

    await expect(
      queryToolAggregatesForDate(db, {
        workspaceId: "ws-1",
        agentId: "agent-1",
        date: "2020-01-01",
      }),
    ).rejects.toThrow("Network error");
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
