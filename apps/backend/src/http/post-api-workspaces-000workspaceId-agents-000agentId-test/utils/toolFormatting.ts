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
 * Formats tool result as UI message with truncation
 * Extracts cost from result string if present (format: [TOOL_COST:8000])
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

  // Extract cost from result string if present (format: [TOOL_COST:8000])
  // Only extract if marker is at the end of the string (with optional newlines before it)
  let costUsd: number | undefined;
  if (typeof outputValue === "string") {
    const costMatch = outputValue.match(/\n\n\[TOOL_COST:(\d+)\]$/);
    if (costMatch) {
      costUsd = parseInt(costMatch[1], 10);
      // Remove cost marker from result string
      outputValue = outputValue.replace(/\n\n\[TOOL_COST:\d+\]$/, "");
    }

    // Truncate if string
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

