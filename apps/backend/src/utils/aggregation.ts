import type {
  DatabaseSchema,
  AgentConversationRecord,
  TokenUsageAggregateRecord,
  ToolUsageAggregateRecord,
  WorkspaceCreditTransactionRecord,
} from "../tables/schema";

import type { TokenUsage } from "./conversationLogger";

export type Currency = "usd";

export interface ByokStats {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface ToolExpenseStats {
  costUsd: number;
  callCount: number;
}

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  byModel: Record<string, ByokStats>;
  byProvider: Record<string, ByokStats>;
  byByok: {
    byok: ByokStats;
    platform: ByokStats;
  };
  toolExpenses: Record<string, ToolExpenseStats>; // Key: "{toolCall}-{supplier}"
}

export interface DailyUsageStats extends UsageStats {
  date: string;
}

// Threshold: last 7 days = query conversations, older = use aggregates
const RECENT_DAYS_THRESHOLD = 7;

/**
 * Format date as YYYY-MM-DD
 */
export function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * Get date range from start to end (inclusive)
 */
export function getDateRange(startDate: Date, endDate: Date): string[] {
  const dates: string[] = [];
  const current = new Date(startDate);
  const end = new Date(endDate);

  while (current <= end) {
    dates.push(formatDate(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

/**
 * Check if a date is within the recent threshold (last N days)
 */
export function isRecentDate(date: Date): boolean {
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - RECENT_DAYS_THRESHOLD);
  return date >= threshold;
}

/**
 * Aggregate usage stats from conversations
 */
export function aggregateConversations(
  conversations: AgentConversationRecord[]
): UsageStats {
  const stats: UsageStats = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0, // Cost now comes from transactions, not conversations
    byModel: {},
    byProvider: {},
    byByok: {
      byok: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      },
      platform: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      },
    },
    toolExpenses: {},
  };

  for (const conv of conversations) {
    // Handle tokenUsage - it might be stored as a string in some cases
    let tokenUsage: TokenUsage | undefined = conv.tokenUsage as
      | TokenUsage
      | undefined;

    // If tokenUsage is a string, try to parse it
    if (typeof tokenUsage === "string") {
      try {
        tokenUsage = JSON.parse(tokenUsage) as TokenUsage;
      } catch (e) {
        console.warn(
          "[aggregateConversations] Failed to parse tokenUsage string:",
          {
            conversationId: conv.conversationId,
            error: e,
          }
        );
        tokenUsage = undefined;
      }
    }

    if (!tokenUsage) {
      console.warn(
        "[aggregateConversations] Skipping conversation without tokenUsage:",
        {
          conversationId: conv.conversationId,
        }
      );
      continue;
    }

    // Extract token values with proper type checking
    const usageObj = tokenUsage as unknown as Record<string, unknown>;
    const inputTokens =
      typeof usageObj.promptTokens === "number" ? usageObj.promptTokens : 0;
    const cachedPromptTokens =
      typeof usageObj.cachedPromptTokens === "number"
        ? usageObj.cachedPromptTokens
        : 0;
    const outputTokens =
      typeof usageObj.completionTokens === "number"
        ? usageObj.completionTokens
        : 0;
    const totalTokens =
      typeof usageObj.totalTokens === "number" ? usageObj.totalTokens : 0;

    // Log cached tokens if present for diagnostics
    if (cachedPromptTokens > 0) {
      console.log(
        "[aggregateConversations] Found cached prompt tokens in conversation:",
        {
          conversationId: conv.conversationId,
          cachedPromptTokens,
          promptTokens: inputTokens,
        }
      );
    }

    // If we have totalTokens but not the breakdown, log a warning
    if (totalTokens > 0 && inputTokens === 0 && outputTokens === 0) {
      console.warn(
        "[aggregateConversations] Conversation has totalTokens but missing promptTokens/completionTokens:",
        {
          conversationId: conv.conversationId,
          totalTokens,
          tokenUsageKeys: Object.keys(tokenUsage),
        }
      );
      // Try to infer: if we can't get the breakdown, we can't calculate costs accurately
      // But we'll still count totalTokens
    }

    // Aggregate totals (cost comes from transactions, not conversations)
    stats.inputTokens += inputTokens;
    stats.outputTokens += outputTokens;
    stats.totalTokens += totalTokens;
    // costUsd is not aggregated from conversations anymore

    // Aggregate by model
    const modelName = conv.modelName || "unknown";
    if (!stats.byModel[modelName]) {
      stats.byModel[modelName] = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      };
    }
    stats.byModel[modelName].inputTokens += inputTokens;
    stats.byModel[modelName].outputTokens += outputTokens;
    stats.byModel[modelName].totalTokens += totalTokens;
    // costUsd is not aggregated from conversations anymore

    // Aggregate by provider
    const provider = conv.provider || "unknown";
    if (!stats.byProvider[provider]) {
      stats.byProvider[provider] = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      };
    }
    stats.byProvider[provider].inputTokens += inputTokens;
    stats.byProvider[provider].outputTokens += outputTokens;
    stats.byProvider[provider].totalTokens += totalTokens;
    // costUsd is not aggregated from conversations anymore

    // Aggregate by BYOK
    const isByok = conv.usesByok === true;
    const byokKey = isByok ? "byok" : "platform";
    stats.byByok[byokKey].inputTokens += inputTokens;
    stats.byByok[byokKey].outputTokens += outputTokens;
    stats.byByok[byokKey].totalTokens += totalTokens;
    // costUsd is not aggregated from conversations anymore
  }

  return stats;
}

/**
 * Aggregate usage stats from aggregate records
 */
export function aggregateAggregates(
  aggregates: TokenUsageAggregateRecord[]
): UsageStats {
  const stats: UsageStats = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0, // Cost now comes from transactions/aggregates, not token aggregates
    byModel: {},
    byProvider: {},
    byByok: {
      byok: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      },
      platform: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      },
    },
    toolExpenses: {},
  };

  for (const agg of aggregates) {
    // Aggregate totals (cost comes from transactions/aggregates, not token aggregates)
    stats.inputTokens += agg.inputTokens;
    stats.outputTokens += agg.outputTokens;
    stats.totalTokens += agg.totalTokens;
    // costUsd is not aggregated from token aggregates anymore

    // Aggregate by model
    const modelName = agg.modelName;
    if (!stats.byModel[modelName]) {
      stats.byModel[modelName] = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      };
    }
    stats.byModel[modelName].inputTokens += agg.inputTokens;
    stats.byModel[modelName].outputTokens += agg.outputTokens;
    stats.byModel[modelName].totalTokens += agg.totalTokens;
    // costUsd is not aggregated from token aggregates anymore

    // Aggregate by provider
    const provider = agg.provider;
    if (!stats.byProvider[provider]) {
      stats.byProvider[provider] = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      };
    }
    stats.byProvider[provider].inputTokens += agg.inputTokens;
    stats.byProvider[provider].outputTokens += agg.outputTokens;
    stats.byProvider[provider].totalTokens += agg.totalTokens;
    // costUsd is not aggregated from token aggregates anymore

    // Aggregate by BYOK
    const isByok = agg.usesByok === true;
    const byokKey = isByok ? "byok" : "platform";
    stats.byByok[byokKey].inputTokens += agg.inputTokens;
    stats.byByok[byokKey].outputTokens += agg.outputTokens;
    stats.byByok[byokKey].totalTokens += agg.totalTokens;
    // costUsd is not aggregated from token aggregates anymore
  }

  return stats;
}

/**
 * Merge two usage stats objects
 */
export function mergeUsageStats(...statsArray: UsageStats[]): UsageStats {
  const merged: UsageStats = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    byModel: {},
    byProvider: {},
    byByok: {
      byok: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      },
      platform: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      },
    },
    toolExpenses: {},
  };

  for (const stats of statsArray) {
    merged.inputTokens += stats.inputTokens;
    merged.outputTokens += stats.outputTokens;
    merged.totalTokens += stats.totalTokens;
    merged.costUsd += stats.costUsd;

    // Merge byModel
    for (const [model, modelStats] of Object.entries(stats.byModel)) {
      if (!merged.byModel[model]) {
        merged.byModel[model] = {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        };
      }
      merged.byModel[model].inputTokens += modelStats.inputTokens;
      merged.byModel[model].outputTokens += modelStats.outputTokens;
      merged.byModel[model].totalTokens += modelStats.totalTokens;
      merged.byModel[model].costUsd += modelStats.costUsd;
    }

    // Merge byProvider
    for (const [provider, providerStats] of Object.entries(stats.byProvider)) {
      if (!merged.byProvider[provider]) {
        merged.byProvider[provider] = {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        };
      }
      merged.byProvider[provider].inputTokens += providerStats.inputTokens;
      merged.byProvider[provider].outputTokens += providerStats.outputTokens;
      merged.byProvider[provider].totalTokens += providerStats.totalTokens;
      merged.byProvider[provider].costUsd += providerStats.costUsd;
    }

    // Merge byByok
    merged.byByok.byok.inputTokens += stats.byByok.byok.inputTokens;
    merged.byByok.byok.outputTokens += stats.byByok.byok.outputTokens;
    merged.byByok.byok.totalTokens += stats.byByok.byok.totalTokens;
    merged.byByok.byok.costUsd += stats.byByok.byok.costUsd;

    merged.byByok.platform.inputTokens += stats.byByok.platform.inputTokens;
    merged.byByok.platform.outputTokens += stats.byByok.platform.outputTokens;
    merged.byByok.platform.totalTokens += stats.byByok.platform.totalTokens;
    merged.byByok.platform.costUsd += stats.byByok.platform.costUsd;

    // Merge toolExpenses
    for (const [key, toolStats] of Object.entries(stats.toolExpenses)) {
      if (!merged.toolExpenses[key]) {
        merged.toolExpenses[key] = {
          costUsd: 0,
          callCount: 0,
        };
      }
      merged.toolExpenses[key].costUsd += toolStats.costUsd;
      merged.toolExpenses[key].callCount += toolStats.callCount;
    }
  }

  return merged;
}

/**
 * Query transactions for a date range
 */
async function queryTransactionsForDateRange(
  db: DatabaseSchema,
  options: {
    workspaceId?: string;
    agentId?: string;
    startDate: Date;
    endDate: Date;
  }
): Promise<WorkspaceCreditTransactionRecord[]> {
  const { workspaceId, agentId, startDate, endDate } = options;
  const transactions: WorkspaceCreditTransactionRecord[] = [];

  if (agentId) {
    // Query by agentId using GSI with queryAsync to handle pagination
    for await (const transaction of db["workspace-credit-transactions"].queryAsync({
      IndexName: "byAgentId",
      KeyConditionExpression: "agentId = :agentId",
      ExpressionAttributeNames: {
        "#createdAt": "createdAt",
      },
      ExpressionAttributeValues: {
        ":agentId": agentId,
        ":startDate": startDate.toISOString(),
        ":endDate": endDate.toISOString(),
      },
      FilterExpression: "#createdAt BETWEEN :startDate AND :endDate",
    })) {
      transactions.push(transaction);
    }
  } else if (workspaceId) {
    // Query by workspaceId using pk with queryAsync to handle pagination
    const workspacePk = `workspaces/${workspaceId}`;
    for await (const transaction of db["workspace-credit-transactions"].queryAsync({
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeNames: {
        "#createdAt": "createdAt",
      },
      ExpressionAttributeValues: {
        ":pk": workspacePk,
        ":startDate": startDate.toISOString(),
        ":endDate": endDate.toISOString(),
      },
      FilterExpression: "#createdAt BETWEEN :startDate AND :endDate",
    })) {
      transactions.push(transaction);
    }
  }

  // Filter by date range (additional safety check)
  const filtered = transactions.filter((txn) => {
    const createdAt = new Date(txn.createdAt);
    return createdAt >= startDate && createdAt <= endDate;
  });

  return filtered;
}

/**
 * Aggregate transactions for cost (excluding tool-execution)
 */
function aggregateTransactions(
  transactions: WorkspaceCreditTransactionRecord[]
): UsageStats {
  const stats: UsageStats = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    byModel: {},
    byProvider: {},
    byByok: {
      byok: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      },
      platform: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      },
    },
    toolExpenses: {},
  };

  // Filter out tool-execution transactions (they're handled separately)
  const nonToolTransactions = transactions.filter(
    (txn) => txn.source !== "tool-execution"
  );

  for (const txn of nonToolTransactions) {
    const costUsd = txn.amountMillionthUsd || 0;

    // Aggregate totals
    stats.costUsd += costUsd;

    // Aggregate by model
    const modelName = txn.model || "unknown";
    if (!stats.byModel[modelName]) {
      stats.byModel[modelName] = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      };
    }
    stats.byModel[modelName].costUsd += costUsd;

    // Aggregate by provider
    const provider = txn.supplier || "unknown";
    if (!stats.byProvider[provider]) {
      stats.byProvider[provider] = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      };
    }
    stats.byProvider[provider].costUsd += costUsd;

    // Aggregate by BYOK (for text-generation and embedding-generation, BYOK is determined by supplier)
    // For now, we'll treat all transactions as platform (BYOK transactions would have different handling)
    // This might need adjustment based on actual BYOK tracking in transactions
    stats.byByok.platform.costUsd += costUsd;
  }

  return stats;
}

/**
 * Aggregate tool transactions
 */
function aggregateToolTransactions(
  transactions: WorkspaceCreditTransactionRecord[]
): UsageStats {
  const stats: UsageStats = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    byModel: {},
    byProvider: {},
    byByok: {
      byok: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      },
      platform: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      },
    },
    toolExpenses: {},
  };

  // Filter only tool-execution transactions
  const toolTransactions = transactions.filter(
    (txn) => txn.source === "tool-execution"
  );

  for (const txn of toolTransactions) {
    const costUsd = txn.amountMillionthUsd || 0;
    const toolCall = txn.tool_call || "unknown";
    const supplier = txn.supplier || "unknown";
    const key = `${toolCall}-${supplier}`;

    // Aggregate totals
    stats.costUsd += costUsd;

    // Aggregate by tool
    if (!stats.toolExpenses[key]) {
      stats.toolExpenses[key] = {
        costUsd: 0,
        callCount: 0,
      };
    }
    stats.toolExpenses[key].costUsd += costUsd;
    stats.toolExpenses[key].callCount += 1;
  }

  return stats;
}

/**
 * Query tool aggregates for a specific date
 */
async function queryToolAggregatesForDate(
  db: DatabaseSchema,
  options: {
    workspaceId?: string;
    agentId?: string;
    userId?: string;
    date: string;
  }
): Promise<UsageStats> {
  const { workspaceId, agentId, userId, date } = options;
  const aggregates: ToolUsageAggregateRecord[] = [];

  if (agentId) {
    const query = await db["tool-usage-aggregates"].query({
      IndexName: "byAgentIdAndDate",
      KeyConditionExpression: "agentId = :agentId AND #date = :date",
      ExpressionAttributeNames: {
        "#date": "date",
      },
      ExpressionAttributeValues: {
        ":agentId": agentId,
        ":date": date,
      },
    });
    aggregates.push(...query.items);
  } else if (workspaceId) {
    const query = await db["tool-usage-aggregates"].query({
      IndexName: "byWorkspaceIdAndDate",
      KeyConditionExpression: "workspaceId = :workspaceId AND #date = :date",
      ExpressionAttributeNames: {
        "#date": "date",
      },
      ExpressionAttributeValues: {
        ":workspaceId": workspaceId,
        ":date": date,
      },
    });
    aggregates.push(...query.items);
  } else if (userId) {
    const query = await db["tool-usage-aggregates"].query({
      IndexName: "byUserIdAndDate",
      KeyConditionExpression: "userId = :userId AND #date = :date",
      ExpressionAttributeNames: {
        "#date": "date",
      },
      ExpressionAttributeValues: {
        ":userId": userId,
        ":date": date,
      },
    });
    aggregates.push(...query.items);
  }

  return aggregateToolAggregates(aggregates);
}

/**
 * Aggregate tool aggregates
 */
function aggregateToolAggregates(
  aggregates: ToolUsageAggregateRecord[]
): UsageStats {
  const stats: UsageStats = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    byModel: {},
    byProvider: {},
    byByok: {
      byok: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      },
      platform: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      },
    },
    toolExpenses: {},
  };

  for (const agg of aggregates) {
    const costUsd = agg.costUsd || 0;
    const key = `${agg.toolCall}-${agg.supplier}`;

    // Aggregate totals
    stats.costUsd += costUsd;

    // Aggregate by tool
    if (!stats.toolExpenses[key]) {
      stats.toolExpenses[key] = {
        costUsd: 0,
        callCount: 0,
      };
    }
    stats.toolExpenses[key].costUsd += costUsd;
    stats.toolExpenses[key].callCount += agg.callCount || 0;
  }

  return stats;
}

/**
 * Query conversations for a date range (hybrid approach)
 */
export async function queryUsageStats(
  db: DatabaseSchema,
  options: {
    workspaceId?: string;
    agentId?: string;
    userId?: string;
    startDate: Date;
    endDate: Date;
  }
): Promise<UsageStats> {
  const { workspaceId, agentId, userId, startDate, endDate } = options;
  const dates = getDateRange(startDate, endDate);

  // Split dates into recent (query conversations) and old (query aggregates)
  const recentDates: string[] = [];
  const oldDates: string[] = [];

  for (const dateStr of dates) {
    const date = new Date(dateStr);
    if (isRecentDate(date)) {
      recentDates.push(dateStr);
    } else {
      oldDates.push(dateStr);
    }
  }

  const statsPromises: Promise<UsageStats>[] = [];

  // Query recent conversations (for tokens) and transactions (for cost)
  if (recentDates.length > 0) {
    const recentStart = new Date(
      Math.min(...recentDates.map((d) => new Date(d).getTime()))
    );
    const recentEnd = new Date(
      Math.max(...recentDates.map((d) => new Date(d).getTime()))
    );
    recentEnd.setHours(23, 59, 59, 999);

    // Query conversations for tokens
    statsPromises.push(
      queryConversationsForDateRange(db, {
        workspaceId,
        agentId,
        startDate: recentStart,
        endDate: recentEnd,
      })
    );

    // Query transactions for cost (non-tool transactions)
    const transactions = await queryTransactionsForDateRange(db, {
      workspaceId,
      agentId,
      startDate: recentStart,
      endDate: recentEnd,
    });
    statsPromises.push(Promise.resolve(aggregateTransactions(transactions)));

    // Query transactions for tool expenses
    statsPromises.push(Promise.resolve(aggregateToolTransactions(transactions)));
  }

  // Query old aggregates (tokens and costs)
  if (oldDates.length > 0) {
    for (const dateStr of oldDates) {
      // Query token aggregates (for tokens)
      statsPromises.push(
        queryAggregatesForDate(db, {
          workspaceId,
          agentId,
          userId,
          date: dateStr,
        })
      );

      // Query tool aggregates (for tool costs)
      statsPromises.push(
        queryToolAggregatesForDate(db, {
          workspaceId,
          agentId,
          userId,
          date: dateStr,
        })
      );
    }
  }

  const allStats = await Promise.all(statsPromises);
  return mergeUsageStats(...allStats);
}

/**
 * Query conversations for a date range
 */
async function queryConversationsForDateRange(
  db: DatabaseSchema,
  options: {
    workspaceId?: string;
    agentId?: string;
    startDate: Date;
    endDate: Date;
  }
): Promise<UsageStats> {
  const { workspaceId, agentId, startDate, endDate } = options;
  const conversations: AgentConversationRecord[] = [];

  if (agentId) {
    // Query by agentId using GSI
    const query = await db["agent-conversations"].query({
      IndexName: "byAgentId",
      KeyConditionExpression: "agentId = :agentId",
      ExpressionAttributeNames: {
        "#startedAt": "startedAt",
      },
      ExpressionAttributeValues: {
        ":agentId": agentId,
        ":startDate": startDate.toISOString(),
        ":endDate": endDate.toISOString(),
      },
      FilterExpression: "#startedAt BETWEEN :startDate AND :endDate",
    });

    conversations.push(...query.items);
  } else if (workspaceId) {
    // Query all agents in the workspace first, then query conversations for each agent
    // This is more efficient than scanning the entire conversations table
    const agentsQuery = await db.agent.query({
      IndexName: "byWorkspaceId",
      KeyConditionExpression: "workspaceId = :workspaceId",
      ExpressionAttributeValues: {
        ":workspaceId": workspaceId,
      },
    });

    const agentIds = agentsQuery.items.map((agent) => {
      // Extract agentId from pk (format: "agents/{workspaceId}/{agentId}")
      const parts = agent.pk.split("/");
      return parts[parts.length - 1];
    });

    // Query conversations for each agent
    const conversationQueryResults = await Promise.allSettled(
      agentIds.map((aid) =>
        db["agent-conversations"].query({
          IndexName: "byAgentId",
          KeyConditionExpression: "agentId = :agentId",
          ExpressionAttributeNames: {
            "#startedAt": "startedAt",
          },
          ExpressionAttributeValues: {
            ":agentId": aid,
            ":startDate": startDate.toISOString(),
            ":endDate": endDate.toISOString(),
          },
          FilterExpression: "#startedAt BETWEEN :startDate AND :endDate",
        })
      )
    );

    for (let i = 0; i < conversationQueryResults.length; i++) {
      const result = conversationQueryResults[i];
      const agentId = agentIds[i];

      if (result.status === "rejected") {
        console.error(
          `[queryConversationsForDateRange] Failed to query conversations for agent ${agentId}:`,
          result.reason
        );
        continue;
      }

      const query = result.value;
      conversations.push(...query.items);
    }
  }

  // Filter by date range (additional safety check)
  const filtered = conversations.filter((conv) => {
    const startedAt = new Date(conv.startedAt);
    return startedAt >= startDate && startedAt <= endDate;
  });

  return aggregateConversations(filtered);
}

/**
 * Query aggregates for a specific date
 */
async function queryAggregatesForDate(
  db: DatabaseSchema,
  options: {
    workspaceId?: string;
    agentId?: string;
    userId?: string;
    date: string;
  }
): Promise<UsageStats> {
  const { workspaceId, agentId, userId, date } = options;
  const aggregates: TokenUsageAggregateRecord[] = [];

  if (agentId) {
    const query = await db["token-usage-aggregates"].query({
      IndexName: "byAgentIdAndDate",
      KeyConditionExpression: "agentId = :agentId AND #date = :date",
      ExpressionAttributeNames: {
        "#date": "date",
      },
      ExpressionAttributeValues: {
        ":agentId": agentId,
        ":date": date,
      },
    });
    aggregates.push(...query.items);
  } else if (workspaceId) {
    const query = await db["token-usage-aggregates"].query({
      IndexName: "byWorkspaceIdAndDate",
      KeyConditionExpression: "workspaceId = :workspaceId AND #date = :date",
      ExpressionAttributeNames: {
        "#date": "date",
      },
      ExpressionAttributeValues: {
        ":workspaceId": workspaceId,
        ":date": date,
      },
    });
    aggregates.push(...query.items);
  } else if (userId) {
    const query = await db["token-usage-aggregates"].query({
      IndexName: "byUserIdAndDate",
      KeyConditionExpression: "userId = :userId AND #date = :date",
      ExpressionAttributeNames: {
        "#date": "date",
      },
      ExpressionAttributeValues: {
        ":userId": userId,
        ":date": date,
      },
    });
    aggregates.push(...query.items);
  }

  return aggregateAggregates(aggregates);
}
