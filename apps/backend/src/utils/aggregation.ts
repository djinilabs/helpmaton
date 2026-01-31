import type {
  DatabaseSchema,
  AgentConversationRecord,
  TokenUsageAggregateRecord,
  ToolUsageAggregateRecord,
  WorkspaceCreditTransactionRecord,
} from "../tables/schema";

import type { TokenUsage } from "./conversationLogger";
import { getModelPricing } from "./pricing";
import { Sentry, ensureError } from "./sentry";

export type Currency = "usd";

export interface ByokStats {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface CostByType {
  textGeneration: number;
  embeddings: number;
  reranking: number;
  tavily: number;
  exa: number;
  scrape: number;
  imageGeneration: number;
  eval: number;
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
  costByType: CostByType;
  rerankingCostUsd: number; // Reranking costs in nano-dollars
  evalCostUsd: number; // Eval judge costs in nano-dollars
  conversationCount: number;
  messagesIn: number; // Number of user messages
  messagesOut: number; // Number of assistant messages
  totalMessages: number; // Total messages (user + assistant)
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
 * Extract supplier from model name format {supplier}/{model}
 * @param modelName - Model name (e.g., "openai/gpt-4", "google/gemini-2.5-flash")
 * @returns Supplier name or "unknown" if format doesn't match
 */
export function extractSupplierFromModelName(modelName: string): string {
  if (!modelName || modelName === "unknown") {
    return "unknown";
  }

  // Check if model name contains supplier prefix (format: "supplier/model-name")
  const parts = modelName.split("/");
  if (
    parts.length === 2 &&
    parts[0].trim().length > 0 &&
    parts[1].trim().length > 0
  ) {
    return parts[0].trim(); // e.g., "openai", "google", "anthropic"
  }

  // No supplier prefix found
  return "unknown";
}

/**
 * Normalize model name by removing provider prefix if present
 * This ensures model names from conversations (with prefix) match those from transactions (without prefix)
 * @param modelName - Model name (e.g., "google/gemini-3-flash-preview" or "gemini-3-flash-preview")
 * @returns Model name without provider prefix (e.g., "gemini-3-flash-preview")
 */
export function normalizeModelNameForAggregation(modelName: string): string {
  if (!modelName || modelName === "unknown") {
    return "unknown";
  }

  // Check if model name contains supplier prefix (format: "supplier/model-name")
  const parts = modelName.split("/");
  if (
    parts.length === 2 &&
    parts[0].trim().length > 0 &&
    parts[1].trim().length > 0
  ) {
    return parts[1].trim(); // Return model name without provider prefix
  }

  // No supplier prefix found, return as-is
  return modelName;
}

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

function createEmptyCostByType(): CostByType {
  return {
    textGeneration: 0,
    embeddings: 0,
    reranking: 0,
    tavily: 0,
    exa: 0,
    scrape: 0,
    imageGeneration: 0,
    eval: 0,
  };
}

function addCostByType(target: CostByType, source: CostByType): void {
  target.textGeneration += source.textGeneration;
  target.embeddings += source.embeddings;
  target.reranking += source.reranking;
  target.tavily += source.tavily;
  target.exa += source.exa;
  target.scrape += source.scrape;
  target.imageGeneration += source.imageGeneration;
  target.eval += source.eval;
}

function isImageGenerationModel(modelName?: string): boolean {
  if (!modelName) {
    return false;
  }
  const pricing = getModelPricing("openrouter", modelName);
  if (pricing?.capabilities?.image_generation || pricing?.capabilities?.image) {
    return true;
  }
  return /image/i.test(modelName);
}

export function classifyTransactionChargeType(
  txn: WorkspaceCreditTransactionRecord
): keyof CostByType | undefined {
  if (txn.source === "embedding-generation") {
    return "embeddings";
  }
  if (txn.source !== "text-generation") {
    return undefined;
  }
  const rawModelName = txn.model || "";
  if (rawModelName === "scrape") {
    return "scrape";
  }
  if (isImageGenerationModel(rawModelName)) {
    return "imageGeneration";
  }
  return "textGeneration";
}

export function classifyToolChargeType(
  toolCall: string,
  supplier: string
): keyof CostByType | undefined {
  if (toolCall === "document-search-embedding") {
    return "embeddings";
  }
  if (toolCall === "rerank") {
    return "reranking";
  }
  if (supplier === "tavily") {
    return "tavily";
  }
  if (supplier === "exa") {
    return "exa";
  }
  return undefined;
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
    costUsd: 0, // Cost comes from conversation records (costUsd field)
    costByType: createEmptyCostByType(),
    rerankingCostUsd: 0,
    evalCostUsd: 0,
    conversationCount: conversations.length,
    messagesIn: 0,
    messagesOut: 0,
    totalMessages: 0,
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
        Sentry.captureException(ensureError(e), {
          tags: {
            context: "aggregation",
            operation: "parse-token-usage",
          },
        });
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
    const reasoningTokens =
      typeof usageObj.reasoningTokens === "number"
        ? usageObj.reasoningTokens
        : 0;
    const totalTokensFromApi =
      typeof usageObj.totalTokens === "number" ? usageObj.totalTokens : 0;

    // Calculate totalTokens: use API value if available, otherwise calculate from components
    // Note: promptTokens stored in conversations is nonCachedPromptTokens (cached tokens are separate)
    // Total tokens = nonCachedPromptTokens + cachedPromptTokens + completionTokens + reasoningTokens
    // The API's totalTokens should already include all of these
    const calculatedTotalTokens =
      inputTokens + cachedPromptTokens + outputTokens + reasoningTokens;
    const totalTokens =
      totalTokensFromApi > 0 ? totalTokensFromApi : calculatedTotalTokens;

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

    // Extract modelName from messages (modelName at conversation level is deprecated)
    // Find the most common model used in assistant messages
    // Also count messages by role
    let modelName = conv.modelName || "unknown"; // Fallback to deprecated field
    const messages = (conv.messages || []) as Array<{
      role?: string;
      modelName?: string;
    }>;
    const modelCounts = new Map<string, number>();
    let userMessageCount = 0;
    let assistantMessageCount = 0;
    for (const message of messages) {
      // Count messages by role
      if (message.role === "user") {
        userMessageCount++;
      } else if (message.role === "assistant") {
        assistantMessageCount++;
      }

      // Track model usage
      if (
        message.role === "assistant" &&
        message.modelName &&
        typeof message.modelName === "string"
      ) {
        const msgModelName = message.modelName;
        modelCounts.set(msgModelName, (modelCounts.get(msgModelName) || 0) + 1);
      }
    }
    // Use the most common model, or fall back to any model found
    if (modelCounts.size > 0) {
      let maxCount = 0;
      let mostCommonModel = "unknown";
      for (const [model, count] of modelCounts.entries()) {
        if (count > maxCount) {
          maxCount = count;
          mostCommonModel = model;
        }
      }
      modelName = mostCommonModel;
    }

    // Aggregate message counts
    stats.messagesIn += userMessageCount;
    stats.messagesOut += assistantMessageCount;
    stats.totalMessages += userMessageCount + assistantMessageCount;

    // Normalize model name to remove provider prefix (e.g., "google/gemini-3-flash-preview" -> "gemini-3-flash-preview")
    // This ensures model names from conversations match those in transactions
    const originalModelName = modelName;
    modelName = normalizeModelNameForAggregation(modelName);

    // Extract cost from conversation record (costUsd field)
    const conversationCostUsd = (conv.costUsd as number | undefined) || 0;

    // Extract reranking cost from conversation record (rerankingCostUsd field)
    const rerankingCostUsd = (conv.rerankingCostUsd as number | undefined) || 0;

    // Aggregate totals
    stats.inputTokens += inputTokens;
    stats.outputTokens += outputTokens;
    stats.totalTokens += totalTokens;
    stats.costUsd += conversationCostUsd;
    stats.rerankingCostUsd += rerankingCostUsd;
    stats.costByType.textGeneration += conversationCostUsd;
    stats.costByType.reranking += rerankingCostUsd;

    // Aggregate by model
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
    stats.byModel[modelName].costUsd += conversationCostUsd;

    // Aggregate by provider - extract supplier from model name, not from conv.provider (which is "openrouter")
    const supplier = extractSupplierFromModelName(originalModelName); // Use original model name to extract provider
    if (!stats.byProvider[supplier]) {
      stats.byProvider[supplier] = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      };
    }
    stats.byProvider[supplier].inputTokens += inputTokens;
    stats.byProvider[supplier].outputTokens += outputTokens;
    stats.byProvider[supplier].totalTokens += totalTokens;
    stats.byProvider[supplier].costUsd += conversationCostUsd;

    // Aggregate by BYOK
    const isByok = conv.usesByok === true;
    const byokKey = isByok ? "byok" : "platform";
    stats.byByok[byokKey].inputTokens += inputTokens;
    stats.byByok[byokKey].outputTokens += outputTokens;
    stats.byByok[byokKey].totalTokens += totalTokens;
    stats.byByok[byokKey].costUsd += conversationCostUsd;
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
    costByType: createEmptyCostByType(),
    rerankingCostUsd: 0,
    evalCostUsd: 0,
    conversationCount: 0,
    messagesIn: 0,
    messagesOut: 0,
    totalMessages: 0,
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

  // Track unique workspace/agent/user/date combinations to avoid double-counting conversations
  const conversationCountMap = new Map<string, number>();
  // Track message counts per workspace/agent/user/date (same approach as conversation counts)
  const messageCountMap = new Map<
    string,
    { messagesIn: number; messagesOut: number; totalMessages: number }
  >();

  for (const agg of aggregates) {
    // Aggregate totals (cost comes from transactions/aggregates, not token aggregates)
    stats.inputTokens += agg.inputTokens;
    stats.outputTokens += agg.outputTokens;
    stats.totalTokens += agg.totalTokens;
    // costUsd is not aggregated from token aggregates anymore

    // Track conversation count per workspace/agent/user/date (avoid double-counting)
    // All aggregates with the same workspace/agent/user/date have the same conversationCount
    const conversationKey = `${agg.workspaceId || ""}:${agg.agentId || ""}:${
      agg.userId || ""
    }:${agg.date}`;
    if (!conversationCountMap.has(conversationKey)) {
      // Use conversationCount from aggregate, defaulting to 0 if missing (for backward compatibility)
      const count =
        (agg as unknown as { conversationCount?: number }).conversationCount ??
        0;
      conversationCountMap.set(conversationKey, count);
    }

    // Track message counts per workspace/agent/user/date (avoid double-counting)
    // All aggregates with the same workspace/agent/user/date have the same message counts
    if (!messageCountMap.has(conversationKey)) {
      // Use message counts from aggregate, defaulting to 0 if missing (for backward compatibility)
      const aggWithMessages = agg as unknown as {
        messagesIn?: number;
        messagesOut?: number;
        totalMessages?: number;
      };
      messageCountMap.set(conversationKey, {
        messagesIn: aggWithMessages.messagesIn ?? 0,
        messagesOut: aggWithMessages.messagesOut ?? 0,
        totalMessages: aggWithMessages.totalMessages ?? 0,
      });
    }

    // Aggregate by model
    // Normalize model name to remove provider prefix if present (e.g., "google/gemini-3-flash-preview" -> "gemini-3-flash-preview")
    // This ensures model names from aggregates match those from conversations and transactions
    const modelName = normalizeModelNameForAggregation(agg.modelName);
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

    // Aggregate by provider - use supplier from model name if provider is "openrouter" (backward compatibility)
    // New aggregates should already have the correct supplier in provider field
    let provider = agg.provider;
    if (provider === "openrouter") {
      // Extract supplier from original model name for legacy aggregates (before normalization)
      provider = extractSupplierFromModelName(agg.modelName);
    }
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

  // Sum conversation counts (each key represents unique workspace/agent/user/date)
  stats.conversationCount = Array.from(conversationCountMap.values()).reduce(
    (sum, count) => sum + count,
    0
  );

  // Sum message counts (each key represents unique workspace/agent/user/date)
  for (const messageCounts of messageCountMap.values()) {
    stats.messagesIn += messageCounts.messagesIn;
    stats.messagesOut += messageCounts.messagesOut;
    stats.totalMessages += messageCounts.totalMessages;
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
    costByType: createEmptyCostByType(),
    rerankingCostUsd: 0,
    evalCostUsd: 0,
    conversationCount: 0,
    messagesIn: 0,
    messagesOut: 0,
    totalMessages: 0,
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
    addCostByType(merged.costByType, stats.costByType);
    merged.rerankingCostUsd += stats.rerankingCostUsd;
    merged.evalCostUsd += stats.evalCostUsd;
    merged.conversationCount += stats.conversationCount;
    merged.messagesIn += stats.messagesIn;
    merged.messagesOut += stats.messagesOut;
    merged.totalMessages += stats.totalMessages;

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
 * Returns an async generator that yields transactions as they stream from the database
 */
async function* queryTransactionsForDateRange(
  db: DatabaseSchema,
  options: {
    workspaceId?: string;
    agentId?: string;
    startDate: Date;
    endDate: Date;
  }
): AsyncGenerator<WorkspaceCreditTransactionRecord, void, unknown> {
  const { workspaceId, agentId, startDate, endDate } = options;

  if (agentId) {
    // Query by agentId using GSI with queryAsync to handle pagination
    for await (const transaction of db[
      "workspace-credit-transactions"
    ].queryAsync({
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
      // Apply date filtering inline (additional safety check)
      const createdAt = new Date(transaction.createdAt);
      if (createdAt >= startDate && createdAt <= endDate) {
        yield transaction;
      }
    }
  } else if (workspaceId) {
    // Query by workspaceId using pk with queryAsync to handle pagination
    const workspacePk = `workspaces/${workspaceId}`;
    for await (const transaction of db[
      "workspace-credit-transactions"
    ].queryAsync({
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
      // Apply date filtering inline (additional safety check)
      const createdAt = new Date(transaction.createdAt);
      if (createdAt >= startDate && createdAt <= endDate) {
        yield transaction;
      }
    }
  }
}

/**
 * Aggregate transactions for cost (excluding tool-execution and credit-purchase) - streaming version
 * Processes transactions incrementally as they stream from the database
 */
async function aggregateTransactionsStream(
  transactions: AsyncGenerator<WorkspaceCreditTransactionRecord, void, unknown>
): Promise<UsageStats> {
  const stats: UsageStats = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    costByType: createEmptyCostByType(),
    rerankingCostUsd: 0,
    evalCostUsd: 0,
    conversationCount: 0,
    messagesIn: 0,
    messagesOut: 0,
    totalMessages: 0,
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

  // Process transactions as they stream in
  let transactionCount = 0;
  for await (const txn of transactions) {
    transactionCount++;

    // Filter out tool-execution transactions (they're handled separately)
    // Filter out credit-purchase transactions (they're not usage costs)
    if (txn.source === "tool-execution" || txn.source === "credit-purchase") {
      continue;
    }

    // Transaction amounts are stored as negative for debits, positive for credits
    // For cost reporting, we want positive costs, so take absolute value of debits
    // (negative amounts become positive, positive amounts stay positive or are excluded)
    const rawAmount = txn.amountNanoUsd || 0;
    const costUsd = rawAmount < 0 ? -rawAmount : 0; // Only count debits, convert to positive

    // Debug: Log all transactions to see what we're processing
    console.log("[aggregateTransactionsStream] Processing transaction:", {
      source: txn.source,
      model: txn.model,
      rawAmount,
      costUsd,
      supplier: txn.supplier,
      description: txn.description?.substring(0, 100),
    });

    // Aggregate totals
    stats.costUsd += costUsd;
    const chargeType = classifyTransactionChargeType(txn);
    if (chargeType) {
      stats.costByType[chargeType] += costUsd;
    }

    // Aggregate by model
    // Normalize model name to remove provider prefix if present (e.g., "google/gemini-3-flash-preview" -> "gemini-3-flash-preview")
    // This ensures model names from transactions match those from conversations
    const rawModelName = txn.model || "unknown";
    const modelName = normalizeModelNameForAggregation(rawModelName);

    // Debug logging for cost attribution
    if (costUsd > 0) {
      console.log("[aggregateTransactionsStream] Attributing cost to model:", {
        rawModelName,
        normalizedModelName: modelName,
        costUsd,
        source: txn.source,
        amountNanoUsd: rawAmount,
      });
    }

    if (!stats.byModel[modelName]) {
      stats.byModel[modelName] = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      };
    }
    // Use the same cost calculation for model breakdown
    const modelCostUsd = rawAmount < 0 ? -rawAmount : 0;
    stats.byModel[modelName].costUsd += modelCostUsd;

    // Aggregate by provider
    // For text-generation and embedding-generation: extract supplier from model name (since txn.supplier is "openrouter")
    // For tool-execution: use txn.supplier directly (it's the actual tool supplier like "tavily", "exa")
    let provider: string = txn.supplier || "unknown";
    if (
      (txn.source === "text-generation" ||
        txn.source === "embedding-generation") &&
      rawModelName
    ) {
      // Extract supplier from original model name format {supplier}/{model}
      // Use rawModelName (before normalization) to extract provider
      provider = extractSupplierFromModelName(rawModelName);
    }
    if (!stats.byProvider[provider]) {
      stats.byProvider[provider] = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      };
    }
    // Use the same cost calculation for provider breakdown
    const providerCostUsd = rawAmount < 0 ? -rawAmount : 0;
    stats.byProvider[provider].costUsd += providerCostUsd;

    // Aggregate by BYOK (for text-generation and embedding-generation, BYOK is determined by supplier)
    // For now, we'll treat all transactions as platform (BYOK transactions would have different handling)
    // This might need adjustment based on actual BYOK tracking in transactions
    // Use the same cost calculation for BYOK breakdown
    const byokCostUsd = rawAmount < 0 ? -rawAmount : 0;
    stats.byByok.platform.costUsd += byokCostUsd;
  }

  console.log("[aggregateTransactionsStream] Summary:", {
    transactionCount,
    totalCostUsd: stats.costUsd,
    modelsWithCosts: Object.entries(stats.byModel)
      .filter(([, modelStats]) => modelStats.costUsd > 0)
      .map(([model, modelStats]) => ({ model, costUsd: modelStats.costUsd })),
  });

  return stats;
}

/**
 * Aggregate tool transactions - streaming version
 * Processes transactions incrementally as they stream from the database
 */
async function aggregateToolTransactionsStream(
  transactions: AsyncGenerator<WorkspaceCreditTransactionRecord, void, unknown>
): Promise<UsageStats> {
  const stats: UsageStats = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    costByType: createEmptyCostByType(),
    rerankingCostUsd: 0,
    evalCostUsd: 0,
    conversationCount: 0,
    messagesIn: 0,
    messagesOut: 0,
    totalMessages: 0,
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

  // Process transactions as they stream in
  for await (const txn of transactions) {
    // Filter only tool-execution transactions
    if (txn.source !== "tool-execution") {
      continue;
    }

    // Transaction amounts are stored as negative for debits, positive for credits
    // For cost reporting, we want positive costs, so take absolute value of debits
    const rawAmount = txn.amountNanoUsd || 0;
    const costUsd = rawAmount < 0 ? -rawAmount : 0; // Only count debits, convert to positive
    const toolCall = txn.tool_call || "unknown";
    const supplier = txn.supplier || "unknown";
    const key = `${toolCall}-${supplier}`;

    // Aggregate totals
    stats.costUsd += costUsd;
    const chargeType = classifyToolChargeType(toolCall, supplier);
    if (chargeType) {
      stats.costByType[chargeType] += costUsd;
    }

    // Aggregate by tool
    if (!stats.toolExpenses[key]) {
      stats.toolExpenses[key] = {
        costUsd: 0,
        callCount: 0,
      };
    }
    // Use the same cost calculation for tool expenses (already calculated above as costUsd)
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
    costByType: createEmptyCostByType(),
    rerankingCostUsd: 0,
    evalCostUsd: 0,
    conversationCount: 0,
    messagesIn: 0,
    messagesOut: 0,
    totalMessages: 0,
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
    const chargeType = classifyToolChargeType(
      agg.toolCall || "unknown",
      agg.supplier || "unknown"
    );
    if (chargeType) {
      stats.costByType[chargeType] += costUsd;
    }

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

    // Query transactions for cost (non-tool transactions) - streaming
    statsPromises.push(
      aggregateTransactionsStream(
        queryTransactionsForDateRange(db, {
          workspaceId,
          agentId,
          startDate: recentStart,
          endDate: recentEnd,
        })
      )
    );

    // Query transactions for tool expenses - streaming
    // Note: We query twice since async generators can only be consumed once
    statsPromises.push(
      aggregateToolTransactionsStream(
        queryTransactionsForDateRange(db, {
          workspaceId,
          agentId,
          startDate: recentStart,
          endDate: recentEnd,
        })
      )
    );

    // Query eval costs
    statsPromises.push(
      queryEvalCostsForDateRange(db, {
        workspaceId,
        agentId,
        startDate: recentStart,
        endDate: recentEnd,
      })
    );
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

    const oldStart = new Date(
      Math.min(...oldDates.map((d) => new Date(d).getTime()))
    );
    const oldEnd = new Date(
      Math.max(...oldDates.map((d) => new Date(d).getTime()))
    );
    oldEnd.setHours(23, 59, 59, 999);

    // Query non-tool transactions for older dates to capture costs
    statsPromises.push(
      aggregateTransactionsStream(
        queryTransactionsForDateRange(db, {
          workspaceId,
          agentId,
          startDate: oldStart,
          endDate: oldEnd,
        })
      )
    );
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
 * Query eval costs for a date range
 */
async function queryEvalCostsForDateRange(
  db: DatabaseSchema,
  options: {
    workspaceId?: string;
    agentId?: string;
    startDate: Date;
    endDate: Date;
  }
): Promise<UsageStats> {
  const { workspaceId, agentId, startDate, endDate } = options;

  const stats: UsageStats = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    costByType: createEmptyCostByType(),
    rerankingCostUsd: 0,
    evalCostUsd: 0,
    conversationCount: 0,
    messagesIn: 0,
    messagesOut: 0,
    totalMessages: 0,
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

  // Query eval results using available GSIs
  // Note: We need to filter by evaluatedAt date in memory since there's no GSI with evaluatedAt as sort key
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const evalResultTable = (db as any)["agent-eval-result"];

  if (agentId) {
    // Query by agentId using GSI with queryAsync for memory efficiency
    for await (const result of evalResultTable.queryAsync({
      IndexName: "byAgentId",
      KeyConditionExpression: "agentId = :agentId",
      ExpressionAttributeValues: {
        ":agentId": agentId,
      },
    })) {
      // Filter by date range in memory
      const evaluatedAt = new Date(result.evaluatedAt);
      if (evaluatedAt >= startDate && evaluatedAt <= endDate) {
        const costUsd = (result.costUsd as number | undefined) || 0;
        stats.evalCostUsd += costUsd;
        stats.costByType.eval += costUsd;
      }
    }
  } else if (workspaceId) {
    // Query all agents in the workspace first, then query eval results for each agent
    // This is more efficient than scanning the entire eval results table
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

    // Query eval results for each agent using queryAsync for memory efficiency
    for (const aid of agentIds) {
      try {
        for await (const evalResult of evalResultTable.queryAsync({
          IndexName: "byAgentId",
          KeyConditionExpression: "agentId = :agentId",
          ExpressionAttributeValues: {
            ":agentId": aid,
          },
        })) {
          // Filter by date range in memory
          const evaluatedAt = new Date(evalResult.evaluatedAt);
          if (evaluatedAt >= startDate && evaluatedAt <= endDate) {
            const costUsd = (evalResult.costUsd as number | undefined) || 0;
            stats.evalCostUsd += costUsd;
            stats.costByType.eval += costUsd;
          }
        }
      } catch (error) {
        console.error(
          `[queryEvalCostsForDateRange] Failed to query eval results for agent ${aid}:`,
          error
        );
        // Continue with other agents even if one fails
      }
    }
  }

  return stats;
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
