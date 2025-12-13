import type { TokenUsage } from "../../../utils/conversationLogger";
import { extractTokenUsage } from "../../../utils/conversationLogger";
import { type WorkspaceAndAgent } from "../../utils/agentUtils";
import { createModel } from "../../utils/modelFactory";

import { handleToolContinuation } from "./continuation";

export interface ProcessResponseResult {
  text: string;
  tokenUsage: TokenUsage | undefined;
}

/**
 * Processes the non-streaming AI response and handles tool calls
 */
export async function processNonStreamingResponse(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK generateText result types are complex
  result: any,
  agent: WorkspaceAndAgent["agent"],
  model: Awaited<ReturnType<typeof createModel>>,
  messages: unknown[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tools have varying types
  tools?: Record<string, any>
): Promise<ProcessResponseResult> {
  // Extract text, tool calls, and tool results from generateText result
  let finalText: string;
  let toolCalls: unknown[];
  let toolResults: unknown[];
  try {
    [finalText, toolCalls, toolResults] = await Promise.all([
      Promise.resolve(result.text),
      Promise.resolve(result.toolCalls || []),
      Promise.resolve(result.toolResults || []),
    ]);
  } catch (error) {
    console.error("[Agent Test Handler] Error extracting result data:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }

  const initialTokenUsage = await extractTokenUsage(result);
  const hasText = finalText && finalText.trim().length > 0;
  const hasToolResults = toolResults && toolResults.length > 0;

  // Handle continuation if tools were executed but no text was generated
  if (
    hasToolResults &&
    !hasText &&
    toolCalls &&
    toolCalls.length > 0 &&
    toolResults &&
    toolResults.length > 0
  ) {
    const continuationResult = await handleToolContinuation(
      agent,
      model,
      messages,
      toolCalls,
      toolResults,
      tools
    );
    if (continuationResult) {
      // Aggregate token usage from initial and continuation calls
      const aggregatedTokenUsage = continuationResult.tokenUsage
        ? {
            promptTokens:
              (initialTokenUsage?.promptTokens || 0) +
              (continuationResult.tokenUsage.promptTokens || 0),
            completionTokens:
              (initialTokenUsage?.completionTokens || 0) +
              (continuationResult.tokenUsage.completionTokens || 0),
            totalTokens:
              (initialTokenUsage?.totalTokens || 0) +
              (continuationResult.tokenUsage.totalTokens || 0),
          }
        : initialTokenUsage;

      return {
        text: continuationResult.text || "",
        tokenUsage: aggregatedTokenUsage,
      };
    }
  }

  // Return final text, or empty string if none
  return {
    text: finalText || "",
    tokenUsage: initialTokenUsage,
  };
}

/**
 * Processes simple non-streaming response for webhook handler (no tool continuation)
 */
export async function processSimpleNonStreamingResponse(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK generateText result types are complex
  result: any
): Promise<string> {
  return result.text || "";
}
