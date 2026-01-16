import type { ModelMessage } from "ai";
import { streamText } from "ai";

import type { setupAgentAndTools } from "../../http/utils/agentSetup";
import { Sentry, ensureError } from "../../utils/sentry";

import { prepareLLMCall } from "./generationLLMSetup";
import { createStreamObserverCallbacks, type LlmObserver } from "./llmObserver";
import {
  writeChunkToStream,
  type HttpResponseStream,
} from "./streamResponseStream";

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
  observer?: LlmObserver // Optional LLM observer for event capture
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

  const observerCallbacks = observer
    ? createStreamObserverCallbacks(observer)
    : undefined;

  const streamResult = streamText({
    model: model as unknown as Parameters<typeof streamText>[0]["model"],
    system: agent.systemPrompt,
    messages: modelMessages,
    tools,
    ...generateOptions,
    ...(abortSignal && { abortSignal }),
    ...(observerCallbacks ? observerCallbacks : {}),
  });

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
                  observer?.recordText(parsed.textDelta);
                  onTextChunk(parsed.textDelta);
                } else if (parsed.type === "text" && parsed.text) {
                  observer?.recordText(parsed.text);
                  onTextChunk(parsed.text);
                } else if (parsed.type === "tool-call") {
                  if (parsed.toolCallId && parsed.toolName) {
                    observer?.recordToolCall({
                      toolCallId: parsed.toolCallId,
                      toolName: parsed.toolName,
                      args: parsed.args ?? parsed.input ?? {},
                    });
                  }
                } else if (parsed.type === "tool-result") {
                  if (parsed.toolCallId && parsed.toolName) {
                    observer?.recordToolResult({
                      toolCallId: parsed.toolCallId,
                      toolName: parsed.toolName,
                      result:
                        parsed.result ??
                        parsed.output?.value ??
                        parsed.output ??
                        parsed.value,
                    });
                  }
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

  return streamResult;
}
