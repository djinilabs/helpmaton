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

import { getMaxToolOutputBytes } from "../../utils/pricing";

import { getDefaultModel } from "./modelFactory";
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

/** Default max tool output bytes (from default model metadata). Lazy so tests can mock pricing before first use. */
export function getDefaultMaxToolOutputBytes(): number {
  return getMaxToolOutputBytes("openrouter", getDefaultModel());
}

/** Suffix shown when tool output is trimmed for length. */
export const TOOL_OUTPUT_TRIMMED_SUFFIX =
  "\n\n[Output trimmed for brevity.]";

export interface FormatToolResultMessageOptions {
  /** Provider (e.g. "openrouter"); used with modelName to get max output bytes from model metadata. */
  provider?: string;
  /** Model name; used with provider to get max output bytes from model metadata. */
  modelName?: string;
}

/**
 * Formats tool result as UI message with truncation.
 * Max output size is derived from model metadata (context length) when provider/modelName are given;
 * otherwise uses default OpenRouter model. Extracts cost from result string if present.
 */
export function formatToolResultMessage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK tool result types vary
  toolResult: any,
  options?: FormatToolResultMessageOptions
) {
  const provider = options?.provider ?? "openrouter";
  const modelName = options?.modelName ?? getDefaultModel();
  const maxOutputBytes = getMaxToolOutputBytes(provider, modelName);

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
  let openrouterGenerationId: string | undefined;
  let delegation: DelegationMetadata | undefined;
  if (outputValue && typeof outputValue === "object" && !Array.isArray(outputValue)) {
    const outputRecord = outputValue as Record<string, unknown>;
    if ("costUsd" in outputRecord && typeof outputRecord.costUsd === "number") {
      costUsd = outputRecord.costUsd;
    }
    if (
      "openrouterGenerationId" in outputRecord &&
      typeof outputRecord.openrouterGenerationId === "string"
    ) {
      openrouterGenerationId = outputRecord.openrouterGenerationId;
    }
    if (costUsd !== undefined || openrouterGenerationId !== undefined) {
      const rest = { ...outputRecord };
      delete rest.costUsd;
      delete rest.openrouterGenerationId;
      outputValue = rest;
    }
  }

  if (typeof outputValue === "string") {
    const { costUsd: extractedCost, processedResult: costProcessedResult } =
      extractToolCostFromResult(outputValue);
    if (costUsd === undefined) {
      costUsd = extractedCost;
    }

    const { delegation: extractedDelegation, processedResult: finalProcessedResult } =
      extractDelegationFromResult(costProcessedResult);
    delegation = extractedDelegation;
    outputValue = finalProcessedResult;

    // Cap string output at model-derived limit; show indication when trimmed (after cost and delegation extraction)
    if (outputValue.length > maxOutputBytes) {
      outputValue =
        outputValue.substring(0, maxOutputBytes) + TOOL_OUTPUT_TRIMMED_SUFFIX;
    }
  } else if (typeof outputValue !== "object" || outputValue === null) {
    outputValue = String(outputValue);
  }

  // Extract file part from object before possibly capping (e.g. generate_image)
  const extractGenerateImageFilePart = () => {
    if (toolResult.toolName !== "generate_image") {
      return null;
    }
    if (!outputValue || typeof outputValue !== "object") {
      return null;
    }
    const resultAny = outputValue as {
      url?: unknown;
      contentType?: unknown;
      mediaType?: unknown;
      filename?: unknown;
    };
    if (typeof resultAny.url !== "string" || resultAny.url.length === 0) {
      return null;
    }
    const mediaType =
      typeof resultAny.contentType === "string"
        ? resultAny.contentType
        : typeof resultAny.mediaType === "string"
        ? resultAny.mediaType
        : undefined;
    return {
      type: "file" as const,
      file: resultAny.url,
      ...(mediaType && { mediaType }),
      ...(typeof resultAny.filename === "string" && {
        filename: resultAny.filename,
      }),
    };
  };

  const generateImageFilePart = extractGenerateImageFilePart();
  // Cap object output when stringified representation exceeds model-derived limit
  if (typeof outputValue === "object" && outputValue !== null) {
    const str = JSON.stringify(outputValue);
    if (str.length > maxOutputBytes) {
      outputValue =
        str.substring(0, maxOutputBytes) + TOOL_OUTPUT_TRIMMED_SUFFIX;
    }
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
    | { type: "file"; file: string; mediaType?: string; filename?: string }
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
      ...(openrouterGenerationId && { openrouterGenerationId }),
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

  if (generateImageFilePart) {
    content.push(generateImageFilePart);
  }

  // In AI SDK v5, tool results should be in assistant messages, not tool messages
  return {
    role: "assistant" as const,
    content,
  };
}

/**
 * Returns the (possibly truncated) tool result value to send to the model.
 * Reuses the same model-derived cap and "Output trimmed for brevity" as
 * formatToolResultMessage. Use when returning from tool execution (e.g.
 * wrapToolsWithObserver) so streaming and test paths match continuation/webhook/scheduled.
 *
 * @param toolResult - Raw tool result (e.g. { toolCallId, toolName, result }).
 * @param options - Optional provider/modelName for model-derived cap.
 * @returns Value to return to the AI SDK (string or object; truncated if over cap).
 */
export function getToolResultValueForModel(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK tool result types vary
  toolResult: any,
  options?: FormatToolResultMessageOptions
): unknown {
  const formatted = formatToolResultMessage(toolResult, options);
  const part = formatted.content.find(
    (p) =>
      p != null &&
      typeof p === "object" &&
      "type" in p &&
      (p as { type: string }).type === "tool-result" &&
      "result" in p
  );
  const truncatedResult =
    part && typeof part === "object" && "result" in part
      ? (part as { result: unknown }).result
      : undefined;
  return truncatedResult ?? toolResult?.result ?? toolResult?.output;
}
