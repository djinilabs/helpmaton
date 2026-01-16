/**
 * Delegation metadata marker format: __HM_DELEGATION__:{"targetAgentId":"...","targetConversationId":"..."}
 * This format is less likely to appear in actual tool output content
 * 
 * The regex matches __HM_DELEGATION__: followed by a JSON object.
 * We need to match the full JSON object, so we use a pattern that finds the marker
 * and then we'll manually extract the balanced JSON object.
 */
export const DELEGATION_MARKER_PATTERN = /__HM_DELEGATION__:/g;

export interface DelegationMetadata {
  callingAgentId: string;
  targetAgentId: string;
  targetConversationId?: string;
  status: "completed" | "failed" | "cancelled";
  timestamp: string;
  taskId?: string;
}

/**
 * Finds the end of a JSON object starting at a given position by matching balanced braces
 */
function findJsonObjectEnd(str: string, startPos: number): number | null {
  if (str[startPos] !== "{") {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startPos; i < str.length; i++) {
    const char = str[i];

    // Handle escaped characters - reset escape flag and continue processing
    if (escapeNext) {
      escapeNext = false;
      // Continue processing the escaped character normally
      // (it's part of the string content, not structural)
      continue;
    }

    // Handle backslash - only treat as escape when inside a string
    if (char === "\\" && inString) {
      escapeNext = true;
      continue;
    }

    // Handle quotes - only toggle string state if not escaped
    if (char === '"') {
      inString = !inString;
      continue;
    }

    // Skip all characters inside strings (except structural ones we've already handled)
    if (inString) {
      continue;
    }

    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        return i + 1; // Return position after the closing brace
      }
    }
  }

  return null; // Unbalanced braces
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
  const markerStart = lastMatch.index!;
  const jsonStart = markerStart + lastMatch[0].length; // Position after "__HM_DELEGATION__:"

  // Find the end of the JSON object
  const jsonEnd = findJsonObjectEnd(resultString, jsonStart);
  if (!jsonEnd) {
    console.error("[Delegation Extraction] Could not find end of JSON object");
    // Remove the marker but don't extract delegation
    const processedResult = resultString
      .replace(DELEGATION_MARKER_PATTERN, "")
      .trimEnd();
    return { delegation: undefined, processedResult };
  }

  let delegation: DelegationMetadata | undefined;

  try {
    const delegationJson = resultString.substring(jsonStart, jsonEnd);
    delegation = JSON.parse(delegationJson) as DelegationMetadata;
  } catch (error) {
    console.error("[Delegation Extraction] Failed to parse delegation metadata:", error);
    // Remove the marker but don't extract delegation
    const processedResult = resultString
      .replace(DELEGATION_MARKER_PATTERN, "")
      .trimEnd();
    return { delegation: undefined, processedResult };
  }

  // Remove ALL delegation markers and their JSON objects from the string
  let processedResult = resultString;
  // Process from end to start to maintain correct indices
  for (let i = allMatches.length - 1; i >= 0; i--) {
    const match = allMatches[i];
    const matchStart = match.index!;
    const jsonStartPos = matchStart + match[0].length;
    const jsonEndPos = findJsonObjectEnd(processedResult, jsonStartPos);
    if (jsonEndPos) {
      // Remove the marker and the JSON object
      processedResult =
        processedResult.substring(0, matchStart) +
        processedResult.substring(jsonEndPos);
    } else {
      // Fallback: just remove the marker
      processedResult =
        processedResult.substring(0, matchStart) +
        processedResult.substring(matchStart + match[0].length);
    }
  }

  processedResult = processedResult.trimEnd();

  return { delegation, processedResult };
}
