import type { Currency } from "../../utils/aggregation";

export const ALLOWED_CURRENCIES: Currency[] = ["usd", "eur", "gbp"];

/**
 * Calculate document metrics (count and total size) from files and text documents
 * This helper function reduces code duplication in document upload endpoints
 */
export function calculateDocumentMetrics(
  files: Express.Multer.File[] | undefined,
  textDocuments: Array<{ name?: string; content?: string }> | undefined
): { totalSize: number; documentCount: number } {
  let totalSize = 0;
  let documentCount = 0;

  if (files && files.length > 0) {
    documentCount += files.length;
    totalSize += files.reduce((sum, file) => sum + file.size, 0);
  }

  if (Array.isArray(textDocuments)) {
    // Only count documents that have both name and content (consistent with actual processing)
    const validTextDocuments = textDocuments.filter(
      (doc) => doc.name && doc.content
    );
    documentCount += validTextDocuments.length;
    totalSize += validTextDocuments.reduce((sum, doc) => {
      // doc.content is guaranteed to exist due to filter above
      return sum + Buffer.byteLength(doc.content!, "utf-8");
    }, 0);
  }

  return { totalSize, documentCount };
}
