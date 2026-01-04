/**
 * Tool cost marker format: __HM_TOOL_COST__:8000
 * This format is less likely to appear in actual tool output content
 */
export const TOOL_COST_MARKER_PATTERN = /__HM_TOOL_COST__:(\d+)/g;

/**
 * Extracts cost from a tool result string and removes the cost marker.
 * 
 * The cost marker format is: __HM_TOOL_COST__:8000 (where 8000 represents cost in millionths)
 * If multiple markers are present, uses the last occurrence (most recent cost).
 * 
 * Note: Zero costs are allowed as they may represent legitimate free-tier usage or
 * tools that don't charge per call.
 * 
 * @param resultString - The tool result string that may contain a cost marker
 * @returns An object with:
 *   - costUsd: The extracted cost in millionths (e.g., 8000 = $0.008), or undefined if not found
 *   - processedResult: The result string with all cost markers removed
 */
export function extractToolCostFromResult(
  resultString: string
): { costUsd: number | undefined; processedResult: string } {
  // Find all cost markers in the string
  const allMatches = Array.from(resultString.matchAll(TOOL_COST_MARKER_PATTERN));

  if (allMatches.length === 0) {
    return { costUsd: undefined, processedResult: resultString };
  }

  // Use the last match (most recent cost if multiple markers exist)
  const lastMatch = allMatches[allMatches.length - 1];
  const costValue = parseInt(lastMatch[1], 10);

  // Validate the cost value
  // Note: Zero costs are allowed (may represent free-tier usage)
  if (isNaN(costValue) || costValue < 0) {
    return { costUsd: undefined, processedResult: resultString };
  }

  // Remove ALL cost markers from the string (not just the last one)
  // This ensures clean output even if multiple markers were accidentally added
  const processedResult = resultString
    .replace(TOOL_COST_MARKER_PATTERN, "")
    .trimEnd();

  return { costUsd: costValue, processedResult };
}

