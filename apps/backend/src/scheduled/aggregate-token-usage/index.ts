import type { ScheduledEvent } from "aws-lambda";

import { database } from "../../tables";
import type {
  AgentConversationRecord,
  TokenUsageAggregateRecord,
  ToolUsageAggregateRecord,
  WorkspaceCreditTransactionRecord,
} from "../../tables/schema";
import {
  extractSupplierFromModelName,
  formatDate,
} from "../../utils/aggregation";
import { queryRecords } from "../../utils/conversationRecords";
import { handlingScheduledErrors } from "../../utils/handlingErrors";
import { Sentry, ensureError, initSentry } from "../../utils/sentry";

initSentry();

type DateRange = {
  dateStr: string;
  startOfDay: Date;
  endOfDay: Date;
};

type ConversationMessageCounts = {
  messagesIn: number;
  messagesOut: number;
  totalMessages: number;
};

type TokenUsageAggregateInput = {
  workspaceId?: string;
  agentId?: string;
  userId?: string;
  modelName: string;
  provider: string;
  usesByok: boolean;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
};

type ToolAggregateInput = {
  workspaceId?: string;
  agentId?: string;
  toolCall: string;
  supplier: string;
  costUsd: number;
  callCount: number;
};

const getDateRange = (date: Date): DateRange => {
  const dateStr = formatDate(date);
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  return { dateStr, startOfDay, endOfDay };
};

const fetchWorkspaceIds = async (
  db: Awaited<ReturnType<typeof database>>
): Promise<string[]> => {
  const workspacePermissions = await db.permission.query({
    IndexName: "byResourceTypeAndEntityId",
    KeyConditionExpression: "resourceType = :resourceType",
    ExpressionAttributeValues: {
      ":resourceType": "workspaces",
    },
  });

  return [
    ...new Set(
      workspacePermissions.items.map((p) => p.pk.replace("workspaces/", ""))
    ),
  ];
};

const fetchAgentIdsForWorkspace = async (
  db: Awaited<ReturnType<typeof database>>,
  workspaceId: string
): Promise<string[]> => {
  const agentsQuery = await db.agent.query({
    IndexName: "byWorkspaceId",
    KeyConditionExpression: "workspaceId = :workspaceId",
    ExpressionAttributeValues: {
      ":workspaceId": workspaceId,
    },
  });

  return agentsQuery.items.map((agent) => {
    const parts = agent.pk.split("/");
    return parts[parts.length - 1];
  });
};

const fetchConversationsForAgent = async (params: {
  db: Awaited<ReturnType<typeof database>>;
  agentId: string;
  startOfDay: Date;
  endOfDay: Date;
}): Promise<AgentConversationRecord[]> => {
  const { db, agentId, startOfDay, endOfDay } = params;
  try {
    const conversationsQuery = await queryRecords(db, {
      IndexName: "byAgentId",
      KeyConditionExpression: "agentId = :agentId",
      ExpressionAttributeNames: {
        "#startedAt": "startedAt",
      },
      ExpressionAttributeValues: {
        ":agentId": agentId,
        ":startDate": startOfDay.toISOString(),
        ":endDate": endOfDay.toISOString(),
      },
      FilterExpression: "#startedAt BETWEEN :startDate AND :endDate",
    });

    return conversationsQuery.items;
  } catch (agentError) {
    console.error(
      `[Aggregate Token Usage] Error querying conversations for agent ${agentId}:`,
      agentError instanceof Error ? agentError.message : String(agentError)
    );
    Sentry.captureException(ensureError(agentError), {
      tags: {
        context: "aggregation",
        operation: "query-agent-conversations",
      },
    });
    return [];
  }
};

const fetchConversationsForWorkspace = async (params: {
  db: Awaited<ReturnType<typeof database>>;
  workspaceId: string;
  startOfDay: Date;
  endOfDay: Date;
}): Promise<AgentConversationRecord[]> => {
  const { db, workspaceId, startOfDay, endOfDay } = params;
  try {
    const agentIds = await fetchAgentIdsForWorkspace(db, workspaceId);
    console.log(
      `[Aggregate Token Usage] Workspace ${workspaceId}: Found ${agentIds.length} agents`
    );

    const workspaceConversations: AgentConversationRecord[] = [];
    for (const agentId of agentIds) {
      const conversations = await fetchConversationsForAgent({
        db,
        agentId,
        startOfDay,
        endOfDay,
      });
      if (conversations.length > 0) {
        console.log(
          `[Aggregate Token Usage] Agent ${agentId}: Found ${conversations.length} conversations`
        );
        workspaceConversations.push(...conversations);
      }
    }

    return workspaceConversations;
  } catch (workspaceError) {
    console.error(
      `[Aggregate Token Usage] Error processing workspace ${workspaceId}:`,
      workspaceError instanceof Error ? workspaceError.message : String(workspaceError)
    );
    Sentry.captureException(ensureError(workspaceError), {
      tags: {
        context: "aggregation",
        operation: "process-workspace-conversations",
      },
    });
    return [];
  }
};

export const buildConversationAggregates = (
  conversations: AgentConversationRecord[],
  dateStr: string
): {
  aggregates: Map<string, TokenUsageAggregateInput>;
  conversationCounts: Map<string, number>;
  messageCountMap: Map<string, ConversationMessageCounts>;
} => {
  const conversationCountMap = new Map<string, Set<string>>();
  const messageCountMap = new Map<string, ConversationMessageCounts>();
  const aggregates = new Map<string, TokenUsageAggregateInput>();

  for (const conv of conversations) {
    if (!conv.tokenUsage || !conv.modelName || !conv.provider) {
      console.warn(
        `[Aggregate Token Usage] Skipping conversation due to missing required fields:`,
        {
          workspaceId: conv.workspaceId,
          agentId: conv.agentId,
          conversationId: conv.conversationId,
          missingTokenUsage: !conv.tokenUsage,
          missingModelName: !conv.modelName,
          missingProvider: !conv.provider,
        }
      );
      continue;
    }

    const conversationKey = `${conv.workspaceId || ""}:${conv.agentId || ""}:${""}:${dateStr}`;
    if (!conversationCountMap.has(conversationKey)) {
      conversationCountMap.set(conversationKey, new Set());
    }
    conversationCountMap.get(conversationKey)!.add(conv.conversationId);

    const messages = (conv.messages || []) as Array<{ role?: string }>;
    let userMessageCount = 0;
    let assistantMessageCount = 0;
    for (const message of messages) {
      if (message.role === "user") {
        userMessageCount++;
      } else if (message.role === "assistant") {
        assistantMessageCount++;
      }
    }

    if (!messageCountMap.has(conversationKey)) {
      messageCountMap.set(conversationKey, {
        messagesIn: 0,
        messagesOut: 0,
        totalMessages: 0,
      });
    }
    const messageCounts = messageCountMap.get(conversationKey)!;
    messageCounts.messagesIn += userMessageCount;
    messageCounts.messagesOut += assistantMessageCount;
    messageCounts.totalMessages += userMessageCount + assistantMessageCount;

    const tokenUsage = conv.tokenUsage;
    const supplier = extractSupplierFromModelName(conv.modelName);
    const key = `${conv.workspaceId || ""}:${conv.agentId || ""}:${
      conv.modelName
    }:${supplier}:${conv.usesByok ? "byok" : "platform"}`;

    if (!aggregates.has(key)) {
      aggregates.set(key, {
        workspaceId: conv.workspaceId,
        agentId: conv.agentId,
        modelName: conv.modelName,
        provider: supplier,
        usesByok: conv.usesByok === true,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      });
    }

    const agg = aggregates.get(key)!;
    agg.inputTokens += tokenUsage.promptTokens || 0;
    agg.outputTokens += tokenUsage.completionTokens || 0;
    agg.totalTokens += tokenUsage.totalTokens || 0;
  }

  const conversationCounts = new Map<string, number>();
  for (const [key, conversationIds] of conversationCountMap.entries()) {
    conversationCounts.set(key, conversationIds.size);
  }

  return { aggregates, conversationCounts, messageCountMap };
};

const writeTokenUsageAggregates = async (params: {
  db: Awaited<ReturnType<typeof database>>;
  aggregates: Map<string, TokenUsageAggregateInput>;
  conversationCounts: Map<string, number>;
  messageCountMap: Map<string, ConversationMessageCounts>;
  dateStr: string;
}): Promise<void> => {
  for (const [, aggData] of params.aggregates.entries()) {
    if (!aggData.workspaceId) {
      continue;
    }
    const pk = `aggregates/${aggData.workspaceId}/${params.dateStr}`;
    const sk = `${aggData.agentId || "workspace"}:${aggData.modelName}:${
      aggData.provider
    }:${aggData.usesByok ? "byok" : "platform"}`;

    const conversationKey = `${aggData.workspaceId || ""}:${aggData.agentId || ""}:${""}:${params.dateStr}`;
    const conversationCount = params.conversationCounts.get(conversationKey) || 0;
    const messageCounts =
      params.messageCountMap.get(conversationKey) || {
        messagesIn: 0,
        messagesOut: 0,
        totalMessages: 0,
      };

    const agentIdDate = `${aggData.agentId ?? "workspace"}#${params.dateStr}`;
    const aggregate: Omit<TokenUsageAggregateRecord, "version"> = {
      pk,
      sk,
      date: params.dateStr,
      aggregateType: aggData.agentId ? "agent" : "workspace",
      workspaceId: aggData.workspaceId,
      agentId: aggData.agentId,
      agentIdDate,
      modelName: aggData.modelName,
      provider: aggData.provider,
      usesByok: aggData.usesByok ? true : undefined,
      inputTokens: aggData.inputTokens,
      outputTokens: aggData.outputTokens,
      totalTokens: aggData.totalTokens,
      costUsd: 0,
      conversationCount,
      messagesIn: messageCounts.messagesIn,
      messagesOut: messageCounts.messagesOut,
      totalMessages: messageCounts.totalMessages,
      createdAt: new Date().toISOString(),
    };

    await params.db["token-usage-aggregates"].upsert(aggregate);
  }
};

const fetchToolTransactions = async (params: {
  db: Awaited<ReturnType<typeof database>>;
  workspaceIds: string[];
  startOfDay: Date;
  endOfDay: Date;
}): Promise<WorkspaceCreditTransactionRecord[]> => {
  const allTransactions: WorkspaceCreditTransactionRecord[] = [];

  try {
    for (const workspaceId of params.workspaceIds) {
      try {
        const workspacePk = `workspaces/${workspaceId}`;
        const workspaceToolTransactions: WorkspaceCreditTransactionRecord[] = [];

        for await (const transaction of params.db[
          "workspace-credit-transactions"
        ].queryAsync({
          KeyConditionExpression: "pk = :pk",
          ExpressionAttributeNames: {
            "#createdAt": "createdAt",
          },
          ExpressionAttributeValues: {
            ":pk": workspacePk,
            ":startDate": params.startOfDay.toISOString(),
            ":endDate": params.endOfDay.toISOString(),
          },
          FilterExpression: "#createdAt BETWEEN :startDate AND :endDate",
        })) {
          if (transaction.source === "tool-execution") {
            workspaceToolTransactions.push(transaction);
          }
        }

        if (workspaceToolTransactions.length > 0) {
          allTransactions.push(...workspaceToolTransactions);
        }
      } catch (workspaceError) {
        console.error(
          `[Aggregate Token Usage] Error querying transactions for workspace ${workspaceId}:`,
          workspaceError instanceof Error
            ? workspaceError.message
            : String(workspaceError)
        );
        Sentry.captureException(ensureError(workspaceError), {
          tags: {
            context: "aggregation",
            operation: "query-workspace-transactions",
          },
        });
      }
    }

    console.log(
      `[Aggregate Token Usage] Total tool transactions found: ${allTransactions.length}`
    );
  } catch (error) {
    console.error("[Aggregate Token Usage] Error aggregating transactions:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      date: formatDate(params.startOfDay),
    });
    throw error;
  }

  return allTransactions;
};

export const buildToolAggregates = (
  transactions: WorkspaceCreditTransactionRecord[]
): Map<string, ToolAggregateInput> => {
  const toolAggregates = new Map<string, ToolAggregateInput>();

  for (const txn of transactions) {
    const toolCall = txn.tool_call || "unknown";
    const supplier = txn.supplier || "unknown";
    const key = `${txn.workspaceId || ""}:${txn.agentId || ""}:${toolCall}:${supplier}`;

    if (!toolAggregates.has(key)) {
      toolAggregates.set(key, {
        workspaceId: txn.workspaceId,
        agentId: txn.agentId,
        toolCall,
        supplier,
        costUsd: 0,
        callCount: 0,
      });
    }

    const agg = toolAggregates.get(key)!;
    const rawAmount = txn.amountNanoUsd || 0;
    const costUsd = rawAmount < 0 ? -rawAmount : 0;
    agg.costUsd += costUsd;
    agg.callCount += 1;
  }

  return toolAggregates;
};

const writeToolUsageAggregates = async (params: {
  db: Awaited<ReturnType<typeof database>>;
  toolAggregates: Map<string, ToolAggregateInput>;
  dateStr: string;
}): Promise<void> => {
  for (const [, aggData] of params.toolAggregates.entries()) {
    if (!aggData.workspaceId) {
      continue;
    }
    const pk = `tool-aggregates/${aggData.workspaceId}/${params.dateStr}`;
    const sk = `${aggData.toolCall}:${aggData.supplier}`;

    const agentIdDate = `${aggData.agentId ?? "workspace"}#${params.dateStr}`;
    const aggregate: Omit<ToolUsageAggregateRecord, "version"> = {
      pk,
      sk,
      date: params.dateStr,
      aggregateType: aggData.agentId ? "agent" : "workspace",
      workspaceId: aggData.workspaceId,
      agentId: aggData.agentId,
      agentIdDate,
      toolCall: aggData.toolCall,
      supplier: aggData.supplier,
      costUsd: aggData.costUsd,
      callCount: aggData.callCount,
      createdAt: new Date().toISOString(),
    };

    await params.db["tool-usage-aggregates"].upsert(aggregate);
  }
};

/**
 * Aggregate token usage from conversations for a specific date
 */
export async function aggregateTokenUsageForDate(date: Date): Promise<void> {
  const db = await database();
  const { dateStr, startOfDay, endOfDay } = getDateRange(date);

  console.log(`[Aggregate Token Usage] Aggregating usage for date: ${dateStr}`);

  // Get all conversations from the previous day
  const workspaceIds = await fetchWorkspaceIds(db);

  console.log(
    `[Aggregate Token Usage] Found ${workspaceIds.length} workspaces to process`
  );

  // Query all conversations for the target date
  const allConversations: AgentConversationRecord[] = [];

  try {
    console.log(
      `[Aggregate Token Usage] Querying conversations for date range: ${startOfDay.toISOString()} to ${endOfDay.toISOString()}`
    );

    for (const workspaceId of workspaceIds) {
      const workspaceConversations = await fetchConversationsForWorkspace({
        db,
        workspaceId,
        startOfDay,
        endOfDay,
      });
      allConversations.push(...workspaceConversations);
    }

    console.log(
      `[Aggregate Token Usage] Total conversations found: ${allConversations.length}`
    );
  } catch (error) {
    console.error("[Aggregate Token Usage] Error aggregating conversations:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      date: dateStr,
    });
    throw error;
  }

  const { aggregates, conversationCounts, messageCountMap } =
    buildConversationAggregates(allConversations, dateStr);

  await writeTokenUsageAggregates({
    db,
    aggregates,
    conversationCounts,
    messageCountMap,
    dateStr,
  });

  console.log(
    `[Aggregate Token Usage] Created ${aggregates.size} token aggregate records for ${dateStr}`
  );

  // Now aggregate tool expenses from transactions
  console.log(
    `[Aggregate Token Usage] Aggregating tool expenses from transactions for date: ${dateStr}`
  );

  const allTransactions = await fetchToolTransactions({
    db,
    workspaceIds,
    startOfDay,
    endOfDay,
  });

  const toolAggregates = buildToolAggregates(allTransactions);

  await writeToolUsageAggregates({
    db,
    toolAggregates,
    dateStr,
  });

  console.log(
    `[Aggregate Token Usage] Created ${toolAggregates.size} tool aggregate records for ${dateStr}`
  );
}

/**
 * Aggregate token usage for the previous day
 */
export async function aggregatePreviousDay(): Promise<void> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  await aggregateTokenUsageForDate(yesterday);
}

/**
 * Lambda handler for scheduled aggregation
 */
export const handler = handlingScheduledErrors(
  async (event: ScheduledEvent): Promise<void> => {
    console.log("[Aggregate Token Usage] Scheduled event received:", event);
    await aggregatePreviousDay();
  }
);
