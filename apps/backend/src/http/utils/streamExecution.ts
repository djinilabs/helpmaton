import { streamText } from "ai";

import {
  type StreamTextResultWithResolvedUsage,
  type TokenUsage,
} from "../../utils/conversationLogger";

import { extractTokenUsageAndCosts } from "./generationTokenExtraction";
import { getGenerationTimingFromObserver } from "./llmObserver";
import {
  isTimeoutError,
  createTimeoutError,
} from "./requestTimeout";
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
  generationStartedAt?: string; // ISO timestamp when generation started
  generationEndedAt?: string; // ISO timestamp when generation ended
  hasWrittenData: boolean; // Track if any data has been written to the stream
}

function recordFinalTextIfNotStreamed(params: {
  observer: StreamRequestContext["llmObserver"];
  finalResponseText: string;
  streamedTextLength: number;
}): void {
  const { observer, finalResponseText, streamedTextLength } = params;
  if (!finalResponseText || streamedTextLength > 0) {
    return;
  }
  // In normal streaming, `streamedTextLength` grows as chunks are sent and
  // the observer is notified per chunk. In some edge cases, the final text is
  // only available via `streamResult.text` and no chunks are streamed at all.
  // In that case, record the text once to keep conversation logging complete.
  observer.recordText(finalResponseText);
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
  let hasWrittenData = false; // Track if any data has been written to the stream
  
  let generationStartTime: number | undefined;
  let generationStartedAt: string | undefined;
  let generationTimeMs: number | undefined;
  let generationEndedAt: string | undefined;

  try {
    generationStartTime = Date.now();
    generationStartedAt = new Date().toISOString();
    streamResult = await pipeAIStreamToResponse(
      context.agent,
      context.model,
      context.modelMessages,
      context.tools,
      responseStream,
      (textDelta) => {
        fullStreamedText += textDelta;
      },
      abortSignal,
      () => {
        // Callback to track when data is actually written to the stream
        hasWrittenData = true;
      },
      context.llmObserver
    );
    
    // Use observer timestamps if available, otherwise fall back to manual timing
    const observerTiming = getGenerationTimingFromObserver(
      context.llmObserver.getEvents()
    );
    if (observerTiming.generationStartedAt) {
      generationStartedAt = observerTiming.generationStartedAt;
    }
    if (observerTiming.generationEndedAt) {
      generationEndedAt = observerTiming.generationEndedAt;
      if (generationStartTime !== undefined) {
        generationTimeMs =
          new Date(generationEndedAt).getTime() - generationStartTime;
      }
    } else if (generationStartTime !== undefined) {
      generationTimeMs = Date.now() - generationStartTime;
      generationEndedAt = new Date().toISOString();
    }
    llmCallAttempted = true;
  } catch (error) {
    // Check if this is a timeout error
    if (isTimeoutError(error)) {
      const timeoutError = createTimeoutError();
      
      // If data has already been written, we can't change the HTTP status code
      // Just write the error message to the stream and return null
      if (hasWrittenData) {
        await handleStreamingError(
          timeoutError,
          context,
          responseStream,
          llmCallAttempted
        );
        return null;
      }
      
      // If no data has been written, throw the error so the handler can set status 504
      throw timeoutError;
    }

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
  recordFinalTextIfNotStreamed({
    observer: context.llmObserver,
    finalResponseText,
    streamedTextLength: fullStreamedText.length,
  });

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
    generationStartedAt,
    generationEndedAt,
    hasWrittenData,
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
  let generationStartedAt = new Date().toISOString();

  const streamResult = await pipeAIStreamToResponse(
    context.agent,
    context.model,
    context.modelMessages,
    context.tools,
    mockStream,
    (textDelta) => {
      fullStreamedText += textDelta;
    },
    abortSignal,
    undefined, // No need to track data written for API Gateway (buffered)
    context.llmObserver
  );

  if (!streamResult) {
    throw new Error("LLM call succeeded but result is undefined");
  }

  // Use observer timestamps if available
  const observerTiming = getGenerationTimingFromObserver(
    context.llmObserver.getEvents()
  );
  if (observerTiming.generationStartedAt) {
    generationStartedAt = observerTiming.generationStartedAt;
  }
  const generationEndedAt = observerTiming.generationEndedAt || new Date().toISOString();
  const generationTimeMs = new Date(generationEndedAt).getTime() - generationStartTime;

  // Extract text and usage
  const [responseText, usage] = await Promise.all([
    streamResult.text,
    streamResult.usage,
  ]);

  const finalResponseText = responseText || fullStreamedText;
  recordFinalTextIfNotStreamed({
    observer: context.llmObserver,
    finalResponseText,
    streamedTextLength: fullStreamedText.length,
  });

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
    generationStartedAt,
    generationEndedAt,
    hasWrittenData: true, // For API Gateway, we assume data was written if we got here
  };
}
