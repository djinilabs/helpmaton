import { randomUUID } from "crypto";

import type { UIMessage } from "../../http/post-api-workspaces-000workspaceId-agents-000agentId-test/utils/types";
import { getWorkspaceApiKey } from "../../http/utils/agentUtils";
import { getDefined } from "../../utils";
import { generateEmbedding } from "../documentSearch";
import { sendWriteOperation } from "../vectordb/queueClient";
import type { FactRecord, TemporalGrain } from "../vectordb/types";

/**
 * Extract text content from a UIMessage
 * Handles both string and array content formats
 */
function extractTextFromMessage(message: UIMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    return message.content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (typeof item === "object" && item !== null) {
          if ("type" in item && item.type === "text" && "text" in item) {
            return String(item.text);
          }
        }
        return "";
      })
      .filter((text) => text.length > 0)
      .join(" ");
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
 * Extracts facts, generates embeddings, and queues to SQS
 */
export async function writeToWorkingMemory(
  agentId: string,
  workspaceId: string,
  conversationId: string,
  messages: UIMessage[]
): Promise<void> {
  try {
    // Extract facts from messages
    const facts = extractFactsFromMessages(messages);
    if (facts.length === 0) {
      console.log(
        `[Memory Write] No facts to write for conversation ${conversationId}`
      );
      return;
    }

    // Get API key for embedding generation
    // Try workspace API key first, fall back to system key
    const workspaceApiKey = await getWorkspaceApiKey(workspaceId, "google");
    const apiKey =
      workspaceApiKey ||
      getDefined(process.env.GEMINI_API_KEY, "GEMINI_API_KEY is not set");

    // Generate embeddings for each fact
    const records: FactRecord[] = [];
    for (const fact of facts) {
      try {
        const embedding = await generateEmbedding(
          fact.text,
          apiKey,
          undefined, // No cache key for now
          undefined // No abort signal
        );

        records.push({
          id: randomUUID(),
          content: fact.text,
          embedding,
          timestamp: fact.timestamp,
          metadata: {
            conversationId,
            workspaceId,
            agentId,
          },
        });
      } catch (error) {
        console.error(
          `[Memory Write] Failed to generate embedding for fact:`,
          error
        );
        // Continue with other facts even if one fails
      }
    }

    if (records.length === 0) {
      console.log(
        `[Memory Write] No records to write after embedding generation`
      );
      return;
    }

    // Queue write operation to SQS
    await sendWriteOperation({
      operation: "insert",
      agentId,
      temporalGrain: "working",
      data: {
        records,
      },
    });

    console.log(
      `[Memory Write] Queued ${records.length} records to working memory for agent ${agentId}`
    );
  } catch (error) {
    // Log error but don't throw - memory writes should not block conversation logging
    console.error(
      `[Memory Write] Failed to write to working memory:`,
      error instanceof Error ? error.message : String(error)
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
