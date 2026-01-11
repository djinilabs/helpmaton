import type { ModelMessage } from "ai";

import type { DatabaseSchema } from "../tables/schema";

import { fromMillionths, toMillionths } from "./creditConversions";
import { InsufficientCreditsError } from "./creditErrors";
import { searchDocuments, type SearchResult } from "./documentSearch";
import { rerankSnippets } from "./knowledgeReranking";
import {
  adjustRerankingCreditReservation,
  queueRerankingCostVerification,
  refundRerankingCredits,
  reserveRerankingCredits,
} from "./knowledgeRerankingCredits";
import type {
  RerankingRequestContent,
  RerankingResultContent,
  UIMessage,
} from "./messageTypes";
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
 * Find existing knowledge injection message in conversation
 * @param messages - Array of UI messages from conversation
 * @returns Knowledge injection message if found, null otherwise
 */
function findExistingKnowledgeInjectionMessage(
  messages: UIMessage[]
): UIMessage | null {
  return (
    messages.find(
      (msg) =>
        msg.role === "user" &&
        "knowledgeInjection" in msg &&
        msg.knowledgeInjection === true
    ) || null
  );
}

/**
 * Extract query text from the first user message in the conversation
 * @param messages - Array of model messages
 * @returns Query text extracted from the first user message, or empty string if not found
 */
function extractQueryFromMessages(messages: ModelMessage[]): string {
  // Find the first user message (skip knowledge injection messages)
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
 * Result from knowledge injection
 */
export interface KnowledgeInjectionResult {
  modelMessages: ModelMessage[];
  knowledgeInjectionMessage: UIMessage | null;
  rerankingRequestMessage?: UIMessage; // Message showing the re-ranking request
  rerankingResultMessage?: UIMessage; // Message showing the re-ranking response with cost
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
 * @param existingConversationMessages - Existing UI messages from conversation (optional, for reuse)
 * @returns Updated array of model messages with knowledge injected, and knowledge injection UI message
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
  usesByok?: boolean,
  existingConversationMessages?: UIMessage[]
): Promise<KnowledgeInjectionResult> {
  // Check if knowledge injection is enabled
  if (!agent.enableKnowledgeInjection) {
    return {
      modelMessages: messages,
      knowledgeInjectionMessage: null,
      rerankingRequestMessage: undefined,
      rerankingResultMessage: undefined,
    };
  }

  // Check for existing knowledge injection message in conversation
  let finalResults: SearchResult[] | undefined;
  let rerankingRequestMessage: UIMessage | undefined;
  let rerankingResultMessage: UIMessage | undefined;

  if (existingConversationMessages && existingConversationMessages.length > 0) {
    const existingKnowledgeMessage =
      findExistingKnowledgeInjectionMessage(existingConversationMessages);
    if (
      existingKnowledgeMessage &&
      existingKnowledgeMessage.role === "user" &&
      existingKnowledgeMessage.knowledgeInjection === true &&
      existingKnowledgeMessage.knowledgeSnippets &&
      Array.isArray(existingKnowledgeMessage.knowledgeSnippets)
    ) {
      // Reuse existing snippets
      console.log(
        "[knowledgeInjection] Reusing existing knowledge injection message with",
        existingKnowledgeMessage.knowledgeSnippets.length,
        "snippets"
      );
      finalResults = existingKnowledgeMessage.knowledgeSnippets;
    }
  }

  // Extract query from first user message
  const query = extractQueryFromMessages(messages);
  if (!query || query.length === 0) {
    // No query to search for, skip injection
    return {
      modelMessages: messages,
      knowledgeInjectionMessage: null,
      rerankingRequestMessage: undefined,
      rerankingResultMessage: undefined,
    };
  }

  // If we don't have existing results, perform search
  if (!finalResults) {
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
        return {
          modelMessages: messages,
          knowledgeInjectionMessage: null,
          rerankingRequestMessage: undefined,
          rerankingResultMessage: undefined,
        };
      }

      finalResults = searchResults;

      // Re-rank if enabled (only if we just searched, not if reusing existing)
      let rerankingReservationId: string | undefined;

      if (agent.enableKnowledgeReranking && agent.knowledgeRerankingModel) {
      // Step 1: Reserve credits before re-ranking call
      // Credit reservation is required unless BYOK is enabled
      if (!usesByok) {
        if (!db || !context) {
          throw new Error(
            "Database and context are required for re-ranking credit reservation"
          );
        }

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
          const errorObj = ensureError(error);
          
          // If it's an InsufficientCreditsError, rethrow it to fail the request
          // This matches the behavior of regular LLM calls
          if (errorObj instanceof InsufficientCreditsError) {
            console.error(
              "[knowledgeInjection] Insufficient credits for re-ranking, failing request:",
              errorObj.message
            );
            Sentry.captureException(errorObj, {
              tags: {
                context: "knowledge-injection",
                operation: "reserve-reranking-credits",
                errorType: "InsufficientCreditsError",
              },
              extra: {
                workspaceId,
                agentId,
                conversationId,
                model: agent.knowledgeRerankingModel,
                documentCount: searchResults.length,
                required: errorObj.required,
                available: errorObj.available,
              },
            });
            throw errorObj;
          }

          // For other errors (e.g., database errors), log and fail the request
          console.error(
            "[knowledgeInjection] Failed to reserve credits for re-ranking:",
            errorObj.message
          );
          Sentry.captureException(errorObj, {
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
          // Rethrow to fail the request
          throw errorObj;
        }
      } else {
        // BYOK: Skip credit reservation (workspace pays directly)
        console.log(
          "[knowledgeInjection] BYOK enabled, skipping credit reservation for re-ranking"
        );
      }

        // Create re-ranking request message with text representation
        const documentNames = finalResults.map((result) => result.documentName);
        const rerankingRequestContent: RerankingRequestContent = {
          type: "reranking-request",
          query,
          model: agent.knowledgeRerankingModel,
          documentCount: finalResults.length,
          documentNames,
        };

        // Create user-friendly text representation with clear model indication
        const requestText = `**Re-ranking Request**\n\n- **Model:** ${agent.knowledgeRerankingModel}\n- **Documents:** ${finalResults.length} document${finalResults.length !== 1 ? "s" : ""}\n- **Query:** "${query}"`;

        rerankingRequestMessage = {
          role: "system",
          content: [
            { type: "text", text: requestText },
            rerankingRequestContent,
          ],
        };

        // Step 2: Make re-ranking API call
        const rerankingStartTime = Date.now();
        try {
          const rerankingResult = await rerankSnippets(
            query,
            finalResults,
            agent.knowledgeRerankingModel,
            workspaceId
          );
          const rerankingExecutionTime = Date.now() - rerankingStartTime;
          finalResults = rerankingResult.snippets;

          // Create re-ranking result message
          const costInMillionths = rerankingResult.costUsd
            ? toMillionths(rerankingResult.costUsd)
            : undefined;

          const rerankingResultContent: RerankingResultContent = {
            type: "reranking-result",
            model: agent.knowledgeRerankingModel,
            documentCount: rerankingResult.snippets.length,
            costUsd: costInMillionths ?? 0, // Default to 0 if cost not available
            ...(rerankingResult.generationId && {
              generationId: rerankingResult.generationId,
            }),
            executionTimeMs: rerankingExecutionTime,
            rerankedDocuments: rerankingResult.snippets.map((snippet) => ({
              documentName: snippet.documentName,
              relevanceScore: snippet.similarity,
            })),
          };

          // Create user-friendly text representation with clear model and cost
          const costDisplay = costInMillionths
            ? `$${fromMillionths(costInMillionths).toFixed(6)}`
            : "$0.000000";
          const resultText = `**Re-ranking Result**\n\n- **Model:** ${agent.knowledgeRerankingModel}\n- **Cost:** ${costDisplay}\n- **Documents Re-ranked:** ${rerankingResult.snippets.length} document${rerankingResult.snippets.length !== 1 ? "s" : ""}`;

          rerankingResultMessage = {
            role: "system",
            content: [
              { type: "text", text: resultText },
              rerankingResultContent,
            ],
          };

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
          const rerankingExecutionTime = Date.now() - rerankingStartTime;
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
              documentCount: finalResults.length,
              reservationId: rerankingReservationId,
            },
          });

          // Create error result message
          const rerankingResultContent: RerankingResultContent = {
            type: "reranking-result",
            model: agent.knowledgeRerankingModel,
            documentCount: finalResults.length,
            costUsd: 0, // No cost if re-ranking failed
            executionTimeMs: rerankingExecutionTime,
            rerankedDocuments: finalResults.map((snippet) => ({
              documentName: snippet.documentName,
              relevanceScore: snippet.similarity, // Use original similarity scores
            })),
            error: error instanceof Error ? error.message : String(error),
          };

          // Create user-friendly text representation for error case with model and cost
          const errorText = `**Re-ranking Result (Failed)**\n\n- **Model:** ${agent.knowledgeRerankingModel}\n- **Cost:** $0.000000\n- **Error:** ${error instanceof Error ? error.message : String(error)}\n- **Action:** Using original document order`;

          rerankingResultMessage = {
            role: "system",
            content: [
              { type: "text", text: errorText },
              rerankingResultContent,
            ],
          };

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
          // finalResults already has the original searchResults
        }
      }
    } catch (error) {
      console.error(
        "[knowledgeInjection] Error during document search:",
        error instanceof Error ? error.message : String(error)
      );
      Sentry.captureException(ensureError(error), {
        tags: {
          context: "knowledge-injection",
          operation: "search-documents",
        },
        extra: {
          workspaceId,
          agentId,
          conversationId,
          query,
        },
      });
      // Return original messages if search fails
      return {
        modelMessages: messages,
        knowledgeInjectionMessage: null,
        rerankingRequestMessage: undefined,
        rerankingResultMessage: undefined,
      };
    }
  }

  // At this point, finalResults should be set
  if (!finalResults || finalResults.length === 0) {
    return {
      modelMessages: messages,
      knowledgeInjectionMessage: null,
      rerankingRequestMessage: undefined,
      rerankingResultMessage: undefined,
    };
  }

  // Filter snippets by minimum similarity score
  const minSimilarity = agent.knowledgeInjectionMinSimilarity ?? 0;
  const filteredResults = finalResults.filter(
    (result) => result.similarity >= minSimilarity
  );

  // If filtering results in empty array, return early
  if (filteredResults.length === 0) {
    return {
      modelMessages: messages,
      knowledgeInjectionMessage: null,
      rerankingRequestMessage: undefined,
      rerankingResultMessage: undefined,
    };
  }

  try {

    // Format knowledge prompt
    const knowledgePrompt = formatKnowledgePrompt(filteredResults);
    if (!knowledgePrompt || knowledgePrompt.length === 0) {
      return {
        modelMessages: messages,
        knowledgeInjectionMessage: null,
        rerankingRequestMessage: undefined,
        rerankingResultMessage: undefined,
      };
    }

    // Create knowledge injection ModelMessage for LLM
    const knowledgeModelMessage: ModelMessage = {
      role: "user",
      content: knowledgePrompt,
    };

    // Create knowledge injection UIMessage for conversation logging
    const knowledgeUIMessage: UIMessage = {
      role: "user",
      content: knowledgePrompt,
      knowledgeInjection: true,
      knowledgeSnippets: filteredResults,
    };

    // Find the index of the first user message (skip any existing knowledge injection messages)
    const firstUserIndex = messages.findIndex((msg) => msg.role === "user");

    if (firstUserIndex === -1) {
      // No user message found, prepend knowledge message
      return {
        modelMessages: [knowledgeModelMessage, ...messages],
        knowledgeInjectionMessage: knowledgeUIMessage,
        rerankingRequestMessage,
        rerankingResultMessage,
      };
    }

    // Insert knowledge message before the first user message
    const updatedMessages = [...messages];
    updatedMessages.splice(firstUserIndex, 0, knowledgeModelMessage);

    return {
      modelMessages: updatedMessages,
      knowledgeInjectionMessage: knowledgeUIMessage,
      rerankingRequestMessage,
      rerankingResultMessage,
    };
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
      },
    });
    // Return original messages if injection fails
    return {
      modelMessages: messages,
      knowledgeInjectionMessage: null,
      rerankingRequestMessage: undefined,
      rerankingResultMessage: undefined,
    };
  }
}
