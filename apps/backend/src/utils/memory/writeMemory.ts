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
 * Extracts facts, generates embeddings, and queues to SQS
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

    // Get API key for embedding generation
    // Try workspace API key first, fall back to system key
    console.log(
      `[Memory Write] Getting API key for workspace ${workspaceId}...`
    );
    const workspaceApiKey = await getWorkspaceApiKey(workspaceId, "google");
    console.log(
      `[Memory Write] Workspace API key: ${
        workspaceApiKey ? "found" : "not found"
      }, using ${workspaceApiKey ? "workspace" : "system"} key`
    );
    const apiKey =
      workspaceApiKey ||
      getDefined(process.env.GEMINI_API_KEY, "GEMINI_API_KEY is not set");
    console.log(
      `[Memory Write] API key obtained, generating embeddings for ${facts.length} facts...`
    );

    // Generate embeddings for each fact
    const records: FactRecord[] = [];
    for (let i = 0; i < facts.length; i++) {
      const fact = facts[i];
      console.log(
        `[Memory Write] Generating embedding ${i + 1}/${
          facts.length
        } for fact: "${fact.text.substring(0, 50)}..."`
      );
      try {
        console.log(
          `[Memory Write] Calling generateEmbedding for fact ${i + 1}...`
        );
        const startTime = Date.now();
        const embedding = await generateEmbedding(
          fact.text,
          apiKey,
          undefined, // No cache key for now
          undefined // No abort signal
        );
        const duration = Date.now() - startTime;
        console.log(
          `[Memory Write] generateEmbedding completed for fact ${
            i + 1
          } in ${duration}ms`
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
        console.log(
          `[Memory Write] Successfully generated embedding ${i + 1}/${
            facts.length
          }`
        );
      } catch (error) {
        console.error(
          `[Memory Write] Failed to generate embedding ${i + 1}/${
            facts.length
          } for fact:`,
          error instanceof Error
            ? {
                message: error.message,
                stack: error.stack,
                name: error.name,
              }
            : String(error)
        );
        // Continue with other facts even if one fails
      }
    }

    console.log(
      `[Memory Write] Generated ${records.length} embeddings out of ${facts.length} facts`
    );

    if (records.length === 0) {
      console.log(
        `[Memory Write] No records to write after embedding generation`
      );
      return;
    }

    // Queue write operation to SQS
    console.log(
      `[Memory Write] Queuing ${records.length} records to SQS for agent ${agentId}, conversation ${conversationId}`
    );
    await sendWriteOperation({
      operation: "insert",
      agentId,
      temporalGrain: "working",
      data: {
        records,
      },
    });

    console.log(
      `[Memory Write] Successfully queued ${records.length} records to working memory for agent ${agentId}, conversation ${conversationId}`
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
