import { createHash } from "crypto";

import type { UIMessage } from "../../utils/messageTypes";
import { sendWriteOperation } from "../vectordb/queueClient";
import type { FactRecord, TemporalGrain } from "../vectordb/types";
import type { AugmentedContext } from "../workspaceCreditContext";

import {
  applyMemoryOperationsToGraph,
  extractConversationMemory,
} from "./memoryExtraction";

/**
 * Generate a hash for a fact to use as cache key
 */
function hashFact(text: string): string {
  return createHash("sha256").update(text).digest("hex").substring(0, 16);
}

/**
 * Extract text content from a UIMessage
 * Handles both string and array content formats
 */
function extractTextFromMessage(message: UIMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    const extracted = message.content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (typeof item === "object" && item !== null) {
          if ("type" in item && item.type === "text" && "text" in item) {
            return String(item.text);
          }
          // Also handle tool-call and tool-result items that might have text
          if (
            "type" in item &&
            (item.type === "tool-call" || item.type === "tool-result")
          ) {
            // For tool calls/results, we might want to include some context
            // but for now, skip them as they're not factual content
            return "";
          }
        }
        return "";
      })
      .filter((text) => text.length > 0)
      .join(" ");
    return extracted;
  }

  return "";
}

function formatConversationText(messages: UIMessage[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") {
      continue;
    }
    const text = extractTextFromMessage(message);
    if (text.trim().length === 0) {
      continue;
    }
    const roleLabel = message.role === "user" ? "User" : "Agent";
    lines.push(`${roleLabel}: ${text}`);
  }
  return lines.join("\n");
}

export type MemoryExtractionConfig = {
  enabled?: boolean;
  modelName?: string | null;
  prompt?: string | null;
};

/**
 * Write conversation messages to working memory
 * Extracts facts and queues raw facts to SQS for async embedding generation
 */
export async function writeToWorkingMemory(
  agentId: string,
  workspaceId: string,
  conversationId: string,
  messages: UIMessage[],
  memoryExtractionConfig?: MemoryExtractionConfig,
  context?: AugmentedContext,
): Promise<void> {
  console.log(
    `[Memory Write] Starting write to working memory for conversation ${conversationId}, agent ${agentId}, workspace ${workspaceId}, ${messages.length} messages`,
  );
  console.log(
    `[Memory Write] Parameter values - agentId: "${agentId}" (type: ${typeof agentId}), workspaceId: "${workspaceId}" (type: ${typeof workspaceId}), conversationId: "${conversationId}" (type: ${typeof conversationId})`,
  );

  // Validate parameters to catch null/undefined values early
  if (!agentId || agentId === "null" || agentId === "undefined") {
    console.error(
      `[Memory Write] ERROR: agentId is invalid: "${agentId}" (type: ${typeof agentId})`,
    );
    throw new Error(`Invalid agentId: ${agentId}`);
  }
  if (!workspaceId || workspaceId === "null" || workspaceId === "undefined") {
    console.error(
      `[Memory Write] ERROR: workspaceId is invalid: "${workspaceId}" (type: ${typeof workspaceId})`,
    );
    throw new Error(`Invalid workspaceId: ${workspaceId}`);
  }
  if (
    !conversationId ||
    conversationId === "null" ||
    conversationId === "undefined"
  ) {
    console.error(
      `[Memory Write] ERROR: conversationId is invalid: "${conversationId}" (type: ${typeof conversationId})`,
    );
    throw new Error(`Invalid conversationId: ${conversationId}`);
  }

  try {
    const conversationText = formatConversationText(messages);
    console.log(
      `[Memory Write] Prepared conversation text for ${conversationId} with ${messages.length} messages`,
    );

    if (conversationText.trim().length === 0) {
      console.log(
        `[Memory Write] No conversation text to write for conversation ${conversationId}. Messages:`,
        messages.map((m) => ({
          role: m.role,
          contentType: typeof m.content,
          isArray: Array.isArray(m.content),
          contentPreview:
            typeof m.content === "string"
              ? m.content.substring(0, 100)
              : Array.isArray(m.content)
                ? `[Array with ${m.content.length} items]`
                : String(m.content).substring(0, 100),
        })),
      );
      return;
    }

    let contentToStore = conversationText;
    let memoryType: "summary" | "conversation" = "conversation";
    let memoryOperations: Array<{
      operation: "ADD" | "UPDATE" | "DELETE";
      subject: string;
      predicate: string;
      object: string;
      confidence: number;
    }> = [];

    if (memoryExtractionConfig?.enabled) {
      try {
        const extraction = await extractConversationMemory({
          agentId,
          workspaceId,
          conversationId,
          conversationText,
          modelName: memoryExtractionConfig.modelName,
          prompt: memoryExtractionConfig.prompt,
          context,
        });
        if (extraction) {
          const summary = extraction.summary.trim();
          if (summary.length > 0) {
            contentToStore = summary;
            memoryType = "summary";
          } else {
            contentToStore = conversationText;
            memoryType = "conversation";
          }
          memoryOperations = extraction.memoryOperations;
          if (memoryOperations.length > 0) {
            await applyMemoryOperationsToGraph({
              workspaceId,
              agentId,
              conversationId,
              memoryOperations,
            });
          }
        }
      } catch (error) {
        console.error(
          `[Memory Write] Memory extraction failed for conversation ${conversationId}, falling back to raw text:`,
          error instanceof Error
            ? {
                message: error.message,
                stack: error.stack,
                name: error.name,
              }
            : String(error),
        );
      }
    }

    // Create raw fact data (without embeddings) to queue for async processing
    const rawFacts: Array<{
      id: string;
      content: string;
      timestamp: string;
      metadata?: Record<string, unknown>;
      cacheKey?: string;
    }> = [];

    const now = new Date().toISOString();
    const factCacheKey = `${workspaceId}:${agentId}:${hashFact(contentToStore)}`;
    const metadata = {
      conversationId,
      workspaceId,
      agentId,
      memoryType,
    };
    console.log(
      `[Memory Write] Creating conversation memory record with metadata:`,
      JSON.stringify(metadata, null, 2),
    );
    rawFacts.push({
      id: `conversation-${conversationId}`,
      content: contentToStore,
      timestamp: now,
      metadata,
      cacheKey: factCacheKey,
    });

    // Queue write operation to SQS with raw facts (embeddings will be generated async)
    console.log(
      `[Memory Write] Queuing ${rawFacts.length} conversation record(s) to SQS for agent ${agentId}, conversation ${conversationId}`,
    );
    await sendWriteOperation({
      operation: "update",
      agentId,
      temporalGrain: "working",
      workspaceId, // Include workspaceId for API key lookup in queue handler
      data: {
        rawFacts,
      },
    });

    console.log(
      `[Memory Write] Successfully queued ${rawFacts.length} conversation record(s) to working memory for agent ${agentId}, conversation ${conversationId}`,
    );
  } catch (error) {
    // Log error but don't throw - memory writes should not block conversation logging
    console.error(
      `[Memory Write] Failed to write to working memory for conversation ${conversationId}, agent ${agentId}:`,
      error instanceof Error
        ? {
            message: error.message,
            stack: error.stack,
            name: error.name,
          }
        : String(error),
    );
  }
}

/**
 * Queue a memory write operation to SQS
 * Generic function for writing to any temporal grain
 */
export async function queueMemoryWrite(
  agentId: string,
  grain: TemporalGrain,
  records: FactRecord[],
): Promise<void> {
  if (records.length === 0) {
    return;
  }

  await sendWriteOperation({
    operation: "insert",
    agentId,
    temporalGrain: grain,
    data: {
      records,
    },
  });
}
