/**
 * Shared logic for read_internal_doc tool: validate docId, enforce 3-attempt cap,
 * return content or error string. Used by workspace agent and meta-agent.
 */

import { INTERNAL_DOCS_CONTENT } from "../../utils/internalDocs";

const MAX_READ_ATTEMPTS = 3;

export type ReadInternalDocState = { callCount: number };

export const DOC_NOT_FOUND_ERROR = "Document not found";
export const MAX_ATTEMPTS_ERROR =
  "Max read attempts (3) exceeded. Do not call read_internal_doc again for this request.";

/** Normalize docId for lookup: trim, lowercase, strip .md, underscores to hyphens. */
export function normalizeInternalDocId(docId: string): string {
  return docId
    .trim()
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/_/g, "-");
}

/**
 * Executes the read_internal_doc logic. Always returns a string (content or JSON error)
 * so the agent can recover. Mutates state.callCount.
 * Normalizes docId so "Getting-Started", "getting-started.md", "getting_started" all resolve.
 */
export function executeReadInternalDoc(
  state: ReadInternalDocState,
  docId: string
): string {
  try {
    state.callCount += 1;
    if (state.callCount > MAX_READ_ATTEMPTS) {
      return JSON.stringify({ error: MAX_ATTEMPTS_ERROR });
    }

    if (!docId || typeof docId !== "string" || docId.trim() === "") {
      return JSON.stringify({
        error: DOC_NOT_FOUND_ERROR,
        docId: docId ?? "",
        hint: "Use only doc IDs from the internal docs index.",
      });
    }

    const normalizedId = normalizeInternalDocId(docId);
    const content = INTERNAL_DOCS_CONTENT[normalizedId];
    if (content === undefined) {
      return JSON.stringify({
        error: DOC_NOT_FOUND_ERROR,
        docId: normalizedId,
        hint: "Use only doc IDs from the internal docs index.",
      });
    }

    return content;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : String(err);
    return JSON.stringify({
      error: "Failed to read document",
      docId,
      message: message.slice(0, 200),
    });
  }
}
