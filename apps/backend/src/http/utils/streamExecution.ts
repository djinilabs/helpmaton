import { streamText } from "ai";

import {
  type StreamTextResultWithResolvedUsage,
  type TokenUsage,
} from "../../utils/conversationLogger";

import { extractTokenUsageAndCosts } from "./generationTokenExtraction";
import { pipeAIStreamToResponse } from "./streamAIPipeline";
import {
  handleStreamingError,
  handleResultExtractionError,
} from "./streamErrorHandling";
import type { StreamRequestContext } from "./streamRequestContext";
import type { HttpResponseStream } from "./streamResponseStream";

/**
 * Result of executing a stream
 */
export interface StreamExecutionResult {
  streamResult: Awaited<ReturnType<typeof streamText>>;
  finalResponseText: string;
  tokenUsage: TokenUsage | undefined;
  generationTimeMs: number | undefined;
}

/**
 * Executes the AI stream and handles all processing
 * Returns the execution result or null if an error was handled
 */
export async function executeStream(
  context: StreamRequestContext,
  responseStream: HttpResponseStream,
  abortSignal?: AbortSignal
): Promise<StreamExecutionResult | null> {
  let fullStreamedText = "";
  let llmCallAttempted = false;
  let streamResult: Awaited<ReturnType<typeof streamText>> | undefined;

  let generationStartTime: number | undefined;
  let generationTimeMs: number | undefined;

  try {
    generationStartTime = Date.now();
    streamResult = await pipeAIStreamToResponse(
      context.agent,
      context.model,
      context.modelMessages,
      context.tools,
      responseStream,
      (textDelta) => {
        fullStreamedText += textDelta;
      },
      abortSignal
    );
    if (generationStartTime !== undefined) {
      generationTimeMs = Date.now() - generationStartTime;
    }
    llmCallAttempted = true;
  } catch (error) {
    const handled = await handleStreamingError(
      error,
      context,
      responseStream,
      llmCallAttempted
    );
    if (handled === true) {
      return null;
    }
    throw error;
  }

  if (!streamResult) {
    throw new Error("LLM call succeeded but result is undefined");
  }

  // Extract text and usage
  let responseText: string;
  let usage: unknown;

  try {
    [responseText, usage] = await Promise.all([
      Promise.resolve(streamResult.text).then((t) => t || ""),
      Promise.resolve(streamResult.usage),
    ]);
  } catch (resultError) {
    const handled = await handleResultExtractionError(
      resultError,
      context,
      responseStream
    );
    if (handled) {
      return null;
    }
    throw resultError;
  }

  const finalResponseText = responseText || fullStreamedText;

  console.log("[Stream Execution] Final response text:", finalResponseText);

  // Extract token usage
  const totalUsage = await streamResult.totalUsage;
  const { tokenUsage } = extractTokenUsageAndCosts(
    { totalUsage } as unknown as StreamTextResultWithResolvedUsage,
    usage,
    context.finalModelName,
    context.endpointType as "test" | "stream"
  );

  return {
    streamResult,
    finalResponseText,
    tokenUsage,
    generationTimeMs,
  };
}

/**
 * Executes the stream for API Gateway (buffered) and returns the result
 * Errors are not handled here - they should be handled by the caller
 */
export async function executeStreamForApiGateway(
  context: StreamRequestContext,
  mockStream: HttpResponseStream,
  abortSignal?: AbortSignal
): Promise<StreamExecutionResult> {
  let fullStreamedText = "";
  const generationStartTime = Date.now();
  const streamResult = await pipeAIStreamToResponse(
    context.agent,
    context.model,
    context.modelMessages,
    context.tools,
    mockStream,
    (textDelta) => {
      fullStreamedText += textDelta;
    },
    abortSignal
  );

  if (!streamResult) {
    throw new Error("LLM call succeeded but result is undefined");
  }

  const generationTimeMs = Date.now() - generationStartTime;

  // Extract text and usage
  const [responseText, usage] = await Promise.all([
    streamResult.text,
    streamResult.usage,
  ]);

  const finalResponseText = responseText || fullStreamedText;

  // Extract token usage
  const totalUsage = await streamResult.totalUsage;
  const { tokenUsage } = extractTokenUsageAndCosts(
    { totalUsage } as unknown as StreamTextResultWithResolvedUsage,
    usage,
    context.finalModelName,
    context.endpointType as "test" | "stream"
  );

  return {
    streamResult,
    finalResponseText,
    tokenUsage,
    generationTimeMs,
  };
}
