import { randomUUID } from "crypto";

import type { UIMessage } from "../http/post-api-workspaces-000workspaceId-agents-000agentId-test/utils/types";
import type { DatabaseSchema } from "../tables/schema";

import { calculateConversationCosts } from "./tokenAccounting";

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens?: number; // Reasoning tokens (if model supports reasoning)
  cachedPromptTokens?: number; // Cached prompt tokens (if prompt caching is used)
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

  // DIAGNOSTIC: Log input messages
  console.log("[extractToolCalls] Processing messages:", {
    messagesCount: messages.length,
    messages: messages.map((msg) => ({
      role: msg.role,
      contentType: typeof msg.content,
      isArray: Array.isArray(msg.content),
      contentLength: Array.isArray(msg.content) ? msg.content.length : "N/A",
      contentPreview: Array.isArray(msg.content)
        ? msg.content.slice(0, 3).map((item) => ({
            type:
              typeof item === "object" && item !== null && "type" in item
                ? item.type
                : "unknown",
            keys:
              typeof item === "object" && item !== null
                ? Object.keys(item)
                : [],
          }))
        : "not array",
    })),
  });

  for (const message of messages) {
    if (message.role === "assistant" && Array.isArray(message.content)) {
      console.log(
        "[extractToolCalls] Processing assistant message with array content:",
        {
          contentLength: message.content.length,
          contentItems: message.content.map((item) => ({
            type: typeof item,
            isObject: typeof item === "object" && item !== null,
            hasType:
              typeof item === "object" && item !== null && "type" in item,
            typeValue:
              typeof item === "object" && item !== null && "type" in item
                ? item.type
                : undefined,
            keys:
              typeof item === "object" && item !== null
                ? Object.keys(item)
                : [],
          })),
        }
      );

      for (const item of message.content) {
        if (
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          item.type === "tool-call"
        ) {
          console.log("[extractToolCalls] Found tool call:", item);
          toolCalls.push(item);
        }
      }
    } else {
      console.log("[extractToolCalls] Skipping message:", {
        role: message.role,
        isAssistant: message.role === "assistant",
        isArray: Array.isArray(message.content),
        contentType: typeof message.content,
      });
    }
  }

  console.log("[extractToolCalls] Extracted tool calls:", {
    count: toolCalls.length,
    toolCalls: toolCalls,
  });

  return toolCalls;
}

/**
 * Normalize message content to extract text for comparison
 * Handles both string and array formats, extracting text content
 */
function normalizeContentForComparison(content: UIMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    // Extract all text from the array
    const textParts: string[] = [];
    for (const part of content) {
      if (typeof part === "string") {
        textParts.push(part);
      } else if (typeof part === "object" && part !== null && "type" in part) {
        if (part.type === "text" && "text" in part) {
          const textPart = part as { text?: unknown };
          if (typeof textPart.text === "string") {
            textParts.push(textPart.text);
          }
        }
        // For tool calls and results, include them in the key to distinguish messages
        else if (part.type === "tool-call") {
          const toolPart = part as {
            toolName?: unknown;
            args?: unknown;
          };
          textParts.push(
            `[tool-call:${String(toolPart.toolName || "")}:${JSON.stringify(
              toolPart.args || {}
            )}]`
          );
        } else if (part.type === "tool-result") {
          const toolPart = part as {
            toolName?: unknown;
            toolCallId?: unknown;
          };
          textParts.push(
            `[tool-result:${String(toolPart.toolName || "")}:${String(
              toolPart.toolCallId || ""
            )}]`
          );
        }
      }
    }
    return textParts.join("");
  }

  return String(content);
}

/**
 * Generate a unique key for a message based on its role and content
 * Used for deduplication when merging conversations
 * Normalizes content so that string and array formats with the same text are treated as duplicates
 */
function getMessageKey(message: UIMessage): string {
  const role = message.role;
  const contentKey = normalizeContentForComparison(message.content);
  return `${role}:${contentKey}`;
}

/**
 * Deduplicate messages based on role and content
 * When appending new messages, check if each is a duplicate before adding
 */
function deduplicateMessages(
  existingMessages: UIMessage[],
  newMessages: UIMessage[]
): UIMessage[] {
  // Start with existing messages
  const deduplicated: UIMessage[] = [...existingMessages];
  const seenKeys = new Set<string>();

  // Track keys of existing messages
  for (const msg of existingMessages) {
    const key = getMessageKey(msg);
    seenKeys.add(key);
  }

  // Append each new message, checking for duplicates first
  for (const newMsg of newMessages) {
    const key = getMessageKey(newMsg);

    if (!seenKeys.has(key)) {
      // Not a duplicate - add it
      deduplicated.push(newMsg);
      seenKeys.add(key);
    } else {
      // Duplicate found - check if we should update the existing one
      const existingIndex = deduplicated.findIndex(
        (msg) => getMessageKey(msg) === key
      );

      if (existingIndex >= 0) {
        const existing = deduplicated[existingIndex];

        // Check if either message has tokenUsage (can exist on any message type)
        const existingHasTokenUsage =
          "tokenUsage" in existing &&
          existing.tokenUsage &&
          typeof existing.tokenUsage === "object" &&
          "totalTokens" in existing.tokenUsage &&
          typeof (existing.tokenUsage as { totalTokens?: unknown })
            .totalTokens === "number" &&
          (existing.tokenUsage as { totalTokens: number }).totalTokens > 0;
        const newHasTokenUsage =
          "tokenUsage" in newMsg &&
          newMsg.tokenUsage &&
          typeof newMsg.tokenUsage === "object" &&
          "totalTokens" in newMsg.tokenUsage &&
          typeof (newMsg.tokenUsage as { totalTokens?: unknown })
            .totalTokens === "number" &&
          (newMsg.tokenUsage as { totalTokens: number }).totalTokens > 0;

        // Prefer array format over string format (more structured)
        const existingIsArray = Array.isArray(existing.content);
        const newIsArray = Array.isArray(newMsg.content);

        // Update existing message if:
        // 1. New has tokenUsage and existing doesn't, OR
        // 2. Both have tokenUsage but new has better format (array), OR
        // 3. New has better format and existing has no tokenUsage
        if (
          (newHasTokenUsage && !existingHasTokenUsage) ||
          (newHasTokenUsage &&
            existingHasTokenUsage &&
            newIsArray &&
            !existingIsArray) ||
          (!existingHasTokenUsage && newIsArray && !existingIsArray)
        ) {
          // Replace with new message (has tokenUsage or better format)
          deduplicated[existingIndex] = newMsg;
        } else if (
          existingHasTokenUsage &&
          !newHasTokenUsage &&
          newIsArray &&
          !existingIsArray
        ) {
          // Existing has tokenUsage, new doesn't, but new has better format - merge
          deduplicated[existingIndex] = {
            ...newMsg,
            tokenUsage: existing.tokenUsage,
          } as UIMessage;
        }
        // Otherwise keep existing (it has tokenUsage or is already in better format)
      }
    }
  }

  return deduplicated;
}

/**
 * Extract tool results from messages
 */
export function extractToolResults(messages: UIMessage[]): unknown[] {
  const toolResults: unknown[] = [];

  // DIAGNOSTIC: Log input messages
  console.log("[extractToolResults] Processing messages:", {
    messagesCount: messages.length,
  });

  for (const message of messages) {
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const item of message.content) {
        if (
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          item.type === "tool-result"
        ) {
          console.log(
            "[extractToolResults] Found tool result in assistant message:",
            item
          );
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
          console.log(
            "[extractToolResults] Found tool result in tool message:",
            item
          );
          toolResults.push(item);
        }
      }
    }
  }

  console.log("[extractToolResults] Extracted tool results:", {
    count: toolResults.length,
    toolResults: toolResults,
  });

  return toolResults;
}

/**
 * Aggregate token usage from multiple usage objects
 * Ensures reasoning tokens are included in the total
 */
export function aggregateTokenUsage(
  ...usages: Array<TokenUsage | undefined>
): TokenUsage {
  let promptTokens = 0;
  let completionTokens = 0;
  let reasoningTokens = 0;
  let cachedPromptTokens = 0;

  for (const usage of usages) {
    if (usage) {
      promptTokens += usage.promptTokens || 0;
      completionTokens += usage.completionTokens || 0;
      reasoningTokens += usage.reasoningTokens || 0;
      cachedPromptTokens += usage.cachedPromptTokens || 0;
    }
  }

  // Calculate totalTokens as the sum of prompt (including cached), completion, and reasoning tokens
  // This ensures reasoning tokens and cached prompt tokens are always included in the total
  const totalTokens =
    promptTokens + cachedPromptTokens + completionTokens + reasoningTokens;

  const aggregated: TokenUsage = {
    promptTokens,
    completionTokens,
    totalTokens,
  };

  // Only include optional fields if they're greater than 0
  if (reasoningTokens > 0) {
    aggregated.reasoningTokens = reasoningTokens;
  }
  if (cachedPromptTokens > 0) {
    aggregated.cachedPromptTokens = cachedPromptTokens;
  }

  return aggregated;
}

/**
 * Extract token usage from generateText result
 * Handles Google AI SDK response format including reasoning tokens and cached tokens
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

  // DIAGNOSTIC: Log full usage object structure for debugging
  console.log("[extractTokenUsage] Full usage object structure:", {
    usageKeys: Object.keys(usage),
    usageObject: JSON.stringify(usage, null, 2),
    resultKeys: Object.keys(result),
  });

  // Handle both field name variations:
  // - promptTokens/completionTokens (standard AI SDK format)
  // - inputTokens/outputTokens (some provider adapters use these)
  // - promptTokenCount/completionTokenCount (Google API format)
  const promptTokens =
    usage.promptTokens ?? usage.inputTokens ?? usage.promptTokenCount ?? 0;
  const completionTokens =
    usage.completionTokens ??
    usage.outputTokens ??
    usage.completionTokenCount ??
    0;
  const totalTokens = usage.totalTokens ?? usage.totalTokenCount ?? 0;

  // Extract cached prompt tokens if present (Google API may provide this)
  // Cached tokens can be in various formats:
  // - cachedPromptTokenCount (Google API format)
  // - cachedPromptTokens
  // - cachedTokens
  const cachedPromptTokens =
    usage.cachedPromptTokenCount ??
    usage.cachedPromptTokens ??
    usage.cachedTokens ??
    0;

  // Extract reasoning tokens if present (Google AI SDK may provide this)
  // Reasoning tokens can be in various formats:
  // - reasoningTokens (direct field)
  // - usage.reasoningTokens
  // - nested in usage object
  const reasoningTokens =
    usage.reasoningTokens ?? usage.reasoning ?? result.reasoningTokens ?? 0;

  // Calculate non-cached prompt tokens
  // If we have cached tokens, the promptTokens might include them
  // We need to track both separately for accurate billing
  const nonCachedPromptTokens = Math.max(0, promptTokens - cachedPromptTokens);

  // DIAGNOSTIC: Log all extracted fields
  console.log("[extractTokenUsage] Extracted token fields:", {
    promptTokens,
    completionTokens,
    totalTokens,
    cachedPromptTokens,
    nonCachedPromptTokens,
    reasoningTokens,
    allUsageFields: Object.keys(usage),
  });

  // Warn if we found unexpected fields that might be relevant
  const knownFields = [
    "promptTokens",
    "inputTokens",
    "promptTokenCount",
    "completionTokens",
    "outputTokens",
    "completionTokenCount",
    "totalTokens",
    "totalTokenCount",
    "cachedPromptTokenCount",
    "cachedPromptTokens",
    "cachedTokens",
    "reasoningTokens",
    "reasoning",
  ];
  const unexpectedFields = Object.keys(usage).filter(
    (key) => !knownFields.includes(key)
  );
  if (unexpectedFields.length > 0) {
    console.warn(
      "[extractTokenUsage] Found unexpected fields in usage object:",
      {
        unexpectedFields,
        usageObject: usage,
      }
    );
  }

  // Calculate totalTokens as the sum of prompt (including cached), completion, and reasoning tokens
  // This ensures reasoning tokens and cached prompt tokens are always included in the total
  // Use the calculated total if it's greater than the provided totalTokens
  // (some APIs might not include reasoning tokens or cached tokens in their totalTokens)
  const calculatedTotal =
    nonCachedPromptTokens +
    cachedPromptTokens +
    completionTokens +
    reasoningTokens;
  const finalTotalTokens = Math.max(totalTokens, calculatedTotal);

  const tokenUsage: TokenUsage = {
    promptTokens: nonCachedPromptTokens, // Store non-cached prompt tokens
    completionTokens,
    totalTokens: finalTotalTokens,
  };

  // Only include optional fields if they're greater than 0
  if (reasoningTokens > 0) {
    tokenUsage.reasoningTokens = reasoningTokens;
  }
  if (cachedPromptTokens > 0) {
    tokenUsage.cachedPromptTokens = cachedPromptTokens;
  }

  // DIAGNOSTIC: Log final token usage object
  console.log("[extractTokenUsage] Final token usage:", {
    tokenUsage,
    breakdown: {
      nonCachedPromptTokens,
      cachedPromptTokens,
      completionTokens,
      reasoningTokens,
      totalTokens,
    },
  });

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
    startedAt: now,
    lastMessageAt: now,
    expires: calculateTTL(),
  });

  return conversationId;
}

/**
 * Update an existing conversation with new messages and token usage
 * Uses atomicUpdate to ensure thread-safe updates
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

  // Use atomicUpdate to ensure thread-safe conversation updates
  await db["agent-conversations"].atomicUpdate(
    pk,
    undefined,
    async (existing) => {
      const now = new Date().toISOString();

      if (!existing) {
        // If conversation doesn't exist, create it
        const toolCalls = extractToolCalls(newMessages);
        const toolResults = extractToolResults(newMessages);
        const costs = calculateConversationCosts(
          "google", // Default provider
          undefined, // No model name yet
          additionalTokenUsage
        );

        return {
          pk,
          workspaceId,
          agentId,
          conversationId,
          conversationType: "test" as const, // Default to test if updating non-existent conversation
          messages: newMessages as unknown[],
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          toolResults: toolResults.length > 0 ? toolResults : undefined,
          tokenUsage: additionalTokenUsage,
          modelName: undefined,
          provider: "google",
          usesByok: undefined,
          costUsd: costs.usd > 0 ? costs.usd : undefined,
          startedAt: now,
          lastMessageAt: now,
          expires: calculateTTL(),
        };
      }

      // Merge messages, deduplicating based on role and content
      // This prevents duplicate messages when the client sends the full conversation history
      const existingMessages = (existing.messages || []) as UIMessage[];
      const allMessages = deduplicateMessages(existingMessages, newMessages);

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
      const provider = existing.provider || "google";
      const modelName = existing.modelName;
      const costs = calculateConversationCosts(
        provider,
        modelName,
        aggregatedTokenUsage
      );

      // Update conversation, preserving existing fields
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
        lastMessageAt: now,
        expires: calculateTTL(),
        costUsd: costs.usd > 0 ? costs.usd : undefined,
        // Preserve existing fields
        modelName: existing.modelName,
        provider: existing.provider || "google",
        usesByok: existing.usesByok,
        startedAt: existing.startedAt,
      };
    }
  );
}
