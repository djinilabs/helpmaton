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
  let reasoningTokens = 0;

  for (const usage of usages) {
    if (usage) {
      promptTokens += usage.promptTokens || 0;
      completionTokens += usage.completionTokens || 0;
      reasoningTokens += usage.reasoningTokens || 0;
    }
  }

  // Recalculate totalTokens to ensure it's always the sum of components
  // This ensures consistency: totalTokens = promptTokens + completionTokens + reasoningTokens
  const totalTokens = promptTokens + completionTokens + (reasoningTokens || 0);

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    reasoningTokens: reasoningTokens > 0 ? reasoningTokens : undefined,
  };
}

/**
 * Normalize message content for comparison
 * Converts content to a consistent string representation for reliable matching
 */
function normalizeMessageContent(content: UIMessage["content"]): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    // For array content, extract text parts and normalize
    const textParts: string[] = [];
    for (const part of content) {
      if (typeof part === "string") {
        textParts.push(part.trim());
      } else if (
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        textParts.push(part.text.trim());
      }
    }
    return textParts.join(" ").trim();
  }
  return "";
}

/**
 * Check if a message already exists in the conversation
 */
function messageExists(
  message: UIMessage,
  existingMessages: UIMessage[]
): boolean {
  const normalizedContent = normalizeMessageContent(message.content);
  return existingMessages.some((existingMsg) => {
    if (existingMsg.role !== message.role) {
      return false;
    }
    const existingNormalized = normalizeMessageContent(existingMsg.content);
    return existingNormalized === normalizedContent;
  });
}

/**
 * Merge messages from existing conversation with new messages
 * For each new message, if it doesn't already exist, append it
 * When appending a new assistant message, include the given tokenUsage
 */
export function mergeMessages(
  existingMessages: UIMessage[],
  newMessages: UIMessage[],
  tokenUsage?: TokenUsage
): UIMessage[] {
  console.log("mergeMessages", { existingMessages, newMessages, tokenUsage });
  const merged = [...existingMessages];

  for (const newMsg of newMessages) {
    // Check if message already exists
    if (!messageExists(newMsg, merged)) {
      // Append message as-is
      merged.push(newMsg);
    }
  }

  const lastMessage = merged[merged.length - 1];
  if (!lastMessage.tokenUsage && tokenUsage) {
    lastMessage.tokenUsage = tokenUsage;
  }

  return merged;
}

/**
 * Extract token usage from generateText or streamText result
 * Handles Google AI SDK response format including reasoning tokens
 * For streamText, usage is a Promise that needs to be awaited
 */
export async function extractTokenUsage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any
): Promise<TokenUsage | undefined> {
  if (!result || typeof result !== "object") {
    return undefined;
  }

  // For streamText, usage is a Promise that needs to be awaited
  // For generateText, usage is a direct object
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let usage: any;
  if (result.usage && typeof result.usage.then === "function") {
    // usage is a Promise
    try {
      usage = await result.usage;
    } catch (error) {
      console.warn("[extractTokenUsage] Error awaiting usage Promise:", error);
      return undefined;
    }
  } else {
    usage = result.usage;
  }

  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  // Handle both field name variations:
  // - promptTokens/completionTokens (standard AI SDK format)
  // - inputTokens/outputTokens (some provider adapters use these)
  const promptTokens = usage.promptTokens ?? usage.inputTokens ?? 0;
  const completionTokens = usage.completionTokens ?? usage.outputTokens ?? 0;

  // Extract reasoning tokens if present (Google AI SDK may provide this)
  // Reasoning tokens can be in various formats:
  // - reasoningTokens (direct field)
  // - usage.reasoningTokens
  // - nested in usage object
  const reasoningTokens =
    usage.reasoningTokens ?? usage.reasoning ?? result.reasoningTokens ?? 0;

  // Recalculate totalTokens to ensure it's always promptTokens + completionTokens + reasoningTokens
  // This ensures consistency: totalTokens should always equal the sum of its components
  // However, if we have API's totalTokens but missing breakdown, use API's value
  const calculatedTotal =
    promptTokens + completionTokens + (reasoningTokens || 0);
  const apiTotalTokens = usage.totalTokens ?? 0;

  // Use calculated total if we have component values, otherwise fall back to API's totalTokens
  // This handles edge cases where API only provides totalTokens without breakdown
  const totalTokens = calculatedTotal > 0 ? calculatedTotal : apiTotalTokens;

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
 * Create or update a conversation
 * Uses atomicUpdate to handle race conditions
 */
export async function createOrUpdateConversation(
  db: DatabaseSchema,
  workspaceId: string,
  agentId: string,
  conversationId: string | undefined,
  messages: UIMessage[],
  tokenUsage: TokenUsage | undefined,
  conversationType: "test" | "webhook" | "stream",
  modelName?: string,
  provider?: string,
  usesByok?: boolean
): Promise<string> {
  const finalConversationId = conversationId || randomUUID();
  const now = new Date().toISOString();
  const pk = `conversations/${workspaceId}/${agentId}/${finalConversationId}`;

  await db["agent-conversations"].atomicUpdate(
    pk,
    undefined,
    async (existing) => {
      // If conversation doesn't exist, create it
      if (!existing) {
        const toolCalls = extractToolCalls(messages);
        const toolResults = extractToolResults(messages);
        const costs = calculateConversationCosts(
          provider,
          modelName,
          tokenUsage
        );

        return {
          pk,
          workspaceId,
          agentId,
          conversationId: finalConversationId,
          conversationType,
          messages: messages as unknown[],
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          toolResults: toolResults.length > 0 ? toolResults : undefined,
          tokenUsage,
          modelName,
          provider,
          usesByok,
          costUsd: costs.usd > 0 ? costs.usd : undefined,
          costEur: costs.eur > 0 ? costs.eur : undefined,
          costGbp: costs.gbp > 0 ? costs.gbp : undefined,
          startedAt: now,
          lastMessageAt: now,
          expires: calculateTTL(),
        };
      }

      // Update existing conversation
      const existingMessages = (existing.messages || []) as UIMessage[];
      const allMessages = mergeMessages(existingMessages, messages, tokenUsage);

      const toolCalls = extractToolCalls(allMessages);
      const toolResults = extractToolResults(allMessages);

      // Aggregate token usage: existing conversation-level + new tokenUsage
      const existingTokenUsage = existing.tokenUsage as TokenUsage | undefined;
      const aggregatedTokenUsage = aggregateTokenUsage(
        existingTokenUsage,
        tokenUsage
      );

      const finalProvider = existing.provider || provider;
      const finalModelName = existing.modelName || modelName;
      const costs = calculateConversationCosts(
        finalProvider,
        finalModelName,
        aggregatedTokenUsage
      );

      return {
        pk,
        workspaceId: existing.workspaceId,
        agentId: existing.agentId,
        conversationId: existing.conversationId,
        conversationType: existing.conversationType,
        messages: allMessages as unknown[],
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        toolResults: toolResults.length > 0 ? toolResults : undefined,
        tokenUsage: aggregatedTokenUsage,
        modelName: finalModelName,
        provider: finalProvider,
        usesByok:
          existing.usesByok !== undefined ? existing.usesByok : usesByok,
        costUsd: costs.usd > 0 ? costs.usd : undefined,
        costEur: costs.eur > 0 ? costs.eur : undefined,
        costGbp: costs.gbp > 0 ? costs.gbp : undefined,
        startedAt: existing.startedAt,
        lastMessageAt: now,
        expires: calculateTTL(),
      };
    }
  );

  return finalConversationId;
}

/**
 * @deprecated Use createOrUpdateConversation instead
 * Start a new conversation
 * Uses atomicUpdate to handle race conditions when creating conversations
 */
export async function startConversation(
  db: DatabaseSchema,
  data: Omit<
    ConversationLogData,
    "conversationId" | "startedAt" | "lastMessageAt"
  >
): Promise<string> {
  return createOrUpdateConversation(
    db,
    data.workspaceId,
    data.agentId,
    undefined,
    data.messages,
    data.tokenUsage,
    data.conversationType,
    data.modelName,
    data.provider,
    data.usesByok
  );
}

/**
 * @deprecated Use createOrUpdateConversation instead
 * Update an existing conversation with new messages and token usage
 * Uses atomicUpdate to handle race conditions when updating conversations
 */
export async function updateConversation(
  db: DatabaseSchema,
  workspaceId: string,
  agentId: string,
  conversationId: string,
  newMessages: UIMessage[],
  additionalTokenUsage?: TokenUsage,
  modelName?: string,
  provider?: string,
  usesByok?: boolean
): Promise<void> {
  await createOrUpdateConversation(
    db,
    workspaceId,
    agentId,
    conversationId,
    newMessages,
    additionalTokenUsage,
    "test", // Default type for backwards compatibility
    modelName,
    provider,
    usesByok
  );
}
