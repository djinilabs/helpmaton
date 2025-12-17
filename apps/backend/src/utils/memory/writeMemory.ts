import { createHash, randomUUID } from "crypto";

import type { UIMessage } from "../../http/post-api-workspaces-000workspaceId-agents-000agentId-test/utils/types";
import { sendWriteOperation } from "../vectordb/queueClient";
import type { FactRecord, TemporalGrain } from "../vectordb/types";

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

/**
 * Extract facts from conversation messages
 * Creates fact records for each meaningful message (user and assistant messages)
 */
function extractFactsFromMessages(
  messages: UIMessage[]
): Array<{ text: string; timestamp: string }> {
  const facts: Array<{ text: string; timestamp: string }> = [];
  const now = new Date().toISOString();

  for (const message of messages) {
    // Only extract facts from user and assistant messages
    if (message.role !== "user" && message.role !== "assistant") {
      continue;
    }

    const text = extractTextFromMessage(message);
    if (text.trim().length === 0) {
      continue;
    }

    // Create a fact record for this message
    facts.push({
      text: `${
        message.role === "user" ? "User said" : "Assistant said"
      }: ${text}`,
      timestamp: now,
    });
  }

  return facts;
}

/**
 * Write conversation messages to working memory
 * Extracts facts and queues raw facts to SQS for async embedding generation
 */
export async function writeToWorkingMemory(
  agentId: string,
  workspaceId: string,
  conversationId: string,
  messages: UIMessage[]
): Promise<void> {
  console.log(
    `[Memory Write] Starting write to working memory for conversation ${conversationId}, agent ${agentId}, workspace ${workspaceId}, ${messages.length} messages`
  );

  try {
    // Extract facts from messages
    const facts = extractFactsFromMessages(messages);
    console.log(
      `[Memory Write] Extracted ${facts.length} facts from ${messages.length} messages for conversation ${conversationId}`
    );

    if (facts.length === 0) {
      console.log(
        `[Memory Write] No facts to write for conversation ${conversationId}. Messages:`,
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
        }))
      );
      return;
    }

    // Create raw fact data (without embeddings) to queue for async processing
    const rawFacts: Array<{
      id: string;
      content: string;
      timestamp: string;
      metadata?: Record<string, unknown>;
      cacheKey?: string;
    }> = [];

    for (const fact of facts) {
      // Generate cache key for this fact (workspace:agent:factHash)
      const factCacheKey = `${workspaceId}:${agentId}:${hashFact(fact.text)}`;
      const metadata = {
        conversationId,
        workspaceId,
        agentId,
      };
      console.log(
        `[Memory Write] Creating raw fact with metadata:`,
        JSON.stringify(metadata, null, 2)
      );
      rawFacts.push({
        id: randomUUID(),
        content: fact.text,
        timestamp: fact.timestamp,
        metadata,
        cacheKey: factCacheKey,
      });
    }

    // Queue write operation to SQS with raw facts (embeddings will be generated async)
    console.log(
      `[Memory Write] Queuing ${rawFacts.length} raw facts to SQS for agent ${agentId}, conversation ${conversationId} (embeddings will be generated asynchronously)`
    );
    await sendWriteOperation({
      operation: "insert",
      agentId,
      temporalGrain: "working",
      workspaceId, // Include workspaceId for API key lookup in queue handler
      data: {
        rawFacts,
      },
    });

    console.log(
      `[Memory Write] Successfully queued ${rawFacts.length} raw facts to working memory for agent ${agentId}, conversation ${conversationId}`
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
        : String(error)
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
  records: FactRecord[]
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
