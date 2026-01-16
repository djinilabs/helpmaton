/**
 * Delegation metadata marker format: __HM_DELEGATION__:{"targetAgentId":"...","targetConversationId":"..."}
 * This format is less likely to appear in actual tool output content
 */
export const DELEGATION_MARKER_PATTERN = /__HM_DELEGATION__:(\{[^}]+\})/g;

export interface DelegationMetadata {
  callingAgentId: string;
  targetAgentId: string;
  targetConversationId?: string;
  status: "completed" | "failed" | "cancelled";
  timestamp: string;
  taskId?: string;
}

/**
 * Extracts delegation metadata from a tool result string and removes the delegation marker.
 * 
 * The delegation marker format is: __HM_DELEGATION__:{"targetAgentId":"...","targetConversationId":"...",...}
 * 
 * @param resultString - The tool result string that may contain a delegation marker
 * @returns An object with:
 *   - delegation: The extracted delegation metadata, or undefined if not found
 *   - processedResult: The result string with the delegation marker removed
 */
export function extractDelegationFromResult(
  resultString: string
): { delegation: DelegationMetadata | undefined; processedResult: string } {
  // Find all delegation markers in the string
  const allMatches = Array.from(resultString.matchAll(DELEGATION_MARKER_PATTERN));

  if (allMatches.length === 0) {
    return { delegation: undefined, processedResult: resultString };
  }

  // Use the last match (most recent delegation if multiple markers exist)
  const lastMatch = allMatches[allMatches.length - 1];
  let delegation: DelegationMetadata | undefined;

  try {
    const delegationJson = lastMatch[1];
    delegation = JSON.parse(delegationJson) as DelegationMetadata;
  } catch (error) {
    console.error("[Delegation Extraction] Failed to parse delegation metadata:", error);
    // Remove the marker but don't extract delegation
    const processedResult = resultString
      .replace(DELEGATION_MARKER_PATTERN, "")
      .trimEnd();
    return { delegation: undefined, processedResult };
  }

  // Remove ALL delegation markers from the string
  const processedResult = resultString
    .replace(DELEGATION_MARKER_PATTERN, "")
    .trimEnd();

  return { delegation, processedResult };
}
