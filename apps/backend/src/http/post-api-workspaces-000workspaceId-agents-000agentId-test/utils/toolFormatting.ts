/**
 * Formats tool call as UI message that will be converted to ModelMessage
 * Returns a message compatible with convertUIMessagesToModelMessages input
 */
export function formatToolCallMessage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK tool call types vary
  toolCall: any
): {
  role: "assistant";
  content: Array<{
    type: "tool-call";
    toolCallId: string;
    toolName: string;
    args: unknown;
    toolCallStartedAt?: string;
  }>;
} {
  const toolCallInput = toolCall.args || toolCall.input || {};
  return {
    role: "assistant" as const,
    content: [
      {
        type: "tool-call" as const,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        args: toolCallInput,
        ...(toolCall.toolCallStartedAt && { toolCallStartedAt: toolCall.toolCallStartedAt }),
      },
    ],
  };
}

/**
 * Tool cost marker format: __HM_TOOL_COST__:8000
 * This format is less likely to appear in actual tool output content
 */
const TOOL_COST_MARKER_PATTERN = /__HM_TOOL_COST__:(\d+)/g;

/**
 * Formats tool result as UI message with truncation
 * Extracts cost from result string if present (format: __HM_TOOL_COST__:8000)
 * Improved marker format that's less likely to conflict with actual content
 */
export function formatToolResultMessage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK tool result types vary
  toolResult: any
) {
  const MAX_RESULT_LENGTH = 2000;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK tool result types vary
  let outputValue: any =
    "output" in toolResult && toolResult.output !== undefined
      ? toolResult.output
      : "result" in toolResult && toolResult.result !== undefined
      ? toolResult.result
      : "";

  // Handle AI SDK LanguageModelV2ToolResultOutput format: { type: 'text', value: string }
  // or { type: 'json', value: JSONValue }
  if (
    outputValue &&
    typeof outputValue === "object" &&
    "type" in outputValue &&
    "value" in outputValue
  ) {
    if (outputValue.type === "text" && typeof outputValue.value === "string") {
      outputValue = outputValue.value;
    } else if (outputValue.type === "json") {
      // For JSON outputs, stringify them
      outputValue = JSON.stringify(outputValue.value);
    } else {
      // For other types, convert to string
      outputValue = String(outputValue.value);
    }
  }

  // Extract cost from result string if present (format: __HM_TOOL_COST__:8000)
  // IMPORTANT: Extract BEFORE truncation to ensure we don't lose the marker
  // The marker can appear anywhere in the string, but we prefer the last occurrence
  let costUsd: number | undefined;
  if (typeof outputValue === "string") {
    // Find all cost markers in the string
    const allMatches = Array.from(outputValue.matchAll(TOOL_COST_MARKER_PATTERN));
    
    if (allMatches.length > 0) {
      // Use the last match (most recent cost if multiple markers exist)
      const lastMatch = allMatches[allMatches.length - 1];
      const costValue = parseInt(lastMatch[1], 10);
      
      // Validate the cost value
      if (!isNaN(costValue) && costValue >= 0) {
        costUsd = costValue;
        
        // Remove ALL cost markers from the string (not just the last one)
        // This ensures clean output even if multiple markers were accidentally added
        outputValue = outputValue.replace(TOOL_COST_MARKER_PATTERN, "");
        
        // Clean up any trailing whitespace/newlines left by marker removal
        outputValue = outputValue.trimEnd();
      }
    }

    // Truncate if string (after cost extraction)
    if (outputValue.length > MAX_RESULT_LENGTH) {
      outputValue =
        outputValue.substring(0, MAX_RESULT_LENGTH) +
        "\n\n[Results truncated for brevity. Please provide a summary based on the information shown.]";
    }
  } else if (typeof outputValue !== "object" || outputValue === null) {
    outputValue = String(outputValue);
  }

  // In AI SDK v5, tool results should be in assistant messages, not tool messages
  return {
    role: "assistant" as const,
    content: [
      {
        type: "tool-result" as const,
        toolCallId: toolResult.toolCallId,
        toolName: toolResult.toolName,
        result: outputValue,
        ...(toolResult.toolExecutionTimeMs !== undefined && { toolExecutionTimeMs: toolResult.toolExecutionTimeMs }),
        ...(costUsd !== undefined && { costUsd }),
      },
    ],
  };
}

