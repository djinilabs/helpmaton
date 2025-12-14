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

  // Use atomicUpdate to atomically create the conversation
  // This handles race conditions if the same conversationId is created concurrently
  await db["agent-conversations"].atomicUpdate(
    pk,
    undefined,
    async (current) => {
      // If conversation already exists (shouldn't happen with UUID, but handle gracefully)
      if (current) {
        // Merge messages if conversation exists
        const existingMessages = (current.messages || []) as UIMessage[];
        const allMessages = [...existingMessages, ...data.messages];

        // Extract all tool calls and results from merged messages
        const mergedToolCalls = extractToolCalls(allMessages);
        const mergedToolResults = extractToolResults(allMessages);

        // Aggregate token usage
        const existingTokenUsage = current.tokenUsage as TokenUsage | undefined;
        const aggregatedTokenUsage = aggregateTokenUsage(
          existingTokenUsage,
          data.tokenUsage
        );

        // Recalculate costs with aggregated token usage
        const mergedCosts = calculateConversationCosts(
          current.provider || data.provider,
          current.modelName || data.modelName,
          aggregatedTokenUsage
        );

        return {
          pk,
          workspaceId: data.workspaceId,
          agentId: data.agentId,
          conversationId,
          conversationType: data.conversationType,
          messages: allMessages as unknown[],
          toolCalls: mergedToolCalls.length > 0 ? mergedToolCalls : undefined,
          toolResults:
            mergedToolResults.length > 0 ? mergedToolResults : undefined,
          tokenUsage: aggregatedTokenUsage,
          modelName: current.modelName || data.modelName,
          provider: current.provider || data.provider,
          usesByok:
            current.usesByok !== undefined ? current.usesByok : data.usesByok,
          costUsd: mergedCosts.usd > 0 ? mergedCosts.usd : undefined,
          costEur: mergedCosts.eur > 0 ? mergedCosts.eur : undefined,
          costGbp: mergedCosts.gbp > 0 ? mergedCosts.gbp : undefined,
          startedAt: current.startedAt, // Preserve original conversation start time
          lastMessageAt: now,
          expires: calculateTTL(),
        };
      }

      // Create new conversation
      return {
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
      };
    }
  );

  return conversationId;
}

/**
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
  const pk = `conversations/${workspaceId}/${agentId}/${conversationId}`;

  // Use atomicUpdate to atomically read, merge, and update the conversation
  await db["agent-conversations"].atomicUpdate(
    pk,
    undefined,
    async (existing) => {
      // If conversation doesn't exist, create it
      if (!existing) {
        const now = new Date().toISOString();
        const toolCalls = extractToolCalls(newMessages);
        const toolResults = extractToolResults(newMessages);

        // Calculate costs for new conversation
        const finalProvider = provider;
        const finalModelName = modelName;
        const finalUsesByok = usesByok;
        const costs = calculateConversationCosts(
          finalProvider,
          finalModelName,
          additionalTokenUsage
        );

        return {
          pk,
          workspaceId,
          agentId,
          conversationId,
          conversationType: "test", // Default to test if updating non-existent conversation
          messages: newMessages as unknown[],
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          toolResults: toolResults.length > 0 ? toolResults : undefined,
          tokenUsage: additionalTokenUsage,
          modelName: finalModelName,
          provider: finalProvider,
          usesByok: finalUsesByok,
          startedAt: now,
          lastMessageAt: now,
          expires: calculateTTL(),
          costUsd: costs.usd > 0 ? costs.usd : undefined,
          costEur: costs.eur > 0 ? costs.eur : undefined,
          costGbp: costs.gbp > 0 ? costs.gbp : undefined,
        };
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
      // Use existing values if available, otherwise fall back to function parameters
      const finalProvider = existing.provider || provider;
      const finalModelName = existing.modelName || modelName;
      const costs = calculateConversationCosts(
        finalProvider,
        finalModelName,
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

      // Preserve existing modelName and provider if they exist, otherwise use function parameters
      updateData.modelName = existing.modelName || modelName;
      updateData.provider = existing.provider || provider;
      // Preserve usesByok if it exists, otherwise use function parameter
      updateData.usesByok =
        existing.usesByok !== undefined ? existing.usesByok : usesByok;

      return updateData;
    }
  );
}
