import type { ModelMessage } from "ai";

import type { DatabaseSchema } from "../tables/schema";

import { searchDocuments, type SearchResult } from "./documentSearch";
import { rerankSnippets } from "./knowledgeReranking";
import {
  adjustRerankingCreditReservation,
  queueRerankingCostVerification,
  refundRerankingCredits,
  reserveRerankingCredits,
} from "./knowledgeRerankingCredits";
import { Sentry, ensureError } from "./sentry";
import type { AugmentedContext } from "./workspaceCreditContext";

/**
 * Format search results into a structured knowledge prompt
 * @param results - Array of search results (snippets)
 * @returns Formatted knowledge prompt text
 */
function formatKnowledgePrompt(results: SearchResult[]): string {
  if (results.length === 0) {
    return "";
  }

  const snippetsText = results
    .map((result, index) => {
      const folderPathText = result.folderPath
        ? ` (${result.folderPath})`
        : "";
      const similarityPercent = (result.similarity * 100).toFixed(1);

      return `[${index + 1}] Document: ${result.documentName}${folderPathText}
Similarity: ${similarityPercent}%
Content:
${result.snippet}

---`;
    })
    .join("\n\n");

  return `## Relevant Knowledge from Workspace Documents

The following information has been retrieved from your workspace documents that may be relevant to your query:

${snippetsText}

---

Please use this information to provide a comprehensive and accurate response to the user's query below.`;
}

/**
 * Extract query text from the first user message in the conversation
 * @param messages - Array of model messages
 * @returns Query text extracted from the first user message, or empty string if not found
 */
function extractQueryFromMessages(messages: ModelMessage[]): string {
  // Find the first user message
  const firstUserMessage = messages.find(
    (msg) => msg.role === "user"
  );

  if (!firstUserMessage) {
    return "";
  }

  // Extract text content from user message
  if (typeof firstUserMessage.content === "string") {
    return firstUserMessage.content.trim();
  }

  if (Array.isArray(firstUserMessage.content)) {
    // Extract text from content array
    const textParts = firstUserMessage.content
      .filter((part) => part.type === "text")
      .map((part) => (typeof part === "string" ? part : part.text))
      .join("");
    return textParts.trim();
  }

  return "";
}

/**
 * Inject knowledge from workspace documents into the conversation messages
 * Knowledge is injected as a new user message before the first user message
 * @param workspaceId - Workspace ID for document search
 * @param agent - Agent configuration
 * @param messages - Array of model messages to inject knowledge into
 * @param db - Database instance (optional, required for credit management)
 * @param context - Augmented Lambda context (optional, required for credit transactions)
 * @param agentId - Agent ID (optional, for credit tracking)
 * @param conversationId - Conversation ID (optional, for credit tracking)
 * @param usesByok - Whether workspace is using their own API key (optional)
 * @returns Updated array of model messages with knowledge injected
 */
export async function injectKnowledgeIntoMessages(
  workspaceId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Agent type varies across codebase
  agent: any,
  messages: ModelMessage[],
  db?: DatabaseSchema,
  context?: AugmentedContext,
  agentId?: string,
  conversationId?: string,
  usesByok?: boolean
): Promise<ModelMessage[]> {
  // Check if knowledge injection is enabled
  if (!agent.enableKnowledgeInjection) {
    return messages;
  }

  // Extract query from first user message
  const query = extractQueryFromMessages(messages);
  if (!query || query.length === 0) {
    // No query to search for, skip injection
    return messages;
  }

  // Get snippet count (default: 5)
  const snippetCount = agent.knowledgeInjectionSnippetCount ?? 5;
  // Clamp to valid range (1-50)
  const validSnippetCount = Math.max(1, Math.min(50, snippetCount));

  try {
    // Search for relevant documents
    const searchResults = await searchDocuments(
      workspaceId,
      query,
      validSnippetCount
    );

    if (searchResults.length === 0) {
      // No documents found, skip injection
      return messages;
    }

    // Re-rank if enabled
    let finalResults = searchResults;
    let rerankingReservationId: string | undefined;
    
    if (agent.enableKnowledgeReranking && agent.knowledgeRerankingModel) {
      // Step 1: Reserve credits before re-ranking call
      if (db && context) {
        try {
          const reservation = await reserveRerankingCredits(
            db,
            workspaceId,
            agent.knowledgeRerankingModel,
            searchResults.length,
            3, // maxRetries
            context,
            agentId,
            conversationId,
            usesByok
          );
          rerankingReservationId = reservation.reservationId;
          console.log(
            "[knowledgeInjection] Reserved credits for re-ranking:",
            {
              reservationId: rerankingReservationId,
              reservedAmount: reservation.reservedAmount,
            }
          );
        } catch (error) {
          console.error(
            "[knowledgeInjection] Failed to reserve credits for re-ranking:",
            error instanceof Error ? error.message : String(error)
          );
          Sentry.captureException(ensureError(error), {
            tags: {
              context: "knowledge-injection",
              operation: "reserve-reranking-credits",
            },
            extra: {
              workspaceId,
              agentId,
              conversationId,
              model: agent.knowledgeRerankingModel,
              documentCount: searchResults.length,
            },
          });
          // If credit reservation fails (e.g., insufficient credits), continue with re-ranking
          // but without credit tracking (workspace won't be charged)
          console.warn(
            "[knowledgeInjection] Credit reservation failed, continuing re-ranking without credit tracking"
          );
        }
      }

      // Step 2: Make re-ranking API call
      try {
        const rerankingResult = await rerankSnippets(
          query,
          searchResults,
          agent.knowledgeRerankingModel,
          workspaceId
        );
        finalResults = rerankingResult.snippets;

        // Step 2: Adjust credits based on provisional cost
        if (db && context && rerankingReservationId) {
          try {
            await adjustRerankingCreditReservation(
              db,
              rerankingReservationId,
              workspaceId,
              rerankingResult.costUsd,
              rerankingResult.generationId,
              context,
              3, // maxRetries
              agentId,
              conversationId
            );

            // Step 3: Queue async cost verification if generationId is available
            if (rerankingResult.generationId) {
              await queueRerankingCostVerification(
                rerankingReservationId,
                rerankingResult.generationId,
                workspaceId,
                agentId,
                conversationId
              );
            }
          } catch (error) {
            console.error(
              "[knowledgeInjection] Error adjusting re-ranking credits:",
              error instanceof Error ? error.message : String(error)
            );
            Sentry.captureException(ensureError(error), {
              tags: {
                context: "knowledge-injection",
                operation: "adjust-reranking-credits",
              },
              extra: {
                workspaceId,
                agentId,
                conversationId,
                reservationId: rerankingReservationId,
                costUsd: rerankingResult.costUsd,
                generationId: rerankingResult.generationId,
              },
            });
            // Continue even if adjustment fails - transaction will use estimated cost
          }
        }
      } catch (error) {
        console.error(
          "[knowledgeInjection] Error during re-ranking, using original results:",
          error instanceof Error ? error.message : String(error)
        );
        Sentry.captureException(ensureError(error), {
          tags: {
            context: "knowledge-injection",
            operation: "rerank-snippets",
          },
          extra: {
            workspaceId,
            agentId,
            conversationId,
            model: agent.knowledgeRerankingModel,
            documentCount: searchResults.length,
            reservationId: rerankingReservationId,
          },
        });
        
        // Refund reserved credits if re-ranking fails
        if (db && context && rerankingReservationId) {
          try {
            await refundRerankingCredits(
              db,
              rerankingReservationId,
              workspaceId,
              context,
              3, // maxRetries
              agentId,
              conversationId
            );
          } catch (refundError) {
            console.error(
              "[knowledgeInjection] Error refunding re-ranking credits:",
              refundError instanceof Error
                ? refundError.message
                : String(refundError)
            );
            Sentry.captureException(ensureError(refundError), {
              tags: {
                context: "knowledge-injection",
                operation: "refund-reranking-credits",
              },
              extra: {
                workspaceId,
                agentId,
                conversationId,
                reservationId: rerankingReservationId,
                originalError: error instanceof Error ? error.message : String(error),
              },
            });
            // Continue even if refund fails - reservation will expire
          }
        }
        
        // Fall back to original results if re-ranking fails
        finalResults = searchResults;
      }
    }

    // Format knowledge prompt
    const knowledgePrompt = formatKnowledgePrompt(finalResults);
    if (!knowledgePrompt || knowledgePrompt.length === 0) {
      return messages;
    }

    // Create knowledge injection message
    const knowledgeMessage: ModelMessage = {
      role: "user",
      content: knowledgePrompt,
    };

    // Find the index of the first user message
    const firstUserIndex = messages.findIndex((msg) => msg.role === "user");

    if (firstUserIndex === -1) {
      // No user message found, prepend knowledge message
      return [knowledgeMessage, ...messages];
    }

    // Insert knowledge message before the first user message
    const updatedMessages = [...messages];
    updatedMessages.splice(firstUserIndex, 0, knowledgeMessage);

    return updatedMessages;
  } catch (error) {
    console.error(
      "[knowledgeInjection] Error during knowledge injection:",
      error instanceof Error ? error.message : String(error)
    );
    Sentry.captureException(ensureError(error), {
      tags: {
        context: "knowledge-injection",
        operation: "inject-knowledge",
      },
      extra: {
        workspaceId,
        agentId,
        conversationId,
        enableKnowledgeInjection: agent.enableKnowledgeInjection,
        enableKnowledgeReranking: agent.enableKnowledgeReranking,
        snippetCount: validSnippetCount,
      },
    });
    // Return original messages if injection fails
    return messages;
  }
}
