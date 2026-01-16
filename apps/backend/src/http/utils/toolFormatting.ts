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
        ...(toolCall.toolCallStartedAt && {
          toolCallStartedAt: toolCall.toolCallStartedAt,
        }),
      },
    ],
  };
}

import {
  extractToolCostFromResult,
  TOOL_COST_MARKER_PATTERN,
} from "./toolCostExtraction";
import {
  extractDelegationFromResult,
  type DelegationMetadata,
} from "./toolDelegationExtraction";

// Re-export for use in other modules
export { TOOL_COST_MARKER_PATTERN };

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

  // Extract cost and delegation from result string if present
  // IMPORTANT: Extract BEFORE truncation to ensure we don't lose the markers
  let costUsd: number | undefined;
  let delegation: DelegationMetadata | undefined;
  if (typeof outputValue === "string") {
    const { costUsd: extractedCost, processedResult: costProcessedResult } =
      extractToolCostFromResult(outputValue);
    costUsd = extractedCost;

    const { delegation: extractedDelegation, processedResult: finalProcessedResult } =
      extractDelegationFromResult(costProcessedResult);
    delegation = extractedDelegation;
    outputValue = finalProcessedResult;

    // Truncate if string (after cost and delegation extraction)
    if (outputValue.length > MAX_RESULT_LENGTH) {
      outputValue =
        outputValue.substring(0, MAX_RESULT_LENGTH) +
        "\n\n[Results truncated for brevity. Please provide a summary based on the information shown.]";
    }
  } else if (typeof outputValue !== "object" || outputValue === null) {
    outputValue = String(outputValue);
  }

  // Build content array with tool result and optionally delegation
  const content: Array<
    | {
        type: "tool-result";
        toolCallId: string;
        toolName: string;
        result: unknown;
        toolExecutionTimeMs?: number;
        costUsd?: number;
      }
    | {
        type: "delegation";
        toolCallId: string;
        callingAgentId: string;
        targetAgentId: string;
        targetConversationId?: string;
        status: "completed" | "failed" | "cancelled";
        timestamp: string;
        taskId?: string;
      }
  > = [
    {
      type: "tool-result" as const,
      toolCallId: toolResult.toolCallId,
      toolName: toolResult.toolName,
      result: outputValue,
      ...(toolResult.toolExecutionTimeMs !== undefined && {
        toolExecutionTimeMs: toolResult.toolExecutionTimeMs,
      }),
      ...(costUsd !== undefined && { costUsd }),
    },
  ];

  // Add delegation content item if delegation metadata was found
  if (delegation) {
    content.push({
      type: "delegation" as const,
      toolCallId: toolResult.toolCallId,
      callingAgentId: delegation.callingAgentId,
      targetAgentId: delegation.targetAgentId,
      ...(delegation.targetConversationId && {
        targetConversationId: delegation.targetConversationId,
      }),
      status: delegation.status,
      timestamp: delegation.timestamp,
      ...(delegation.taskId && { taskId: delegation.taskId }),
    });
  }

  // In AI SDK v5, tool results should be in assistant messages, not tool messages
  return {
    role: "assistant" as const,
    content,
  };
}
