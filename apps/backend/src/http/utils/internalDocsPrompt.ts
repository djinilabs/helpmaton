/**
 * Shared internal-docs prompt section and tool description for workspace and meta-agent.
 * Single source of truth so instructions stay in sync.
 */

import { getInternalDocsIndexForPrompt } from "../../utils/internalDocs";

export const READ_INTERNAL_DOC_TOOL_DESCRIPTION =
  "Read one internal documentation document (customer support). Use only doc IDs from the internal docs index in the system prompt. Returns the full markdown content or an error if the doc does not exist.";

/**
 * Full "Internal documentation (customer support)" section for system prompts.
 * Include this in both workspace agent and meta-agent prompts.
 */
export function getInternalDocsPromptSection(): string {
  return `
## Internal documentation (customer support)
When the user needs detailed product or technical information, use read_internal_doc(docId) with a doc ID from the index below. If the tool returns an error, you may try another doc ID; after 3 read attempts (success or failure), do not call read_internal_doc again for this request.

Index (use only these doc IDs):
${getInternalDocsIndexForPrompt()}
`;
}
