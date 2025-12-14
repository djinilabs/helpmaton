import { randomUUID } from "crypto";

import type { UIMessage } from "../http/post-api-workspaces-000workspaceId-agents-000agentId-test/utils/types";
import type { DatabaseSchema } from "../tables/schema";

import { calculateConversationCosts } from "./tokenAccounting";

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens?: number; // Reasoning tokens (if model supports reasoning)
}

export interface ConversationLogData {
  workspaceId: string;
  agentId: string;
  conversationId: string;
  conversationType: "test" | "webhook" | "stream";
  messages: UIMessage[];
  toolCalls?: unknown[];
  toolResults?: unknown[];
  tokenUsage?: TokenUsage;
  modelName?: string;
  provider?: string;
  usesByok?: boolean;
}

/**
 * Calculate TTL timestamp (30 days from now in seconds)
 */
export function calculateTTL(): number {
  return Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
}

/**
 * Extract tool calls from messages
 */
export function extractToolCalls(messages: UIMessage[]): unknown[] {
  const toolCalls: unknown[] = [];
  for (const message of messages) {
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const item of message.content) {
        if (
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          item.type === "tool-call"
        ) {
          toolCalls.push(item);
        }
      }
    }
  }
  return toolCalls;
}

/**
 * Extract tool results from messages
 */
export function extractToolResults(messages: UIMessage[]): unknown[] {
  const toolResults: unknown[] = [];
  for (const message of messages) {
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const item of message.content) {
        if (
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          item.type === "tool-result"
        ) {
          toolResults.push(item);
        }
      }
    } else if (message.role === "tool" && Array.isArray(message.content)) {
      for (const item of message.content) {
        if (
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          item.type === "tool-result"
        ) {
          toolResults.push(item);
        }
      }
    }
  }
  return toolResults;
}

/**
 * Aggregate token usage from multiple usage objects
 */
export function aggregateTokenUsage(
  ...usages: Array<TokenUsage | undefined>
): TokenUsage {
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let reasoningTokens = 0;

  for (const usage of usages) {
    if (usage) {
      promptTokens += usage.promptTokens || 0;
      completionTokens += usage.completionTokens || 0;
      totalTokens += usage.totalTokens || 0;
      reasoningTokens += usage.reasoningTokens || 0;
    }
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    reasoningTokens: reasoningTokens > 0 ? reasoningTokens : undefined,
  };
}

/**
 * Extract token usage from generateText result
 * Handles Google AI SDK response format including reasoning tokens
 */
export function extractTokenUsage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any
): TokenUsage | undefined {
  if (!result || typeof result !== "object") {
    return undefined;
  }

  const usage = result.usage;
  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  // Handle both field name variations:
  // - promptTokens/completionTokens (standard AI SDK format)
  // - inputTokens/outputTokens (some provider adapters use these)
  const promptTokens = usage.promptTokens ?? usage.inputTokens ?? 0;
  const completionTokens = usage.completionTokens ?? usage.outputTokens ?? 0;
  const totalTokens = usage.totalTokens ?? 0;

  // Extract reasoning tokens if present (Google AI SDK may provide this)
  // Reasoning tokens can be in various formats:
  // - reasoningTokens (direct field)
  // - usage.reasoningTokens
  // - nested in usage object
  const reasoningTokens =
    usage.reasoningTokens ??
    usage.reasoning ??
    result.reasoningTokens ??
    0;

  const tokenUsage: TokenUsage = {
    promptTokens,
    completionTokens,
    totalTokens,
  };

  // Only include reasoningTokens if it's greater than 0
  if (reasoningTokens > 0) {
    tokenUsage.reasoningTokens = reasoningTokens;
  }

  return tokenUsage;
}

/**
 * Start a new conversation
 */
export async function startConversation(
  db: DatabaseSchema,
  data: Omit<
    ConversationLogData,
    "conversationId" | "startedAt" | "lastMessageAt"
  >
): Promise<string> {
  const conversationId = randomUUID();
  const now = new Date().toISOString();
  const pk = `conversations/${data.workspaceId}/${data.agentId}/${conversationId}`;

  const toolCalls = extractToolCalls(data.messages);
  const toolResults = extractToolResults(data.messages);

  // Calculate costs at conversation time
  const costs = calculateConversationCosts(
    data.provider,
    data.modelName,
    data.tokenUsage
  );

  await db["agent-conversations"].create({
    pk,
    workspaceId: data.workspaceId,
    agentId: data.agentId,
    conversationId,
    conversationType: data.conversationType,
    messages: data.messages as unknown[],
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    toolResults: toolResults.length > 0 ? toolResults : undefined,
    tokenUsage: data.tokenUsage,
    modelName: data.modelName,
    provider: data.provider,
    usesByok: data.usesByok,
    costUsd: costs.usd > 0 ? costs.usd : undefined,
    costEur: costs.eur > 0 ? costs.eur : undefined,
    costGbp: costs.gbp > 0 ? costs.gbp : undefined,
    startedAt: now,
    lastMessageAt: now,
    expires: calculateTTL(),
  });

  return conversationId;
}

/**
 * Update an existing conversation with new messages and token usage
 */
export async function updateConversation(
  db: DatabaseSchema,
  workspaceId: string,
  agentId: string,
  conversationId: string,
  newMessages: UIMessage[],
  additionalTokenUsage?: TokenUsage
): Promise<void> {
  const pk = `conversations/${workspaceId}/${agentId}/${conversationId}`;

  // Get existing conversation
  const existing = await db["agent-conversations"].get(pk);
  if (!existing) {
    // If conversation doesn't exist, create it
    await startConversation(db, {
      workspaceId,
      agentId,
      conversationType: "test", // Default to test if updating non-existent conversation
      messages: newMessages,
      tokenUsage: additionalTokenUsage,
    });
    return;
  }

  // Merge messages
  const existingMessages = (existing.messages || []) as UIMessage[];
  const allMessages = [...existingMessages, ...newMessages];

  // Extract all tool calls and results from merged messages
  const toolCalls = extractToolCalls(allMessages);
  const toolResults = extractToolResults(allMessages);

  // Aggregate token usage
  const existingTokenUsage = existing.tokenUsage as TokenUsage | undefined;
  const aggregatedTokenUsage = aggregateTokenUsage(
    existingTokenUsage,
    additionalTokenUsage
  );

  // Recalculate costs with aggregated token usage
  const provider = existing.provider;
  const modelName = existing.modelName;
  const costs = calculateConversationCosts(
    provider,
    modelName,
    aggregatedTokenUsage
  );

  // Update conversation
  // Preserve existing modelName and provider if they exist, don't overwrite
  const updateData: {
    pk: string;
    messages: unknown[];
    toolCalls?: unknown[];
    toolResults?: unknown[];
    tokenUsage: TokenUsage;
    lastMessageAt: string;
    expires: number;
    modelName?: string;
    provider?: string;
    usesByok?: boolean;
    costUsd?: number;
    costEur?: number;
    costGbp?: number;
  } = {
    pk,
    messages: allMessages as unknown[],
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    toolResults: toolResults.length > 0 ? toolResults : undefined,
    tokenUsage: aggregatedTokenUsage,
    lastMessageAt: new Date().toISOString(),
    expires: calculateTTL(),
    costUsd: costs.usd > 0 ? costs.usd : undefined,
    costEur: costs.eur > 0 ? costs.eur : undefined,
    costGbp: costs.gbp > 0 ? costs.gbp : undefined,
  };

  // Preserve existing modelName and provider if they exist
  if (existing.modelName) {
    updateData.modelName = existing.modelName;
  }
  if (existing.provider) {
    updateData.provider = existing.provider;
  }
  // Preserve usesByok if it exists
  if (existing.usesByok !== undefined) {
    updateData.usesByok = existing.usesByok;
  }

  await db["agent-conversations"].update(updateData);
}
