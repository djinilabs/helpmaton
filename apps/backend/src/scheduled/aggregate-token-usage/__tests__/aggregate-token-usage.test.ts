import { describe, expect, it } from "vitest";

import type {
  AgentConversationRecord,
  WorkspaceCreditTransactionRecord,
} from "../../../tables/schema";
import {
  buildConversationAggregates,
  buildToolAggregates,
} from "../index";

describe("aggregate-token-usage helpers", () => {
  it("buildConversationAggregates collects counts and token totals", () => {
    const conversations = [
      {
        workspaceId: "workspace-1",
        agentId: "agent-1",
        conversationId: "conv-1",
        modelName: "openai/gpt-4o",
        provider: "openrouter",
        usesByok: false,
        tokenUsage: {
          promptTokens: 5,
          completionTokens: 7,
          totalTokens: 12,
        },
        messages: [
          { role: "user" },
          { role: "assistant" },
          { role: "assistant" },
        ],
      },
      {
        workspaceId: "workspace-1",
        agentId: "agent-1",
        conversationId: "conv-2",
        modelName: "openai/gpt-4o",
        provider: "openrouter",
        usesByok: true,
        tokenUsage: {
          promptTokens: 3,
          completionTokens: 4,
          totalTokens: 7,
        },
        messages: [{ role: "user" }],
      },
    ] as AgentConversationRecord[];

    const result = buildConversationAggregates(
      conversations,
      "2024-01-01"
    );

    expect(result.aggregates.size).toBe(2);
    const counts = result.conversationCounts.get(
      "workspace-1:agent-1::2024-01-01"
    );
    expect(counts).toBe(2);
    const messageCounts = result.messageCountMap.get(
      "workspace-1:agent-1::2024-01-01"
    );
    expect(messageCounts).toEqual({
      messagesIn: 2,
      messagesOut: 2,
      totalMessages: 4,
    });
  });

  it("buildToolAggregates groups by tool and supplier", () => {
    const transactions = [
      {
        workspaceId: "workspace-1",
        agentId: "agent-1",
        tool_call: "search",
        supplier: "tavily",
        amountMillionthUsd: -5000,
      },
      {
        workspaceId: "workspace-1",
        agentId: "agent-1",
        tool_call: "search",
        supplier: "tavily",
        amountMillionthUsd: -2000,
      },
      {
        workspaceId: "workspace-1",
        agentId: "agent-1",
        tool_call: "fetch",
        supplier: "jina",
        amountMillionthUsd: -1000,
      },
    ] as WorkspaceCreditTransactionRecord[];

    const aggregates = buildToolAggregates(transactions);
    const tavilyKey = "workspace-1:agent-1:search:tavily";
    const tavilyAgg = aggregates.get(tavilyKey);

    expect(tavilyAgg).toEqual({
      workspaceId: "workspace-1",
      agentId: "agent-1",
      toolCall: "search",
      supplier: "tavily",
      costUsd: 7000,
      callCount: 2,
    });
  });
});
