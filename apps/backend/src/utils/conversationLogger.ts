import { randomUUID } from "crypto";

import type { DatabaseSchema } from "../tables/schema";

import type { ConversationErrorInfo } from "./conversationErrorInfo";
import { expandMessagesWithToolCalls } from "./conversationMessageExpander";
import { writeToWorkingMemory } from "./memory/writeMemory";
import { getMessageCost } from "./messageCostCalculation";
import type { UIMessage } from "./messageTypes";
import { Sentry, ensureError } from "./sentry";

/**
 * Type representing usage information from AI SDK
 * Matches LanguageModelV2Usage structure from @ai-sdk/provider
 */
export interface LanguageModelUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens?: number;
  reasoningTokens?: number;
}

/**
 * Type representing a result from generateText that has totalUsage
 */
export interface GenerateTextResultWithTotalUsage {
  totalUsage?: LanguageModelUsage;
  usage?: LanguageModelUsage;
  steps?: Array<{ usage?: LanguageModelUsage }>;
  _steps?: {
    status?: {
      value?: Array<{ usage?: LanguageModelUsage }>;
    };
  };
}

/**
 * Type representing a result from streamText with resolved totalUsage
 * streamText returns totalUsage as a Promise, so we need to await it
 * totalUsage is LanguageModelV2Usage from AI SDK, which extractTokenUsage handles
 */
export interface StreamTextResultWithResolvedUsage {
  totalUsage: unknown; // LanguageModelV2Usage from AI SDK - extractTokenUsage handles field name variations
  usage?: unknown;
  steps?: Array<{ usage?: unknown }>;
  _steps?: {
    status?: {
      value?: Array<{ usage?: unknown }>;
    };
  };
}

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
  conversationType: "test" | "webhook" | "stream" | "scheduled";
  messages: UIMessage[];
  tokenUsage?: TokenUsage;
  usesByok?: boolean;
  error?: ConversationErrorInfo;
  awsRequestId?: string; // AWS Lambda/API Gateway request ID for this message addition
}

export { buildConversationErrorInfo } from "./conversationErrorInfo";
export type { ConversationErrorInfo } from "./conversationErrorInfo";

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
          // Validate tool call has required fields
          if (
            "toolCallId" in item &&
            "toolName" in item &&
            typeof (item as { toolCallId?: unknown }).toolCallId === "string" &&
            typeof (item as { toolName?: unknown }).toolName === "string"
          ) {
            toolCalls.push(item);
          } else {
            console.warn(
              "[extractToolCalls] Tool call missing required fields:",
              {
                hasToolCallId: "toolCallId" in item,
                hasToolName: "toolName" in item,
                toolCallIdType:
                  "toolCallId" in item
                    ? typeof (item as { toolCallId?: unknown }).toolCallId
                    : "missing",
                toolNameType:
                  "toolName" in item
                    ? typeof (item as { toolName?: unknown }).toolName
                    : "missing",
                item,
              }
            );
          }
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
 * IMPORTANT: Includes file parts in the comparison key to prevent deduplication
 * of messages with the same text but different file attachments
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
        // Include file parts in the comparison key to distinguish messages with attachments
        // This prevents deduplication of messages with the same text but different files
        else if (part.type === "file" && "file" in part) {
          const filePart = part as { file?: unknown; mediaType?: unknown };
          const fileUrl = typeof filePart.file === "string" ? filePart.file : "";
          const mediaType =
            typeof filePart.mediaType === "string" ? filePart.mediaType : "";
          textParts.push(`[file:${fileUrl}:${mediaType}]`);
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
 * Check if a message has empty content
 * Returns true if content is empty array, empty string, or array with no valid items
 */
export function isMessageContentEmpty(message: UIMessage): boolean {
  const content = message.content;

  // Empty string or only whitespace
  if (typeof content === "string") {
    return content.trim().length === 0;
  }

  // Empty array
  if (Array.isArray(content)) {
    if (content.length === 0) {
      return true;
    }

    // Check if all items are invalid/empty
    let hasValidItem = false;
    for (const item of content) {
      if (typeof item === "string" && item.trim().length > 0) {
        hasValidItem = true;
        break;
      } else if (typeof item === "object" && item !== null && "type" in item) {
        // Valid item types: text, tool-call, tool-result
        if (item.type === "text" && "text" in item) {
          const textPart = item as { text?: unknown };
          if (
            typeof textPart.text === "string" &&
            textPart.text.trim().length > 0
          ) {
            hasValidItem = true;
            break;
          }
        } else if (item.type === "tool-call" || item.type === "tool-result") {
          // Tool calls and results are always valid (non-empty)
          hasValidItem = true;
          break;
        }
      }
    }
    return !hasValidItem;
  }

  // Other types (shouldn't happen, but treat as non-empty to be safe)
  return false;
}

/**
 * Generate a unique key for a message based on its role and content
 * Used for deduplication when merging conversations
 * Normalizes content so that string and array formats with the same text are treated as duplicates
 */
export function getMessageKey(message: UIMessage): string {
  const role = message.role;
  const contentKey = normalizeContentForComparison(message.content);
  return `${role}:${contentKey}`;
}

/**
 * Find messages that are new (not present in existing messages)
 * Compares messages based on role and content only (ignores metadata like tokenUsage)
 */
export function findNewMessages(
  existingMessages: UIMessage[],
  incomingMessages: UIMessage[]
): UIMessage[] {
  // Create a set of keys for existing messages for O(1) lookup
  const existingKeys = new Set(
    existingMessages.map((msg) => getMessageKey(msg))
  );

  // Filter incoming messages to only those not in existing
  const newMessages = incomingMessages.filter((msg) => {
    const key = getMessageKey(msg);
    return !existingKeys.has(key);
  });

  console.log(
    `[findNewMessages] Found ${newMessages.length} new messages out of ${incomingMessages.length} incoming messages (${existingMessages.length} existing messages)`
  );

  return newMessages;
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
 * Expand messages to include separate tool call and tool result messages
 * This ensures tool calls appear as separate messages in the conversation history
 * while keeping them embedded in assistant message content for LLM compatibility
 */
export { expandMessagesWithToolCalls } from "./conversationMessageExpander";

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
          // Validate tool result has required fields
          if (
            "toolCallId" in item &&
            "toolName" in item &&
            typeof (item as { toolCallId?: unknown }).toolCallId === "string" &&
            typeof (item as { toolName?: unknown }).toolName === "string"
          ) {
            toolResults.push(item);
          } else {
            console.warn(
              "[extractToolResults] Tool result missing required fields:",
              {
                hasToolCallId: "toolCallId" in item,
                hasToolName: "toolName" in item,
                toolCallIdType:
                  "toolCallId" in item
                    ? typeof (item as { toolCallId?: unknown }).toolCallId
                    : "missing",
                toolNameType:
                  "toolName" in item
                    ? typeof (item as { toolName?: unknown }).toolName
                    : "missing",
                item,
              }
            );
          }
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
          // Validate tool result has required fields
          if (
            "toolCallId" in item &&
            "toolName" in item &&
            typeof (item as { toolCallId?: unknown }).toolCallId === "string" &&
            typeof (item as { toolName?: unknown }).toolName === "string"
          ) {
            toolResults.push(item);
          } else {
            console.warn(
              "[extractToolResults] Tool result missing required fields (tool message):",
              {
                hasToolCallId: "toolCallId" in item,
                hasToolName: "toolName" in item,
                toolCallIdType:
                  "toolCallId" in item
                    ? typeof (item as { toolCallId?: unknown }).toolCallId
                    : "missing",
                toolNameType:
                  "toolName" in item
                    ? typeof (item as { toolName?: unknown }).toolName
                    : "missing",
                item,
              }
            );
          }
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
 * Extract token usage from generateText or streamText result
 * Uses AI SDK's totalUsage when available (aggregates all steps automatically)
 * Falls back to usage or step aggregation for backward compatibility
 */
export function extractTokenUsage(
  result:
    | GenerateTextResultWithTotalUsage
    | StreamTextResultWithResolvedUsage
    | unknown
): TokenUsage | undefined {
  if (!result || typeof result !== "object") {
    return undefined;
  }

  // Use totalUsage if available (AI SDK provides this for generateText/streamText)
  // This is the preferred method as it aggregates all steps automatically
  const typedResult = result as
    | GenerateTextResultWithTotalUsage
    | StreamTextResultWithResolvedUsage;
  // totalUsage may be LanguageModelUsage (from generateText) or LanguageModelV2Usage (from streamText)
  // extractTokenUsage handles both formats, so we pass it through
  let usage: LanguageModelUsage | unknown | undefined =
    (typedResult as GenerateTextResultWithTotalUsage).totalUsage ??
    (typedResult as StreamTextResultWithResolvedUsage).totalUsage;

  // Fall back to top-level usage if totalUsage is not available
  if (!usage) {
    usage = (typedResult as GenerateTextResultWithTotalUsage).usage;
  }

  // Last resort: try to aggregate from steps (for older formats or edge cases)
  if (!usage || typeof usage !== "object") {
    const steps = Array.isArray(
      (typedResult as GenerateTextResultWithTotalUsage).steps
    )
      ? (typedResult as GenerateTextResultWithTotalUsage).steps
      : (typedResult as GenerateTextResultWithTotalUsage)._steps?.status?.value;

    if (Array.isArray(steps) && steps.length > 0) {
      // Aggregate usage from all steps (fallback for older formats)
      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;
      let totalTokens = 0;
      let totalReasoningTokens = 0;
      let totalCachedInputTokens = 0;

      for (const step of steps) {
        if (step?.usage && typeof step.usage === "object") {
          const stepUsage = step.usage as LanguageModelUsage;
          totalPromptTokens += stepUsage.promptTokens ?? 0;
          totalCompletionTokens += stepUsage.completionTokens ?? 0;
          totalTokens += stepUsage.totalTokens ?? 0;
          totalReasoningTokens += stepUsage.reasoningTokens ?? 0;
          totalCachedInputTokens += stepUsage.cachedPromptTokens ?? 0;
        }
      }

      // Create aggregated usage object if we found any usage data
      if (
        totalPromptTokens > 0 ||
        totalCompletionTokens > 0 ||
        totalTokens > 0
      ) {
        usage = {
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          totalTokens:
            totalTokens ||
            totalPromptTokens + totalCompletionTokens + totalReasoningTokens,
          reasoningTokens:
            totalReasoningTokens > 0 ? totalReasoningTokens : undefined,
          cachedPromptTokens:
            totalCachedInputTokens > 0 ? totalCachedInputTokens : undefined,
        };
        console.log(
          "[extractTokenUsage] Aggregated usage from steps (fallback):",
          {
            stepsCount: steps.length,
            aggregatedUsage: usage,
          }
        );
      }
    }
  }

  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  // DIAGNOSTIC: Log full usage object structure for debugging
  console.log("[extractTokenUsage] Full usage object structure:", {
    usageKeys: Object.keys(usage),
    usageObject: JSON.stringify(usage, null, 2),
    resultKeys: Object.keys(result),
    hasTotalUsage: !!(
      typedResult as
        | GenerateTextResultWithTotalUsage
        | StreamTextResultWithResolvedUsage
    ).totalUsage,
  });

  // Extract token values from usage object
  // Handle both standard AI SDK format and legacy field name variations for backward compatibility
  // Standard: promptTokens/completionTokens (AI SDK format)
  // Legacy: inputTokens/outputTokens (some provider adapters)
  // Legacy: promptTokenCount/completionTokenCount (Google API format)
  // LanguageModelV2Usage from streamText may use different field names
  const usageAny = usage as unknown as Record<string, unknown>;
  const promptTokens =
    ((usage as LanguageModelUsage).promptTokens as number | undefined) ??
    (usageAny.inputTokens as number | undefined) ??
    (usageAny.promptTokenCount as number | undefined) ??
    0;
  const completionTokens =
    ((usage as LanguageModelUsage).completionTokens as number | undefined) ??
    (usageAny.outputTokens as number | undefined) ??
    (usageAny.completionTokenCount as number | undefined) ??
    0;
  const totalTokens =
    ((usage as LanguageModelUsage).totalTokens as number | undefined) ??
    (usageAny.totalTokenCount as number | undefined) ??
    0;

  // Extract cached prompt tokens (various field names for backward compatibility)
  const cachedPromptTokens =
    ((usage as LanguageModelUsage).cachedPromptTokens as number | undefined) ??
    (usageAny.cachedPromptTokenCount as number | undefined) ??
    (usageAny.cachedInputTokens as number | undefined) ??
    (usageAny.cachedTokens as number | undefined) ??
    0;

  // Extract reasoning tokens (various field names for backward compatibility)
  const reasoningTokens =
    ((usage as LanguageModelUsage).reasoningTokens as number | undefined) ??
    (usageAny.reasoning as number | undefined) ??
    (usageAny.reasoningTokens as number | undefined) ??
    ((typedResult as Record<string, unknown>).reasoningTokens as
      | number
      | undefined) ??
    0;

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
  > & {
    conversationId?: string; // Optional: if provided, use it; otherwise generate one
  }
): Promise<string> {
  const conversationId = data.conversationId || randomUUID();
  const now = new Date().toISOString();
  const pk = `conversations/${data.workspaceId}/${data.agentId}/${conversationId}`;

  // Keep all messages (including empty ones) - do not filter
  // Add request ID to messages if provided
  const messagesWithRequestId = data.awsRequestId
    ? data.messages.map((msg) => ({
        ...msg,
        awsRequestId: data.awsRequestId,
      }))
    : data.messages;

  // Expand messages to include separate tool call and tool result messages
  // This ensures tool calls appear as separate messages in conversation history
  // Use messagesWithRequestId to ensure request IDs are included in expanded messages
  const expandedMessages = expandMessagesWithToolCalls(
    messagesWithRequestId,
    data.awsRequestId
  );

  // Calculate costs from per-message model/provider data
  // IMPORTANT: Calculate from 0 based on ALL expanded messages
  // Use getMessageCost() helper to get best available cost for each message
  // This prefers finalCostUsd > provisionalCostUsd > calculated from tokenUsage
  // Also includes tool costs from tool-result content items (individual costs per tool)
  let totalCostUsd = 0;
  let totalGenerationTimeMs = 0;
  let rerankingCostUsd = 0;
  for (const message of expandedMessages) {
    // Use getMessageCost() helper to get best available cost
    const messageCost = getMessageCost(message);

    if (messageCost) {
      // For assistant messages: use costUsd
      if (messageCost.costUsd !== undefined) {
        // Check if this is a reranking cost (from system message with reranking-result)
        // IMPORTANT: getMessageCost() only returns a cost for system messages if they have
        // reranking-result content (see messageCostCalculation.ts lines 118-138).
        // This means message.role === "system" && messageCost.costUsd !== undefined
        // is a reliable indicator of reranking costs. If getMessageCost() behavior changes
        // to return costs for other system message types, this logic must be updated.
        if (message.role === "system") {
          rerankingCostUsd += messageCost.costUsd;
          console.log(
            "[startConversation] Extracted reranking cost from system message:",
            {
              costUsd: messageCost.costUsd,
              totalRerankingCostUsd: rerankingCostUsd,
            }
          );
        } else {
          totalCostUsd += messageCost.costUsd;
        }
      }

      // For tool messages: sum individual tool costs
      if (messageCost.toolCosts) {
        for (const toolCost of messageCost.toolCosts) {
          totalCostUsd += toolCost.costUsd;
        }
      }
    }

    // Sum generation times for assistant messages
    if (message.role === "assistant") {
      if (
        "generationTimeMs" in message &&
        typeof message.generationTimeMs === "number"
      ) {
        totalGenerationTimeMs += message.generationTimeMs;
      }
    }
  }

  // Re-ranking costs are stored separately in rerankingCostUsd field
  // Add them to totalCostUsd for the conversation total
  if (rerankingCostUsd > 0) {
    totalCostUsd += rerankingCostUsd;
    console.log(
      "[startConversation] Final reranking cost and total cost:",
      {
        rerankingCostUsd,
        totalCostUsd,
      }
    );
  }

  // Initialize awsRequestIds array if awsRequestId is provided
  const awsRequestIds = data.awsRequestId ? [data.awsRequestId] : undefined;

  const conversationRecord = {
    pk,
    workspaceId: data.workspaceId,
    agentId: data.agentId,
    conversationId,
    conversationType: data.conversationType,
    messages: expandedMessages as unknown[],
    tokenUsage: data.tokenUsage,
    usesByok: data.usesByok,
    error: data.error,
    costUsd: totalCostUsd > 0 ? totalCostUsd : undefined,
    rerankingCostUsd: rerankingCostUsd > 0 ? rerankingCostUsd : undefined,
    totalGenerationTimeMs:
      totalGenerationTimeMs > 0 ? totalGenerationTimeMs : undefined,
    awsRequestIds,
    startedAt: now,
    lastMessageAt: now,
    expires: calculateTTL(),
  };

  await db["agent-conversations"].create(conversationRecord);

  // Write to working memory - await to ensure it completes before Lambda finishes
  // This prevents Lambda from freezing the execution context before SQS message is sent
  console.log(
    `[Conversation Logger] Calling writeToWorkingMemory for conversation ${conversationId}, agent ${data.agentId}, workspace ${data.workspaceId}, ${data.messages.length} messages`
  );
  console.log(
    `[Conversation Logger] Parameter values being passed - agentId: "${data.agentId}", workspaceId: "${data.workspaceId}", conversationId: "${conversationId}"`
  );
  try {
    await writeToWorkingMemory(
      data.agentId,
      data.workspaceId,
      conversationId,
      expandedMessages
    );
  } catch (error) {
    // Log error but don't throw - memory writes should not block conversation logging
    console.error(
      `[Conversation Logger] Failed to write to working memory for conversation ${conversationId}:`,
      error instanceof Error
        ? {
            message: error.message,
            stack: error.stack,
            name: error.name,
          }
        : String(error)
    );
    Sentry.captureException(ensureError(error), {
      tags: {
        context: "memory",
        operation: "write-working-memory",
      },
    });
  }

  // Enqueue evaluations for enabled judges after conversation logging completes
  // Must await to ensure SQS messages are published before Lambda terminates (workspace rule #8)
  try {
    const { enqueueEvaluations } = await import("./evalEnqueue");
    // Must await to ensure SQS messages are published before Lambda terminates
    await enqueueEvaluations(data.workspaceId, data.agentId, conversationId);
  } catch (error) {
    // Log error but don't throw - evaluation enqueueing should not block conversation logging
    console.error("[Conversation Logger] Failed to enqueue evaluations:", {
      error: error instanceof Error ? error.message : String(error),
      workspaceId: data.workspaceId,
      agentId: data.agentId,
      conversationId,
    });
  }

  return conversationId;
}

/**
 * Track a delegation call in conversation metadata
 */
export async function trackDelegation(
  db: DatabaseSchema,
  workspaceId: string,
  agentId: string,
  conversationId: string,
  delegation: {
    callingAgentId: string;
    targetAgentId: string;
    targetConversationId?: string;
    taskId?: string;
    status: "completed" | "failed" | "cancelled";
  }
): Promise<void> {
  try {
    const pk = `conversations/${workspaceId}/${agentId}/${conversationId}`;

    // Check if conversation exists first
    // If it doesn't exist, we'll create it with just the delegation
    // This ensures delegations are tracked even if updateConversation hasn't been called yet
    const existing = await db["agent-conversations"].get(pk);
    if (!existing) {
      console.log(
        "[Delegation Tracking] Conversation not found, creating it with delegation:",
        { workspaceId, agentId, conversationId }
      );
      // Create conversation with just the delegation
      // updateConversation will fill in the rest later
      const newDelegation = {
        ...delegation,
        timestamp: new Date().toISOString(),
      };
      await db["agent-conversations"].create({
        pk,
        sk: "conversation",
        workspaceId,
        agentId,
        conversationId,
        conversationType: "test", // Default type, will be updated by updateConversation
        messages: [],
        delegations: [newDelegation],
        startedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        expires: calculateTTL(),
      });
      console.log(
        "[Delegation Tracking] Created conversation with delegation:",
        {
          workspaceId,
          agentId,
          conversationId,
          delegationCount: 1,
          delegation: {
            callingAgentId: delegation.callingAgentId,
            targetAgentId: delegation.targetAgentId,
            targetConversationId: delegation.targetConversationId,
            taskId: delegation.taskId,
            status: delegation.status,
          },
        }
      );
      return;
    }

    await db["agent-conversations"].atomicUpdate(
      pk,
      undefined,
      async (current) => {
        if (!current) {
          // Conversation was removed between the existence check and update; skip tracking
          // Return existing object to maintain type safety (we know it exists from check above)
          console.warn(
            "[Delegation Tracking] Conversation disappeared before update, skipping delegation tracking:",
            { workspaceId, agentId, conversationId }
          );
          return existing;
        }

        const existingDelegations =
          (
            current as {
              delegations?: Array<{
                callingAgentId: string;
                targetAgentId: string;
                targetConversationId?: string;
                taskId?: string;
                timestamp: string;
                status: "completed" | "failed" | "cancelled";
              }>;
            }
          ).delegations || [];

        const newDelegation = {
          ...delegation,
          timestamp: new Date().toISOString(),
        };

        const updatedDelegations = [...existingDelegations, newDelegation];
        console.log(
          "[trackDelegation] Adding delegation to conversation:",
          {
            workspaceId,
            agentId,
            conversationId,
            delegationCount: updatedDelegations.length,
            newDelegation: {
              callingAgentId: delegation.callingAgentId,
              targetAgentId: delegation.targetAgentId,
              targetConversationId: delegation.targetConversationId,
              taskId: delegation.taskId,
              status: delegation.status,
            },
          }
        );
        return {
          pk: current.pk,
          delegations: updatedDelegations,
        };
      }
    );
  } catch (error) {
    // Log but don't fail - delegation tracking is best-effort
    console.error("[Delegation Tracking] Error tracking delegation:", {
      error: error instanceof Error ? error.message : String(error),
      workspaceId,
      agentId,
      conversationId,
      delegation,
    });
    Sentry.captureException(ensureError(error), {
      tags: {
        context: "delegation-tracking",
        operation: "track-delegation",
      },
      extra: {
        workspaceId,
        agentId,
        conversationId,
        delegation,
      },
    });
  }
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
  additionalTokenUsage?: TokenUsage,
  usesByok?: boolean,
  error?: ConversationErrorInfo,
  awsRequestId?: string,
  conversationType?: "test" | "webhook" | "stream" | "scheduled"
): Promise<void> {
  const pk = `conversations/${workspaceId}/${agentId}/${conversationId}`;

  // Keep all messages (including empty ones) - do not filter
  // Add request ID to each new message if provided
  const messagesWithRequestId = awsRequestId
    ? newMessages.map((msg) => ({
        ...msg,
        awsRequestId,
      }))
    : newMessages;

  // Track truly new messages (not duplicates) to send to queue
  // This will be set inside atomicUpdate callback
  let trulyNewMessages: UIMessage[] = [];
  // Use atomicUpdate to ensure thread-safe conversation updates
  await db["agent-conversations"].atomicUpdate(
    pk,
    undefined,
    async (existing) => {
      const now = new Date().toISOString();

      if (!existing) {
        // If conversation doesn't exist, create it
        // Expand messages to include separate tool call and tool result messages
        const expandedMessages = expandMessagesWithToolCalls(
          newMessages,
          awsRequestId
        );
        trulyNewMessages = expandedMessages;
        // Calculate costs and generation times from per-message model/provider data
        // IMPORTANT: Calculate from 0 based on ALL expanded messages
        // Use getMessageCost() helper to get best available cost for each message
        // This prefers finalCostUsd > provisionalCostUsd > calculated from tokenUsage
        // Also includes tool costs from tool-result content items (individual costs per tool)
        let totalCostUsd = 0;
        let totalGenerationTimeMs = 0;
        let rerankingCostUsd = 0;
        for (const message of expandedMessages) {
          // Use getMessageCost() helper to get best available cost
          const messageCost = getMessageCost(message);

          if (messageCost) {
            // For assistant messages: use costUsd
            if (messageCost.costUsd !== undefined) {
              // Check if this is a reranking cost (from system message with reranking-result)
              // getMessageCost() only returns a cost for system messages if they have reranking-result content
              if (message.role === "system") {
                rerankingCostUsd += messageCost.costUsd;
                console.log(
                  "[updateConversation] Extracted reranking cost from system message (new conversation):",
                  {
                    costUsd: messageCost.costUsd,
                    totalRerankingCostUsd: rerankingCostUsd,
                  }
                );
              } else {
                totalCostUsd += messageCost.costUsd;
              }
            }

            // For tool messages: sum individual tool costs
            if (messageCost.toolCosts) {
              for (const toolCost of messageCost.toolCosts) {
                totalCostUsd += toolCost.costUsd;
              }
            }
          }

          // Sum generation times for assistant messages
          if (message.role === "assistant") {
            if (
              "generationTimeMs" in message &&
              typeof message.generationTimeMs === "number"
            ) {
              totalGenerationTimeMs += message.generationTimeMs;
            }
          }
        }

        // Re-ranking costs are stored separately in rerankingCostUsd field
        // Add them to totalCostUsd for the conversation total
        if (rerankingCostUsd > 0) {
          totalCostUsd += rerankingCostUsd;
          console.log(
            "[updateConversation] Final reranking cost and total cost (new conversation):",
            {
              rerankingCostUsd,
              totalCostUsd,
            }
          );
        }

        // Initialize awsRequestIds array if awsRequestId is provided
        const awsRequestIds = awsRequestId ? [awsRequestId] : undefined;

        const conversationRecord = {
          pk,
          workspaceId,
          agentId,
          conversationId,
          conversationType: (conversationType || "test") as
            | "test"
            | "webhook"
            | "stream", // Use provided type or default to test
          messages: expandedMessages as unknown[],
          tokenUsage: additionalTokenUsage,
          usesByok: usesByok,
          error,
          costUsd: totalCostUsd > 0 ? totalCostUsd : undefined,
          rerankingCostUsd: rerankingCostUsd > 0 ? rerankingCostUsd : undefined,
          totalGenerationTimeMs:
            totalGenerationTimeMs > 0 ? totalGenerationTimeMs : undefined,
          awsRequestIds,
          startedAt: now,
          lastMessageAt: now,
          expires: calculateTTL(),
        };

        return conversationRecord;
      }

      // Get existing messages from database
      const existingMessages = (existing.messages || []) as UIMessage[];

      // Identify truly new messages (not in existing conversation)
      // This comparison is based on role and content only (ignores metadata like tokenUsage, awsRequestId)
      const trulyNewWithoutRequestId = findNewMessages(
        existingMessages,
        newMessages
      );
      // Expand truly new messages to include separate tool call and tool result messages
      // This ensures tool calls appear as separate messages in conversation history
      const expandedTrulyNewMessages = expandMessagesWithToolCalls(
        trulyNewWithoutRequestId,
        awsRequestId
      );
      trulyNewMessages = expandedTrulyNewMessages;

      // Merge messages for DB storage, deduplicating based on role and content
      // This prevents duplicate messages when the client sends the full conversation history
      // New messages should have request IDs, existing ones keep their original request IDs (if any)
      const allMessages = deduplicateMessages(
        existingMessages,
        messagesWithRequestId
      );

      // Expand messages to include separate tool call and tool result messages
      // This ensures tool calls appear as separate messages in conversation history
      // Expand after deduplication to avoid expanding duplicates
      const expandedAllMessages = expandMessagesWithToolCalls(
        allMessages,
        awsRequestId
      );
      // Aggregate token usage
      const existingTokenUsage = existing.tokenUsage as TokenUsage | undefined;
      const aggregatedTokenUsage = aggregateTokenUsage(
        existingTokenUsage,
        additionalTokenUsage
      );

      // Calculate costs from per-message model/provider data
      // IMPORTANT: Recalculate from 0 based on ALL deduplicated and expanded messages
      // Do NOT use existing.costUsd - always recalculate from scratch to ensure accuracy
      // Use getMessageCost() helper to get best available cost for each message
      // This prefers finalCostUsd > provisionalCostUsd > calculated from tokenUsage
      // Also includes tool costs from tool-result content items (individual costs per tool)
      let totalCostUsd = 0;
      let totalGenerationTimeMs = 0;
      let extractedRerankingCostUsd = 0;
      for (const message of expandedAllMessages) {
        // Use getMessageCost() helper to get best available cost
        const messageCost = getMessageCost(message);

        if (messageCost) {
          // For assistant messages: use costUsd
          if (messageCost.costUsd !== undefined) {
            // Check if this is a reranking cost (from system message with reranking-result)
            // getMessageCost() only returns a cost for system messages if they have reranking-result content
            if (message.role === "system") {
              extractedRerankingCostUsd += messageCost.costUsd;
              console.log(
                "[updateConversation] Extracted reranking cost from system message:",
                {
                  costUsd: messageCost.costUsd,
                  totalExtractedRerankingCostUsd: extractedRerankingCostUsd,
                }
              );
            } else {
              totalCostUsd += messageCost.costUsd;
            }
          }

          // For tool messages: sum individual tool costs
          if (messageCost.toolCosts) {
            for (const toolCost of messageCost.toolCosts) {
              totalCostUsd += toolCost.costUsd;
            }
          }
        }

        // Sum generation times for assistant messages
        if (message.role === "assistant") {
          if (
            "generationTimeMs" in message &&
            typeof message.generationTimeMs === "number"
          ) {
            totalGenerationTimeMs += message.generationTimeMs;
          }
        }
      }

      // Use extracted reranking cost from messages, or preserve existing if already set (from cost verification)
      // Prefer existing rerankingCostUsd if it exists (may be from cost verification queue with final cost)
      // Otherwise use extracted cost from messages
      const existingRerankingCost =
        (existing as { rerankingCostUsd?: number }).rerankingCostUsd;
      const finalRerankingCostUsd =
        existingRerankingCost !== undefined
          ? existingRerankingCost
          : extractedRerankingCostUsd > 0
          ? extractedRerankingCostUsd
          : undefined;

      console.log(
        "[updateConversation] Reranking cost calculation:",
        {
          existingRerankingCost,
          extractedRerankingCostUsd,
          finalRerankingCostUsd,
        }
      );

      // Include re-ranking costs in total (stored separately since re-ranking happens before LLM call)
      if (finalRerankingCostUsd !== undefined && finalRerankingCostUsd > 0) {
        totalCostUsd += finalRerankingCostUsd;
      }

      // Update awsRequestIds array - append new request ID if provided
      const existingRequestIds =
        (existing as { awsRequestIds?: string[] }).awsRequestIds || [];
      const updatedRequestIds = awsRequestId
        ? [...existingRequestIds, awsRequestId]
        : existingRequestIds.length > 0
        ? existingRequestIds
        : undefined;

      // Preserve delegations from existing conversation
      // IMPORTANT: Always preserve delegations if they exist, even if empty array
      // This prevents overwriting delegations that were added by trackDelegation
      // Note: We read delegations from the 'existing' parameter which is the current state
      // at the time atomicUpdate reads it. If trackDelegation wrote after this read but before
      // this write, atomicUpdate will retry and we'll read the latest state with delegations.
      const existingDelegations =
        (
          existing as {
            delegations?: Array<{
              callingAgentId: string;
              targetAgentId: string;
              taskId?: string;
              timestamp: string;
              status: "completed" | "failed" | "cancelled";
            }>;
          }
        ).delegations;

      // Log for debugging delegation preservation
      if (existingDelegations && existingDelegations.length > 0) {
        console.log(
          "[updateConversation] Preserving delegations:",
          existingDelegations.length,
          "delegation(s)"
        );
      }

      // Update conversation, preserving existing fields including delegations
      const conversationRecord = {
        pk,
        workspaceId: existing.workspaceId,
        agentId: existing.agentId,
        conversationId: existing.conversationId,
        conversationType: existing.conversationType,
        messages: expandedAllMessages as unknown[],
        tokenUsage: aggregatedTokenUsage,
        lastMessageAt: now,
        expires: calculateTTL(),
        costUsd: totalCostUsd > 0 ? totalCostUsd : undefined,
        rerankingCostUsd: finalRerankingCostUsd,
        totalGenerationTimeMs:
          totalGenerationTimeMs > 0 ? totalGenerationTimeMs : undefined,
        usesByok:
          existing.usesByok !== undefined ? existing.usesByok : usesByok,
        error: error ?? (existing as { error?: ConversationErrorInfo }).error,
        startedAt: existing.startedAt,
        awsRequestIds: updatedRequestIds,
        // Always preserve delegations if they exist (even if empty array)
        // This is critical to prevent overwriting delegations added by trackDelegation
        ...(existingDelegations !== undefined
          ? { delegations: existingDelegations }
          : {}),
      };

      return conversationRecord;
    }
  );

  // Write to working memory - await to ensure it completes before Lambda finishes
  // This prevents Lambda from freezing the execution context before SQS message is sent
  // IMPORTANT: Only send truly new messages to the queue (not duplicates)
  // This prevents duplicate fact extraction and embedding generation
  if (trulyNewMessages.length > 0) {
    console.log(
      `[Conversation Logger] Calling writeToWorkingMemory for conversation ${conversationId}, agent ${agentId}, workspace ${workspaceId}, ${trulyNewMessages.length} truly new messages (out of ${newMessages.length} messages)`
    );
    console.log(
      `[Conversation Logger] Parameter values being passed - agentId: "${agentId}", workspaceId: "${workspaceId}", conversationId: "${conversationId}"`
    );
    try {
      await writeToWorkingMemory(
        agentId,
        workspaceId,
        conversationId,
        trulyNewMessages
      );
    } catch (error) {
      // Log error but don't throw - memory writes should not block conversation logging
      console.error(
        `[Conversation Logger] Failed to write to working memory for conversation ${conversationId}:`,
        error instanceof Error
          ? {
              message: error.message,
              stack: error.stack,
              name: error.name,
            }
          : String(error)
      );
    }
  } else {
    console.log(
      `[Conversation Logger] Skipping writeToWorkingMemory for conversation ${conversationId} - no truly new messages (${newMessages.length} messages were all duplicates)`
    );
  }

  // Enqueue evaluations for enabled judges after conversation logging completes
  // Must await to ensure SQS messages are published before Lambda terminates (workspace rule #8)
  try {
    const { enqueueEvaluations } = await import("./evalEnqueue");
    // Must await to ensure SQS messages are published before Lambda terminates
    await enqueueEvaluations(workspaceId, agentId, conversationId);
  } catch (error) {
    // Log error but don't throw - evaluation enqueueing should not block conversation logging
    console.error("[Conversation Logger] Failed to enqueue evaluations:", {
      error: error instanceof Error ? error.message : String(error),
      workspaceId,
      agentId,
      conversationId,
    });
  }
}
