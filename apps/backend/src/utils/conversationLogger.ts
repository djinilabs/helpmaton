import { randomUUID } from "crypto";

import type { UIMessage } from "../http/post-api-workspaces-000workspaceId-agents-000agentId-test/utils/types";
import type { DatabaseSchema } from "../tables/schema";

import { writeToWorkingMemory } from "./memory/writeMemory";
import { calculateConversationCosts } from "./tokenAccounting";

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens?: number; // Reasoning tokens (if model supports reasoning)
  cachedPromptTokens?: number; // Cached prompt tokens (if prompt caching is used)
}

export interface ConversationErrorInfo {
  message: string;
  name?: string;
  stack?: string;
  code?: string;
  statusCode?: number;
  provider?: string;
  modelName?: string;
  endpoint?: string;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
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
  usesByok?: boolean;
  error?: ConversationErrorInfo;
}

/**
 * Calculate TTL timestamp (30 days from now in seconds)
 */
export function calculateTTL(): number {
  return Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
}

/**
 * Build a serializable error payload for conversation records
 * Extracts detailed error information including wrapped errors and cause chains
 */
export function buildConversationErrorInfo(
  error: unknown,
  options?: {
    provider?: string;
    modelName?: string;
    endpoint?: string;
    metadata?: Record<string, unknown>;
  }
): ConversationErrorInfo {
  // Extract the most specific error message possible
  let message = error instanceof Error ? error.message : String(error);
  let specificError: Error | undefined = error instanceof Error ? error : undefined;
  
  // Helper to extract error message from nested error structures
  const extractErrorMessage = (err: unknown): string | undefined => {
    if (!err || typeof err !== "object") return undefined;
    
    const errObj = err as Record<string, unknown>;
    
    // Check data.error.message (common in AI SDK errors)
    if (errObj.data && typeof errObj.data === "object" && errObj.data !== null) {
      const data = errObj.data as Record<string, unknown>;
      if (data.error) {
        if (typeof data.error === "object" && data.error !== null) {
          const errorField = data.error as Record<string, unknown>;
          if (typeof errorField.message === "string" && errorField.message.length > 0) {
            return errorField.message;
          }
        } else if (typeof data.error === "string" && data.error.length > 0) {
          return data.error;
        }
      }
      if (typeof data.message === "string" && data.message.length > 0) {
        return data.message;
      }
    }
    
    // Check response.data (common in fetch/HTTP errors)
    if (errObj.response && typeof errObj.response === "object" && errObj.response !== null) {
      const response = errObj.response as Record<string, unknown>;
      if (response.data && typeof response.data === "object" && response.data !== null) {
        const responseData = response.data as Record<string, unknown>;
        if (responseData.error) {
          if (typeof responseData.error === "object" && responseData.error !== null) {
            const errorField = responseData.error as Record<string, unknown>;
            if (typeof errorField.message === "string" && errorField.message.length > 0) {
              return errorField.message;
            }
          } else if (typeof responseData.error === "string" && responseData.error.length > 0) {
            return responseData.error;
          }
        }
        if (typeof responseData.message === "string" && responseData.message.length > 0) {
          return responseData.message;
        }
      }
    }
    
    // Check body (common in HTTP errors)
    if (typeof errObj.body === "string" && errObj.body.length > 0) {
      try {
        const body = JSON.parse(errObj.body) as Record<string, unknown>;
        if (typeof body.error === "string" && body.error.length > 0) {
          return body.error;
        }
        if (typeof body.message === "string" && body.message.length > 0) {
          return body.message;
        }
      } catch {
        // Not JSON, might be plain text error
        if (errObj.body.length < 500) {
          return errObj.body;
        }
      }
    }
    
    return undefined;
  };
  
  // Traverse error.cause chain to find the most specific error
  if (error instanceof Error && error.cause) {
    let currentCause: unknown = error.cause;
    let depth = 0;
    const maxDepth = 10; // Prevent infinite loops
    
    while (currentCause && depth < maxDepth) {
      if (currentCause instanceof Error) {
        const causeMessage = currentCause.message;
        // Prefer more specific error messages (longer, more descriptive)
        // Also prefer errors that aren't generic wrappers
        if (
          causeMessage &&
          causeMessage.length > message.length &&
          !causeMessage.includes("No output generated") &&
          !causeMessage.includes("Check the stream for errors")
        ) {
          message = causeMessage;
          specificError = currentCause;
        }
        // Check for status codes in the cause
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyCause = currentCause as any;
        if (typeof anyCause.statusCode === "number" || typeof anyCause.status === "number") {
          specificError = currentCause;
        }
        currentCause = currentCause.cause;
      } else {
        break;
      }
      depth++;
    }
  }
  
  // Extract error message from nested error structures (data, response, body)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nestedMessage = extractErrorMessage(error) || extractErrorMessage((error as any)?.cause);
  if (nestedMessage && nestedMessage.length > 0) {
    // Prefer nested messages if they're more specific
    if (
      nestedMessage.length > message.length ||
      (!message.includes(nestedMessage) && !nestedMessage.includes("No output generated"))
    ) {
      message = nestedMessage;
    }
  }

  const base: ConversationErrorInfo = {
    message,
    occurredAt: new Date().toISOString(),
    provider: options?.provider,
    modelName: options?.modelName,
    endpoint: options?.endpoint,
    metadata: options?.metadata,
  };

  // Use the most specific error found, or fall back to original
  const errorToInspect = specificError || (error instanceof Error ? error : undefined);

  if (errorToInspect) {
    base.name = errorToInspect.name;
    base.stack = errorToInspect.stack;
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- error might carry custom fields
    const anyError = errorToInspect as any;
    
    // Extract error code
    if (typeof anyError.code === "string") {
      base.code = anyError.code;
    }
    
    // Extract status code (check multiple possible locations)
    const statusCode =
      typeof anyError.statusCode === "number"
        ? anyError.statusCode
        : typeof anyError.status === "number"
          ? anyError.status
          : typeof anyError.response?.status === "number"
            ? anyError.response.status
            : typeof anyError.response?.statusCode === "number"
              ? anyError.response.statusCode
              : undefined;
    if (statusCode !== undefined) {
      base.statusCode = statusCode;
    }
    
    // Extract API error details if available (check multiple locations)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const checkResponseData = (data: any): void => {
      if (!data || typeof data !== "object") return;
      
      const responseData = data as Record<string, unknown>;
      
      // Try to extract error message from API response
      let apiErrorMessage: string | undefined;
      if (responseData.error) {
        if (typeof responseData.error === "object" && responseData.error !== null) {
          const errorObj = responseData.error as Record<string, unknown>;
          apiErrorMessage = 
            (typeof errorObj.message === "string" ? errorObj.message : undefined) ||
            (typeof errorObj.error === "string" ? errorObj.error : undefined);
          
          // Extract error code from API response
          if (!base.code && errorObj.code) {
            base.code = String(errorObj.code);
          }
        } else if (typeof responseData.error === "string") {
          apiErrorMessage = responseData.error;
        }
      }
      
      if (!apiErrorMessage && typeof responseData.message === "string") {
        apiErrorMessage = responseData.message;
      }
      
      if (apiErrorMessage && apiErrorMessage.length > 0) {
        // Use the API error message if it's more specific than the current message
        // or if current message is generic
        const isGenericMessage = 
          message.includes("No output generated") ||
          message.includes("Check the stream for errors") ||
          message.length < 30;
        
        if (isGenericMessage || (!message.includes(apiErrorMessage) && apiErrorMessage.length > message.length)) {
          message = apiErrorMessage;
        } else if (!message.includes(apiErrorMessage)) {
          // Append if not already included
          message = `${message} (API: ${apiErrorMessage})`;
        }
      }
    };
    
    // Check response.data
    if (anyError.response?.data) {
      checkResponseData(anyError.response.data);
    }
    
    // Check data directly (AI SDK errors)
    if (anyError.data) {
      checkResponseData(anyError.data);
    }
    
    // Update message with the most specific one found
    base.message = message;
  } else if (error && typeof error === "object") {
    // Handle non-Error objects
    const maybeStatus =
      "statusCode" in error && typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : "status" in error && typeof (error as { status?: unknown }).status === "number"
          ? (error as { status: number }).status
          : undefined;
    if (maybeStatus !== undefined) {
      base.statusCode = maybeStatus;
    }
  }

  return base;
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
  // - cachedInputTokens (alternative field name)
  // - cachedTokens
  const cachedPromptTokens =
    usage.cachedPromptTokenCount ??
    usage.cachedPromptTokens ??
    usage.cachedInputTokens ??
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
    "cachedInputTokens",
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

  // Filter out empty messages before processing
  const filteredMessages = data.messages.filter(
    (msg) => !isMessageContentEmpty(msg)
  );

  const toolCalls = extractToolCalls(filteredMessages);
  const toolResults = extractToolResults(filteredMessages);

  // Calculate costs from per-message model/provider data
  // Prefer finalCostUsd (from OpenRouter API verification) if available, then provisionalCostUsd, then calculate from tokenUsage
  let totalCostUsd = 0;
  for (const message of filteredMessages) {
    if (message.role === "assistant") {
      // Prefer finalCostUsd if available (from OpenRouter cost verification)
      if ("finalCostUsd" in message && typeof message.finalCostUsd === "number") {
        totalCostUsd += message.finalCostUsd;
      } else if (
        "provisionalCostUsd" in message &&
        typeof message.provisionalCostUsd === "number"
      ) {
        // Fall back to provisionalCostUsd if finalCostUsd not available
        totalCostUsd += message.provisionalCostUsd;
      } else if ("tokenUsage" in message && message.tokenUsage) {
        // Fall back to calculating from tokenUsage
        const modelName = "modelName" in message && typeof message.modelName === "string" ? message.modelName : undefined;
        const provider = "provider" in message && typeof message.provider === "string" ? message.provider : "google";
        const messageCosts = calculateConversationCosts(
          provider,
          modelName,
          message.tokenUsage
        );
        totalCostUsd += messageCosts.usd;
      }
    }
  }

  await db["agent-conversations"].create({
    pk,
    workspaceId: data.workspaceId,
    agentId: data.agentId,
    conversationId,
    conversationType: data.conversationType,
    messages: filteredMessages as unknown[],
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    toolResults: toolResults.length > 0 ? toolResults : undefined,
    tokenUsage: data.tokenUsage,
    usesByok: data.usesByok,
    error: data.error,
    costUsd: totalCostUsd > 0 ? totalCostUsd : undefined,
    startedAt: now,
    lastMessageAt: now,
    expires: calculateTTL(),
  });

  // Write to working memory - await to ensure it completes before Lambda finishes
  // This prevents Lambda from freezing the execution context before SQS message is sent
  console.log(
    `[Conversation Logger] Calling writeToWorkingMemory for conversation ${conversationId}, agent ${data.agentId}, workspace ${data.workspaceId}, ${filteredMessages.length} filtered messages`
  );
  console.log(
    `[Conversation Logger] Parameter values being passed - agentId: "${data.agentId}", workspaceId: "${data.workspaceId}", conversationId: "${conversationId}"`
  );
  try {
    await writeToWorkingMemory(
      data.agentId,
      data.workspaceId,
      conversationId,
      filteredMessages
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
  additionalTokenUsage?: TokenUsage,
  usesByok?: boolean,
  error?: ConversationErrorInfo
): Promise<void> {
  const pk = `conversations/${workspaceId}/${agentId}/${conversationId}`;

  // Filter new messages before processing
  const filteredNewMessages = newMessages.filter(
    (msg) => !isMessageContentEmpty(msg)
  );

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
        // All filtered messages are new in this case
        trulyNewMessages = filteredNewMessages;

        const toolCalls = extractToolCalls(filteredNewMessages);
        const toolResults = extractToolResults(filteredNewMessages);
        
        // Calculate costs from per-message model/provider data
        let totalCostUsd = 0;
        for (const message of filteredNewMessages) {
          if (message.role === "assistant" && "tokenUsage" in message && message.tokenUsage) {
            const msgModelName = "modelName" in message && typeof message.modelName === "string" ? message.modelName : undefined;
            const msgProvider = "provider" in message && typeof message.provider === "string" ? message.provider : "google";
            const messageCosts = calculateConversationCosts(
              msgProvider,
              msgModelName,
              message.tokenUsage
            );
            totalCostUsd += messageCosts.usd;
          }
        }

        return {
          pk,
          workspaceId,
          agentId,
          conversationId,
          conversationType: "test" as const, // Default to test if updating non-existent conversation
          messages: filteredNewMessages as unknown[],
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          toolResults: toolResults.length > 0 ? toolResults : undefined,
          tokenUsage: additionalTokenUsage,
          usesByok: usesByok,
        error,
          costUsd: totalCostUsd > 0 ? totalCostUsd : undefined,
          startedAt: now,
          lastMessageAt: now,
          expires: calculateTTL(),
        };
      }

      // Get existing messages from database
      const existingMessages = (existing.messages || []) as UIMessage[];

      // Identify truly new messages (not in existing conversation)
      // This comparison is based on role and content only (ignores metadata like tokenUsage)
      trulyNewMessages = findNewMessages(existingMessages, filteredNewMessages);

      // Merge messages for DB storage, deduplicating based on role and content
      // This prevents duplicate messages when the client sends the full conversation history
      const allMessages = deduplicateMessages(
        existingMessages,
        filteredNewMessages
      );

      // Filter out any empty messages that might have been in existing messages
      const filteredAllMessages = allMessages.filter(
        (msg) => !isMessageContentEmpty(msg)
      );

      // Extract all tool calls and results from merged messages
      const toolCalls = extractToolCalls(filteredAllMessages);
      const toolResults = extractToolResults(filteredAllMessages);

      // Aggregate token usage
      const existingTokenUsage = existing.tokenUsage as TokenUsage | undefined;
      const aggregatedTokenUsage = aggregateTokenUsage(
        existingTokenUsage,
        additionalTokenUsage
      );

      // Calculate costs from per-message model/provider data
      // Prefer finalCostUsd (from OpenRouter API verification) if available, then provisionalCostUsd, then calculate from tokenUsage
      let totalCostUsd = 0;
      for (const message of filteredAllMessages) {
        if (message.role === "assistant") {
          // Prefer finalCostUsd if available (from OpenRouter cost verification)
          if ("finalCostUsd" in message && typeof message.finalCostUsd === "number") {
            totalCostUsd += message.finalCostUsd;
          } else if (
            "provisionalCostUsd" in message &&
            typeof message.provisionalCostUsd === "number"
          ) {
            // Fall back to provisionalCostUsd if finalCostUsd not available
            totalCostUsd += message.provisionalCostUsd;
          } else if ("tokenUsage" in message && message.tokenUsage) {
            // Fall back to calculating from tokenUsage
            const msgModelName = "modelName" in message && typeof message.modelName === "string" ? message.modelName : undefined;
            const msgProvider = "provider" in message && typeof message.provider === "string" ? message.provider : "google";
            const messageCosts = calculateConversationCosts(
              msgProvider,
              msgModelName,
              message.tokenUsage
            );
            totalCostUsd += messageCosts.usd;
          }
        }
      }

      // Update conversation, preserving existing fields
      return {
        pk,
        workspaceId: existing.workspaceId,
        agentId: existing.agentId,
        conversationId: existing.conversationId,
        conversationType: existing.conversationType,
        messages: filteredAllMessages as unknown[],
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        toolResults: toolResults.length > 0 ? toolResults : undefined,
        tokenUsage: aggregatedTokenUsage,
        lastMessageAt: now,
        expires: calculateTTL(),
        costUsd: totalCostUsd > 0 ? totalCostUsd : undefined,
        usesByok: existing.usesByok !== undefined ? existing.usesByok : usesByok,
        error: error ?? (existing as { error?: ConversationErrorInfo }).error,
        startedAt: existing.startedAt,
      };
    }
  );

  // Write to working memory - await to ensure it completes before Lambda finishes
  // This prevents Lambda from freezing the execution context before SQS message is sent
  // IMPORTANT: Only send truly new messages to the queue (not duplicates)
  // This prevents duplicate fact extraction and embedding generation
  if (trulyNewMessages.length > 0) {
    console.log(
      `[Conversation Logger] Calling writeToWorkingMemory for conversation ${conversationId}, agent ${agentId}, workspace ${workspaceId}, ${trulyNewMessages.length} truly new messages (out of ${filteredNewMessages.length} filtered messages)`
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
      `[Conversation Logger] Skipping writeToWorkingMemory for conversation ${conversationId} - no truly new messages (${filteredNewMessages.length} filtered messages were all duplicates)`
    );
  }
}
