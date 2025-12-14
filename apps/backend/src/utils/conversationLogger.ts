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
      // Check if newMessages already contains the existing messages (full history replacement)
      // vs. just new messages to append (incremental update)
      const existingMessages = (existing.messages || []) as UIMessage[];

      // If newMessages starts with the same messages as existing, it's likely a full history replacement
      // This happens when the request body contains the full conversation history (e.g., streaming endpoint)
      // Use normalized content for comparison to be consistent with our matching logic
      const isFullHistoryReplacement =
        existingMessages.length > 0 &&
        newMessages.length >= existingMessages.length &&
        existingMessages.every((existingMsg, index) => {
          const newMsg = newMessages[index];
          if (!newMsg || !existingMsg) return false;
          // Use normalized content for comparison to match our matching logic
          const existingNormalized = normalizeMessageContent(
            existingMsg.content
          );
          const newNormalized = normalizeMessageContent(newMsg.content);
          return (
            existingMsg.role === newMsg.role &&
            existingNormalized === newNormalized
          );
        });

      // If it's a full history replacement, preserve tokenUsage from existing assistant messages
      // Otherwise, merge existing with new (incremental update)
      let allMessages: UIMessage[];
      if (isFullHistoryReplacement) {
        // For full history replacement, use position-based matching first (most reliable)
        // then fall back to content-based matching for robustness
        // Create a map of existing assistant messages by normalized content as fallback
        const existingAssistantMessagesByContent = new Map<string, UIMessage>();
        for (const existingMsg of existingMessages) {
          if (existingMsg.role === "assistant") {
            const normalizedContent = normalizeMessageContent(
              existingMsg.content
            );
            // Only store if not already in map (first occurrence wins)
            // This handles duplicate content, preferring the first match
            if (!existingAssistantMessagesByContent.has(normalizedContent)) {
              existingAssistantMessagesByContent.set(
                normalizedContent,
                existingMsg
              );
            }
          }
        }

        // Preserve tokenUsage from existing assistant messages
        // Try position-based matching first (since it's full history replacement, positions should align)
        // Fall back to content-based matching if position-based fails
        allMessages = newMessages.map((newMsg, index) => {
          // Only process assistant messages
          if (newMsg.role === "assistant") {
            // First, try to match by position (most reliable for full history replacement)
            const existingMsgAtPosition = existingMessages[index];
            let matchingExistingMsg: UIMessage | undefined;

            if (
              existingMsgAtPosition &&
              existingMsgAtPosition.role === "assistant"
            ) {
              // Check if content matches at this position
              const existingNormalized = normalizeMessageContent(
                existingMsgAtPosition.content
              );
              const newNormalized = normalizeMessageContent(newMsg.content);
              if (existingNormalized === newNormalized) {
                matchingExistingMsg = existingMsgAtPosition;
              }
            }

            // If position-based matching failed, try content-based matching
            if (!matchingExistingMsg) {
              const normalizedContent = normalizeMessageContent(newMsg.content);
              matchingExistingMsg =
                existingAssistantMessagesByContent.get(normalizedContent);
            }

            if (matchingExistingMsg) {
              // Found a matching existing message - this is an existing message, not a new one
              // ALWAYS preserve existing tokenUsage for messages that already existed
              // Never overwrite existing tokenUsage with undefined or new values
              const existingTokenUsage =
                "tokenUsage" in matchingExistingMsg &&
                matchingExistingMsg.tokenUsage
                  ? (matchingExistingMsg.tokenUsage as TokenUsage)
                  : undefined;

              // Always preserve existing tokenUsage if it exists
              // Only use new tokenUsage if existing message doesn't have any
              // (this handles edge cases where existing message was created without tokenUsage)
              if (existingTokenUsage) {
                return {
                  ...newMsg,
                  tokenUsage: existingTokenUsage,
                };
              } else if (newMsg.tokenUsage) {
                // Existing message has no tokenUsage, but new message does - use it
                return {
                  ...newMsg,
                  tokenUsage: newMsg.tokenUsage,
                };
              }
            }
          }
          return newMsg;
        });

        // Defensive fallback: If matching failed for any reason, try to preserve tokenUsage
        // from existing messages by position (for full history replacement, positions should align)
        allMessages = allMessages.map((msg, index) => {
          if (
            msg.role === "assistant" &&
            (!("tokenUsage" in msg) || !msg.tokenUsage) &&
            index < existingMessages.length
          ) {
            const existingMsgAtPosition = existingMessages[index];
            if (
              existingMsgAtPosition &&
              existingMsgAtPosition.role === "assistant" &&
              "tokenUsage" in existingMsgAtPosition &&
              existingMsgAtPosition.tokenUsage
            ) {
              // Preserve tokenUsage from existing message at this position
              return {
                ...msg,
                tokenUsage: existingMsgAtPosition.tokenUsage as TokenUsage,
              };
            }
          }
          return msg;
        });

        // After preserving tokenUsage, try to recover tokenUsage for assistant messages
        // that still don't have it by inferring from conversation-level tokenUsage
        // This handles cases where messages were created without tokenUsage
        const assistantMessagesWithoutTokenUsage = allMessages
          .map((msg, idx) => ({ msg, idx }))
          .filter(
            ({ msg }) =>
              msg.role === "assistant" &&
              typeof msg === "object" &&
              msg !== null &&
              (!("tokenUsage" in msg) || !msg.tokenUsage)
          );
        const assistantMessagesWithTokenUsage = allMessages.filter(
          (msg) =>
            msg.role === "assistant" &&
            typeof msg === "object" &&
            msg !== null &&
            "tokenUsage" in msg &&
            msg.tokenUsage
        );

        // Try to recover tokenUsage for assistant messages that don't have it
        // by inferring from conversation-level tokenUsage when we have exactly
        // one message without tokenUsage and one with tokenUsage
        if (
          assistantMessagesWithoutTokenUsage.length === 1 &&
          assistantMessagesWithTokenUsage.length === 1 &&
          existing.tokenUsage
        ) {
          const existingTokenUsage = existing.tokenUsage as TokenUsage;
          const knownTokenUsage = assistantMessagesWithTokenUsage[0] as {
            tokenUsage: TokenUsage;
          };
          const knownUsage = knownTokenUsage.tokenUsage;

          // Calculate inferred tokenUsage: existing total - known tokenUsage
          // This works when existing conversation-level tokenUsage represents
          // the sum of all messages, and we're subtracting the known message's tokenUsage
          const inferredTokenUsage: TokenUsage = {
            promptTokens:
              existingTokenUsage.promptTokens - knownUsage.promptTokens,
            completionTokens:
              existingTokenUsage.completionTokens - knownUsage.completionTokens,
            totalTokens:
              existingTokenUsage.totalTokens - knownUsage.totalTokens,
          };

          // Only use inferred tokenUsage if values are non-negative and reasonable
          // (i.e., the existing tokenUsage is greater than the known tokenUsage,
          // which suggests it represents the sum of multiple messages)
          if (
            inferredTokenUsage.promptTokens >= 0 &&
            inferredTokenUsage.completionTokens >= 0 &&
            inferredTokenUsage.totalTokens >= 0 &&
            (inferredTokenUsage.promptTokens > 0 ||
              inferredTokenUsage.completionTokens > 0 ||
              inferredTokenUsage.totalTokens > 0)
          ) {
            // Add reasoningTokens if both have them
            if (
              existingTokenUsage.reasoningTokens &&
              knownUsage.reasoningTokens
            ) {
              inferredTokenUsage.reasoningTokens =
                existingTokenUsage.reasoningTokens - knownUsage.reasoningTokens;
            } else if (existingTokenUsage.reasoningTokens) {
              // If only existing has reasoningTokens, assign all to the inferred message
              inferredTokenUsage.reasoningTokens =
                existingTokenUsage.reasoningTokens;
            }

            // Update the message without tokenUsage
            const { idx } = assistantMessagesWithoutTokenUsage[0];
            const currentMsg = allMessages[idx];
            if (
              currentMsg &&
              typeof currentMsg === "object" &&
              currentMsg.role === "assistant"
            ) {
              allMessages[idx] = {
                ...currentMsg,
                tokenUsage: inferredTokenUsage,
              } as UIMessage;
            }
          }
        }
      } else {
        // Incremental update: append new messages to existing ones
        // But still try to preserve tokenUsage from existing messages if any new messages
        // match existing ones by content (this handles cases where full history detection failed)
        const existingAssistantMessagesByContent = new Map<string, UIMessage>();
        for (const existingMsg of existingMessages) {
          if (existingMsg.role === "assistant") {
            const normalizedContent = normalizeMessageContent(
              existingMsg.content
            );
            if (!existingAssistantMessagesByContent.has(normalizedContent)) {
              existingAssistantMessagesByContent.set(
                normalizedContent,
                existingMsg
              );
            }
          }
        }

        // Append new messages, preserving tokenUsage from existing messages if they match
        const preservedNewMessages = newMessages.map((newMsg) => {
          if (newMsg.role === "assistant") {
            const normalizedContent = normalizeMessageContent(newMsg.content);
            const matchingExistingMsg =
              existingAssistantMessagesByContent.get(normalizedContent);

            if (matchingExistingMsg) {
              // Found a matching existing message - preserve its tokenUsage
              const existingTokenUsage =
                "tokenUsage" in matchingExistingMsg &&
                matchingExistingMsg.tokenUsage
                  ? (matchingExistingMsg.tokenUsage as TokenUsage)
                  : undefined;

              if (existingTokenUsage) {
                // Preserve existing tokenUsage
                return {
                  ...newMsg,
                  tokenUsage: existingTokenUsage,
                };
              }
            }
          }
          // No match or not an assistant message - use new message as-is
          return newMsg;
        });

        allMessages = [...existingMessages, ...preservedNewMessages];
      }

      // Extract all tool calls and results from merged messages
      const toolCalls = extractToolCalls(allMessages);
      const toolResults = extractToolResults(allMessages);

      // Aggregate token usage
      // For full history replacement, try to recalculate from all message-level tokenUsage values
      // to ensure accuracy (in case individual messages have tokenUsage preserved)
      // If message-level tokenUsage is not available, fall back to conversation-level aggregation
      let aggregatedTokenUsage: TokenUsage;
      if (isFullHistoryReplacement) {
        // Extract tokenUsage from all assistant messages in the merged messages
        const messageTokenUsages = allMessages
          .filter(
            (msg) =>
              msg.role === "assistant" &&
              typeof msg === "object" &&
              msg !== null &&
              "tokenUsage" in msg &&
              msg.tokenUsage
          )
          .map((msg) => (msg as { tokenUsage: TokenUsage }).tokenUsage);

        // Check if the last assistant message already has tokenUsage
        // (if it does, we don't need to add additionalTokenUsage to avoid double-counting)
        const lastAssistantMessage = allMessages
          .slice()
          .reverse()
          .find((msg) => msg.role === "assistant");
        const lastMessageHasTokenUsage =
          lastAssistantMessage &&
          typeof lastAssistantMessage === "object" &&
          lastAssistantMessage !== null &&
          "tokenUsage" in lastAssistantMessage &&
          lastAssistantMessage.tokenUsage;

        // If we have message-level tokenUsage values, use those
        // Only include additionalTokenUsage if the last message doesn't already have tokenUsage
        if (messageTokenUsages.length > 0) {
          // Include additionalTokenUsage only if the last assistant message doesn't have it
          const allTokenUsages =
            additionalTokenUsage && !lastMessageHasTokenUsage
              ? [...messageTokenUsages, additionalTokenUsage]
              : messageTokenUsages;

          // Aggregate all message-level tokenUsage values
          // This will correctly preserve reasoningTokens from all messages
          aggregatedTokenUsage = aggregateTokenUsage(...allTokenUsages);
        } else if (additionalTokenUsage) {
          // No message-level tokenUsage found in newMessages, but we have additionalTokenUsage
          // Also check existing messages for tokenUsage that might not have been preserved
          const existingMessageTokenUsages = existingMessages
            .filter(
              (msg): msg is UIMessage =>
                msg &&
                typeof msg === "object" &&
                "role" in msg &&
                msg.role === "assistant" &&
                "tokenUsage" in msg &&
                !!msg.tokenUsage
            )
            .map((msg) => (msg as { tokenUsage: TokenUsage }).tokenUsage);

          const existingTokenUsage = existing.tokenUsage as
            | TokenUsage
            | undefined;

          // Aggregate: existing conversation-level + existing message-level + new tokenUsage
          // This ensures we capture all tokenUsage including reasoningTokens
          aggregatedTokenUsage = aggregateTokenUsage(
            existingTokenUsage,
            ...existingMessageTokenUsages,
            additionalTokenUsage
          );
        } else {
          // No tokenUsage at all, use existing conversation-level tokenUsage
          const existingTokenUsage = existing.tokenUsage as
            | TokenUsage
            | undefined;
          aggregatedTokenUsage = existingTokenUsage || {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
          };
        }
      } else {
        // For incremental updates, use existing conversation-level tokenUsage + new tokenUsage
        const existingTokenUsage = existing.tokenUsage as
          | TokenUsage
          | undefined;
        aggregatedTokenUsage = aggregateTokenUsage(
          existingTokenUsage,
          additionalTokenUsage
        );
      }

      // Recalculate costs with aggregated token usage
      // Use existing values if available, otherwise fall back to function parameters
      const finalProvider = existing.provider || provider;
      const finalModelName = existing.modelName || modelName;
      const costs = calculateConversationCosts(
        finalProvider,
        finalModelName,
        aggregatedTokenUsage
      );

      // Update conversation - always return a complete record with all required fields
      // Preserve all existing fields and only update the ones that should change
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
        modelName: existing.modelName || modelName,
        provider: existing.provider || provider,
        usesByok:
          existing.usesByok !== undefined ? existing.usesByok : usesByok,
        costUsd: costs.usd > 0 ? costs.usd : undefined,
        costEur: costs.eur > 0 ? costs.eur : undefined,
        costGbp: costs.gbp > 0 ? costs.gbp : undefined,
        startedAt: existing.startedAt, // Preserve original conversation start time
        lastMessageAt: new Date().toISOString(),
        expires: calculateTTL(),
      };
    }
  );
}
