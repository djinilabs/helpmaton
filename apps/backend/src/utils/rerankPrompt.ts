/**
 * Shared prompt builder for reranking via chat completions.
 * Used by knowledgeReranking.ts and the test script so the prompt stays in sync.
 */

export const DEFAULT_MAX_SNIPPET_CHARS = 500;

/**
 * Truncate text to max length, appending "..." if truncated.
 */
function truncateSnippet(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 3) + "...";
}

export interface BuildRerankPromptOptions {
  maxSnippetChars?: number;
}

/**
 * Build the user prompt for reranking: query + documents, asking for a JSON array of indices.
 * Long documents are truncated to avoid context overflow and reduce cost.
 */
export function buildRerankPrompt(
  query: string,
  documents: string[],
  options: BuildRerankPromptOptions = {}
): string {
  const maxChars = options.maxSnippetChars ?? DEFAULT_MAX_SNIPPET_CHARS;
  const truncated = documents.map((text) => truncateSnippet(text, maxChars));
  const docList = truncated
    .map((text, i) => `Document ${i}: ${text}`)
    .join("\n\n");
  return `You are a relevance rater. Given a search query and a list of documents, output the document indices in order of relevance to the query, most relevant first.

Reply with only a JSON array of indices, no other text. Example: [2, 0, 1, 3]

Query: ${query}

Documents:
${docList}

Order (JSON array of indices):`;
}
