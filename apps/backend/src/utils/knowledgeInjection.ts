import type { ModelMessage } from "ai";

import { searchDocuments, type SearchResult } from "./documentSearch";
import { rerankSnippets } from "./knowledgeReranking";

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
 * @returns Updated array of model messages with knowledge injected
 */
export async function injectKnowledgeIntoMessages(
  workspaceId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Agent type varies across codebase
  agent: any,
  messages: ModelMessage[]
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
    if (agent.enableKnowledgeReranking && agent.knowledgeRerankingModel) {
      try {
        finalResults = await rerankSnippets(
          query,
          searchResults,
          agent.knowledgeRerankingModel,
          workspaceId
        );
      } catch (error) {
        console.error(
          "[knowledgeInjection] Error during re-ranking, using original results:",
          error instanceof Error ? error.message : String(error)
        );
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
    // Return original messages if injection fails
    return messages;
  }
}
