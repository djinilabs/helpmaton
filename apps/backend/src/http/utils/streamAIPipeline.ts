import type { ModelMessage } from "ai";
import { streamText } from "ai";

import type { setupAgentAndTools } from "../../http/utils/agentSetup";
import { Sentry, ensureError } from "../../utils/sentry";

import { prepareLLMCall } from "./generationLLMSetup";
import type { StreamEventTimestamps } from "./streamEventTracking";
import {
  writeChunkToStream,
  type HttpResponseStream,
} from "./streamResponseStream";

/**
 * Processed file from AI stream
 */
export interface ProcessedFile {
  url: string;
  mediaType?: string;
}

/**
 * Pipes the AI stream to the response stream
 * Reads from the UI message stream and writes chunks to responseStream as they arrive
 */
export async function pipeAIStreamToResponse(
  agent: Awaited<ReturnType<typeof setupAgentAndTools>>["agent"],
  model: Awaited<ReturnType<typeof setupAgentAndTools>>["model"],
  modelMessages: ModelMessage[],
  tools: Awaited<ReturnType<typeof setupAgentAndTools>>["tools"],
  responseStream: HttpResponseStream,
  onTextChunk: (text: string) => void,
  abortSignal?: AbortSignal,
  onDataWritten?: () => void, // Callback to notify when data is written to stream
  eventTracking?: StreamEventTimestamps, // Optional event tracking for timestamps
  onFileChunk?: (file: {
    url?: string;
    base64?: string;
    uint8Array?: Uint8Array;
    mediaType?: string;
  }) => Promise<ProcessedFile | null> // Callback to process file events (returns null if file should be skipped)
): Promise<Awaited<ReturnType<typeof streamText>>> {
  // Prepare LLM call (logging and generate options)
  const generateOptions = prepareLLMCall(
    agent,
    tools,
    modelMessages,
    "stream",
    "stream",
    "stream"
  );

  // Track generation start time
  if (eventTracking) {
    eventTracking.generationStartedAt = new Date().toISOString();
  }

  const streamResult = streamText({
    model: model as unknown as Parameters<typeof streamText>[0]["model"],
    system: agent.systemPrompt,
    messages: modelMessages,
    tools,
    ...generateOptions,
    ...(abortSignal && { abortSignal }),
    ...(eventTracking && {
      onStepStart: (step: unknown) => {
        // Track when a step starts - this could be text generation or tool call decision
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stepAny = step as any;

        // Check if this step contains tool calls
        if (stepAny?.toolCalls && Array.isArray(stepAny.toolCalls)) {
          const now = new Date().toISOString();
          for (const toolCall of stepAny.toolCalls) {
            if (toolCall?.toolCallId) {
              eventTracking.toolCallTimestamps.set(toolCall.toolCallId, {
                startedAt: now,
              });
            }
          }
        }

        // If this is the first step and we haven't set text generation start, set it
        // Text generation starts when the model begins generating (first step)
        if (!eventTracking.textGenerationStartedAt) {
          eventTracking.textGenerationStartedAt = new Date().toISOString();
        }
      },
      onStepFinish: (step: unknown) => {
        // Track when a step finishes - this captures tool execution times
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stepAny = step as any;

        // Check if this step contains tool results (tool execution completed)
        if (stepAny?.toolResults && Array.isArray(stepAny.toolResults)) {
          const now = Date.now();
          for (const toolResult of stepAny.toolResults) {
            if (toolResult?.toolCallId) {
              const timestamp = eventTracking.toolCallTimestamps.get(
                toolResult.toolCallId
              );
              if (timestamp?.startedAt) {
                const startTime = new Date(timestamp.startedAt).getTime();
                const executionTimeMs = now - startTime;
                eventTracking.toolExecutionTimes.set(
                  toolResult.toolCallId,
                  executionTimeMs
                );
                // Update timestamp with end time
                timestamp.endedAt = new Date(now).toISOString();
              }
            }
          }
        }

        // If this step finished and we have text, update text generation end time
        // Text generation ends when the model finishes generating text
        if (stepAny?.text || stepAny?.content) {
          eventTracking.textGenerationEndedAt = new Date().toISOString();
        }
      },
      onFinish: () => {
        // Track when the entire generation finishes
        if (eventTracking) {
          eventTracking.generationEndedAt = new Date().toISOString();
          // If text generation end wasn't set, set it now
          if (!eventTracking.textGenerationEndedAt) {
            eventTracking.textGenerationEndedAt =
              eventTracking.generationEndedAt;
          }
        }
      },
    }),
  });

  // Process fullStream in parallel to extract file events
  // This runs concurrently with the SSE stream processing
  const fileProcessingPromise = (async () => {
    if (!onFileChunk) {
      return; // No file processing needed
    }

    try {
      // fullStream is not exposed in AI SDK's public types, so we need to access it via any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fullStream = (streamResult as any).fullStream;
      if (!fullStream || typeof fullStream[Symbol.asyncIterator] !== "function") {
        console.log("[Stream Handler] fullStream not available or not iterable");
        return;
      }

      // Define type for file delta events from AI SDK
      interface FileDelta {
        type: "file";
        file?: {
          url?: string;
          base64?: string;
          uint8Array?: Uint8Array;
          mediaType?: string;
        };
      }

      console.log("[Stream Handler] Processing fullStream for file events");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for await (const delta of fullStream as AsyncIterable<any>) {
        // Check if this is a file event
        if (delta && typeof delta === "object" && (delta as FileDelta).type === "file" && (delta as FileDelta).file) {
          const fileData = (delta as FileDelta).file!;
          console.log("[Stream Handler] Found file event:", {
            hasUrl: !!fileData.url,
            hasBase64: !!fileData.base64,
            hasUint8Array: !!fileData.uint8Array,
            mediaType: fileData.mediaType,
          });

          try {
            const processed = await onFileChunk({
              url: fileData.url,
              base64: fileData.base64,
              uint8Array: fileData.uint8Array,
              mediaType: fileData.mediaType,
            });

            if (processed) {
              console.log("[Stream Handler] File processed successfully:", {
                url: processed.url,
                mediaType: processed.mediaType,
              });
            }
          } catch (fileError) {
            console.error("[Stream Handler] Error processing file event:", fileError);
            // Don't throw - continue processing other files
          }
        }
      }
    } catch (streamError) {
      console.error("[Stream Handler] Error processing fullStream:", streamError);
      // Don't throw - file processing is best-effort, shouldn't break the main stream
    }
  })();

  // Get the UI message stream response from streamText result
  // This might throw NoOutputGeneratedError if there was an error during streaming
  // This returns SSE format (Server-Sent Events) that useChat expects
  // Errors will be caught by the outer handler which has access to usesByok
  const streamResponse = streamResult.toUIMessageStreamResponse();

  // Read from the stream and write chunks to responseStream immediately as they arrive
  // This ensures true streaming without buffering
  const reader = streamResponse.body?.getReader();
  if (!reader) {
    throw new Error("Stream response body is null");
  }

  const decoder = new TextDecoder();
  let textBuffer = ""; // Buffer for extracting text deltas (for logging/tracking only)
  let streamCompletedSuccessfully = false; // Track if stream completed without error
  let hasWrittenData = false; // Track if we've written any data to the stream

  try {
    while (true) {
      // Check if signal is aborted before reading next chunk
      if (abortSignal?.aborted) {
        throw new Error("Operation aborted");
      }

      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        hasWrittenData = true;
        // Notify that data has been written (for timeout handling)
        onDataWritten?.();

        // Write the raw chunk immediately to responseStream for true streaming
        // Don't buffer - write as soon as we receive it
        await writeChunkToStream(responseStream, value);

        // Decode for text extraction (for tracking purposes only)
        // This doesn't affect streaming performance
        const chunk = decoder.decode(value, { stream: true });

        // Log the chunk (convert buffer to UTF-8 string for logging)
        console.log("[Stream Handler] Received chunk:", chunk);

        textBuffer += chunk;

        // Try to extract text deltas from complete lines for tracking
        // Only process if we have complete lines (ending with \n)
        if (chunk.includes("\n")) {
          const lines = textBuffer.split("\n");
          textBuffer = lines.pop() || ""; // Keep incomplete line

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const jsonStr = line.substring(6); // Remove "data: " prefix
                const parsed = JSON.parse(jsonStr);
                if (parsed.type === "text-delta" && parsed.textDelta) {
                  onTextChunk(parsed.textDelta);
                } else if (parsed.type === "text" && parsed.text) {
                  onTextChunk(parsed.text);
                }
              } catch {
                console.error("[Stream Handler] Error parsing JSON:", line);
                // Not JSON or parsing failed, skip text extraction
              }
            }
          }
        }
      }
    }

    // REMOVED: Don't write textBuffer again - raw bytes were already written
    // The textBuffer is only for tracking text deltas, not for writing to stream
    // Writing it again would duplicate data or write incomplete UTF-8 sequences

    // If no data was written, write an SSE comment to initialize the stream
    // Lambda Function URLs require at least one write to activate the stream
    if (!hasWrittenData) {
      await writeChunkToStream(responseStream, ": stream-init\n\n");
      onDataWritten?.(); // Notify that initialization data was written
    }

    // Mark as successfully completed before ending stream
    streamCompletedSuccessfully = true;

    // End the stream after all chunks are written successfully
    console.log("[Stream Handler] All chunks written, ending stream");
    responseStream.end();
  } catch (streamError) {
    console.error(
      "[Stream Handler] Error in pipeAIStreamToResponse:",
      streamError
    );
    // Release the reader lock before re-throwing
    reader.releaseLock();
    // Don't end the stream here - let the outer error handler do it
    // Re-throw to let outer handler catch it (which has access to usesByok and responseStream)
    throw streamError;
  } finally {
    reader.releaseLock();
    // Only end stream here if it completed successfully but wasn't ended above
    // (This is a safety net for edge cases)
    if (streamCompletedSuccessfully) {
      try {
        // Check if stream is still writable before ending
        // If it's already ended, this will throw, which we'll catch and log
        responseStream.end();
      } catch (endError) {
        // Stream might already be ended - log to Sentry for visibility
        console.warn(
          "[Stream Handler] Stream already ended (expected in normal flow):",
          {
            error:
              endError instanceof Error ? endError.message : String(endError),
          }
        );
        Sentry.captureException(ensureError(endError), {
          tags: {
            context: "stream-ai-pipeline",
            operation: "end-stream-in-finally",
          },
          level: "warning",
        });
      }
    }
    // If streamCompletedSuccessfully is false, there was an error - don't end stream here
    // Let the error handler do it
  }

  // Wait for file processing to complete (best-effort, don't block on errors)
  try {
    await fileProcessingPromise;
  } catch (fileProcessingError) {
    console.error(
      "[Stream Handler] Error in file processing (non-blocking):",
      fileProcessingError
    );
    // Don't throw - file processing errors shouldn't break the main stream
  }

  return streamResult;
}
