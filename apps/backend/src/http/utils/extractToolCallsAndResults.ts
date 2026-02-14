/**
 * Extracts tool calls and results from AI SDK generateText result.
 * Prefers step-based extraction when available (ensures 1:1 tool call/result matching).
 * Used by processNonStreamingResponse for continuation handling.
 */

const SYNTHETIC_ERROR_MESSAGE =
  "Error: Tool execution did not complete. Please try again.";

const LOG_PREFIX = "[extractToolCallsAndResults]";

export type ToolCallExtracted = {
  toolCallId: string;
  toolName: string;
  args?: unknown;
  input?: unknown;
  [key: string]: unknown;
};

export type ToolResultExtracted = {
  toolCallId: string;
  toolName: string;
  output?: unknown;
  result?: unknown;
  [key: string]: unknown;
};

export type ExtractedTooling = {
  toolCalls: ToolCallExtracted[];
  toolResults: ToolResultExtracted[];
};

/**
 * Extracts tool calls and results from generateText result.
 * When steps exist, extracts from step content to ensure proper 1:1 matching.
 * Falls back to top-level toolCalls/toolResults when steps are not available.
 */
export function extractToolCallsAndResults(rawResult: unknown): ExtractedTooling {
  if (rawResult == null || typeof rawResult !== "object") {
    return { toolCalls: [], toolResults: [] };
  }

  const resultAny = rawResult as Record<string, unknown>;
  const stepsValue = Array.isArray(resultAny.steps)
    ? resultAny.steps
    : (resultAny._steps as { status?: { value?: unknown[] } })?.status?.value;

  const toolCallsFromSteps: ToolCallExtracted[] = [];
  const toolResultsFromSteps: ToolResultExtracted[] = [];

  if (Array.isArray(stepsValue)) {
    for (const step of stepsValue) {
      const stepAny = step as { content?: unknown[] };
      if (stepAny?.content && Array.isArray(stepAny.content)) {
        for (const contentItem of stepAny.content) {
          if (
            typeof contentItem === "object" &&
            contentItem !== null &&
            "type" in contentItem
          ) {
            const item = contentItem as Record<string, unknown>;
            if (item.type === "tool-call") {
              if (
                item.toolCallId &&
                item.toolName &&
                typeof item.toolCallId === "string" &&
                typeof item.toolName === "string"
              ) {
                toolCallsFromSteps.push({
                  toolCallId: item.toolCallId,
                  toolName: item.toolName,
                  args: item.input ?? item.args ?? {},
                  input: item.input ?? item.args ?? {},
                });
              } else {
                console.warn(`${LOG_PREFIX} Skipping tool-call with missing/invalid fields:`, {
                  hasToolCallId: !!item.toolCallId,
                  hasToolName: !!item.toolName,
                });
              }
            } else if (item.type === "tool-result") {
              if (
                item.toolCallId &&
                item.toolName &&
                typeof item.toolCallId === "string" &&
                typeof item.toolName === "string"
              ) {
                let resultValue = item.output;
                if (
                  typeof resultValue === "object" &&
                  resultValue !== null &&
                  "value" in (resultValue as object)
                ) {
                  resultValue = (resultValue as { value: unknown }).value;
                }
                toolResultsFromSteps.push({
                  toolCallId: item.toolCallId,
                  toolName: item.toolName,
                  output: resultValue ?? item.output ?? item.result,
                  result: resultValue ?? item.result ?? item.output,
                });
              } else {
                console.warn(`${LOG_PREFIX} Skipping tool-result with missing/invalid fields:`, {
                  hasToolCallId: !!item.toolCallId,
                  hasToolName: !!item.toolName,
                });
              }
            }
          }
        }
      }
    }
  }

  const rawToolCalls = (rawResult as { toolCalls?: unknown[] }).toolCalls ?? [];
  const rawToolResults =
    (rawResult as { toolResults?: unknown[] }).toolResults ?? [];

  const toolCalls =
    toolCallsFromSteps.length > 0
      ? toolCallsFromSteps
      : (Array.isArray(rawToolCalls) ? rawToolCalls : []) as ToolCallExtracted[];
  const toolResults =
    toolResultsFromSteps.length > 0
      ? toolResultsFromSteps
      : (Array.isArray(rawToolResults)
          ? rawToolResults
          : []) as ToolResultExtracted[];

  return { toolCalls, toolResults };
}

/**
 * Ensures every tool call has a matching result (by toolCallId).
 * Adds synthetic error results for any tool call missing a result.
 * Prevents AI_MissingToolResultsError when the AI SDK returns mismatched data.
 */
export function ensureToolCallsHaveMatchingResults(
  toolCalls: ToolCallExtracted[],
  toolResults: ToolResultExtracted[]
): ToolResultExtracted[] {
  const resultByCallId = new Map<string, ToolResultExtracted>();
  for (const tr of toolResults) {
    if (tr.toolCallId) {
      resultByCallId.set(tr.toolCallId, tr);
    }
  }

  const finalResults: ToolResultExtracted[] = [];
  for (const tc of toolCalls) {
    const existing = resultByCallId.get(tc.toolCallId);
    if (existing) {
      finalResults.push(existing);
    } else {
      const syntheticResult = `${SYNTHETIC_ERROR_MESSAGE} (tool: ${tc.toolName})`;
      console.warn(`${LOG_PREFIX} Tool call missing result, adding synthetic error:`, {
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
      });
      finalResults.push({
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        result: syntheticResult,
        output: syntheticResult,
      });
    }
  }

  return finalResults;
}
