import type { ModelMessage } from "ai";
import { streamText } from "ai";

import type { setupAgentAndTools } from "../../http/utils/agentSetup";
import { uploadConversationFile } from "../../utils/s3";
import { Sentry, ensureError } from "../../utils/sentry";

import { prepareLLMCall } from "./generationLLMSetup";
import { createStreamObserverCallbacks, type LlmObserver } from "./llmObserver";
import {
  resolveModelCapabilities,
  resolveToolsForCapabilities,
} from "./modelCapabilities";
import { getDefaultModel } from "./modelFactory";
import {
  writeChunkToStream,
  type HttpResponseStream,
} from "./streamResponseStream";

type FileUploadContext = {
  workspaceId: string;
  agentId: string;
  conversationId: string;
};

type FilePartPayload = {
  fileUrl: string;
  mediaType?: string;
  filename?: string;
};

const MAX_ASSISTANT_FILE_SIZE = 10 * 1024 * 1024;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function isDataUrl(value: string): boolean {
  return value.startsWith("data:") || value.startsWith("data;");
}

function looksLikeBase64(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 32 || trimmed.length % 4 !== 0) {
    return false;
  }
  return /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed);
}

function extractGenerateImageFileFromToolResult(
  parsed: Record<string, unknown>
): FilePartPayload | null {
  if (
    parsed.type !== "tool-result" &&
    parsed.type !== "tool-output-available"
  ) {
    return null;
  }
  if (parsed.toolName !== "generate_image") {
    return null;
  }
  const resultValue =
    (parsed as { result?: unknown }).result ??
    (parsed as { output?: { value?: unknown } }).output?.value ??
    (parsed as { output?: unknown }).output;
  if (!resultValue || typeof resultValue !== "object") {
    return null;
  }
  const resultAny = resultValue as {
    url?: unknown;
    contentType?: unknown;
    mediaType?: unknown;
    filename?: unknown;
  };
  if (typeof resultAny.url !== "string" || resultAny.url.length === 0) {
    return null;
  }
  return {
    fileUrl: resultAny.url,
    mediaType:
      typeof resultAny.contentType === "string"
        ? resultAny.contentType
        : typeof resultAny.mediaType === "string"
        ? resultAny.mediaType
        : undefined,
    filename: typeof resultAny.filename === "string" ? resultAny.filename : undefined,
  };
}

function parseDataUrl(
  dataUrl: string
): { mediaType?: string; buffer: Buffer } | null {
  const match = dataUrl.match(/^data[:;]([^;,]*)(;base64)?,(.*)$/);
  if (!match) {
    return null;
  }

  const mediaType = match[1] || undefined;
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || "";
  if (isBase64) {
    return { mediaType, buffer: Buffer.from(payload, "base64") };
  }

  return { mediaType, buffer: Buffer.from(decodeURIComponent(payload), "utf-8") };
}

async function uploadEmbeddedFile(params: {
  value: string;
  mediaType?: string;
  filename?: string;
  uploadContext: FileUploadContext;
}): Promise<{ url: string; mediaType: string; filename?: string }> {
  const { value, mediaType, filename, uploadContext } = params;
  let buffer: Buffer;
  let resolvedMediaType = mediaType;

  if (isDataUrl(value)) {
    const parsed = parseDataUrl(value);
    if (!parsed) {
      throw new Error("Invalid data URL for file part");
    }
    buffer = parsed.buffer;
    resolvedMediaType = resolvedMediaType || parsed.mediaType;
  } else if (looksLikeBase64(value)) {
    buffer = Buffer.from(value, "base64");
  } else {
    buffer = Buffer.from(value, "utf-8");
  }

  if (buffer.length > MAX_ASSISTANT_FILE_SIZE) {
    throw new Error("Assistant file part exceeds maximum size (10MB)");
  }

  const uploadResult = await uploadConversationFile({
    workspaceId: uploadContext.workspaceId,
    agentId: uploadContext.agentId,
    conversationId: uploadContext.conversationId,
    content: buffer,
    contentType: resolvedMediaType || "application/octet-stream",
    filename,
  });

  return {
    url: uploadResult.url,
    mediaType: resolvedMediaType || "application/octet-stream",
    filename: filename || uploadResult.filename,
  };
}

function extractFileValue(part: Record<string, unknown>): {
  key: "url" | "data" | "image" | "file";
  value: string;
  mediaType?: string;
  filename?: string;
} | null {
  const mediaType =
    typeof part.mediaType === "string"
      ? part.mediaType
      : typeof part.mimeType === "string"
      ? part.mimeType
      : undefined;
  const filename = typeof part.filename === "string" ? part.filename : undefined;

  if (typeof part.url === "string") {
    return { key: "url", value: part.url, mediaType, filename };
  }
  if (typeof part.data === "string") {
    return { key: "data", value: part.data, mediaType, filename };
  }
  if (typeof part.image === "string") {
    return { key: "image", value: part.image, mediaType, filename };
  }
  if (typeof part.file === "string") {
    return { key: "file", value: part.file, mediaType, filename };
  }

  return null;
}

async function rewriteFilePartsInMessage(
  parts: unknown[],
  uploadContext: FileUploadContext
): Promise<{ updatedParts: unknown[]; fileParts: FilePartPayload[] }> {
  const updatedParts: unknown[] = [];
  const fileParts: FilePartPayload[] = [];

  for (const part of parts) {
    if (!isObject(part) || typeof part.type !== "string") {
      updatedParts.push(part);
      continue;
    }

    if (part.type !== "file" && part.type !== "image") {
      updatedParts.push(part);
      continue;
    }

    const fileValue = extractFileValue(part);
    if (!fileValue) {
      updatedParts.push(part);
      continue;
    }

    if (isHttpUrl(fileValue.value)) {
      fileParts.push({
        fileUrl: fileValue.value,
        mediaType: fileValue.mediaType,
        filename: fileValue.filename,
      });
      updatedParts.push(part);
      continue;
    }

    const uploadResult = await uploadEmbeddedFile({
      value: fileValue.value,
      mediaType: fileValue.mediaType,
      filename: fileValue.filename,
      uploadContext,
    });

    const updatedPart = {
      ...part,
      [fileValue.key]: uploadResult.url,
      mediaType: uploadResult.mediaType,
      filename: uploadResult.filename,
    };
    fileParts.push({
      fileUrl: uploadResult.url,
      mediaType: uploadResult.mediaType,
      filename: uploadResult.filename,
    });
    updatedParts.push(updatedPart);
  }

  return { updatedParts, fileParts };
}

async function rewriteStreamEventWithFiles(params: {
  event: Record<string, unknown>;
  uploadContext: FileUploadContext;
}): Promise<{ updatedEvent: Record<string, unknown>; fileParts: FilePartPayload[] }> {
  const { event, uploadContext } = params;
  const fileParts: FilePartPayload[] = [];
  let updatedEvent = { ...event };

  if (Array.isArray(event.parts)) {
    const rewrite = await rewriteFilePartsInMessage(event.parts, uploadContext);
    updatedEvent = { ...updatedEvent, parts: rewrite.updatedParts };
    fileParts.push(...rewrite.fileParts);
  }

  if (isObject(event.part)) {
    const rewrite = await rewriteFilePartsInMessage([event.part], uploadContext);
    updatedEvent = { ...updatedEvent, part: rewrite.updatedParts[0] };
    fileParts.push(...rewrite.fileParts);
  }

  if (isObject(event.message) && Array.isArray(event.message.parts)) {
    const rewrite = await rewriteFilePartsInMessage(
      event.message.parts as unknown[],
      uploadContext
    );
    updatedEvent = {
      ...updatedEvent,
      message: {
        ...event.message,
        parts: rewrite.updatedParts,
      },
    };
    fileParts.push(...rewrite.fileParts);
  }

  if (event.type === "file" || event.type === "image") {
    const rewrite = await rewriteFilePartsInMessage([event], uploadContext);
    updatedEvent = rewrite.updatedParts[0] as Record<string, unknown>;
    fileParts.push(...rewrite.fileParts);
  }

  return { updatedEvent, fileParts };
}

function recordObserverEvent(params: {
  parsed: Record<string, unknown>;
  observer?: LlmObserver;
  onTextChunk: (text: string) => void;
}): void {
  const { parsed, observer, onTextChunk } = params;
  if (parsed.type === "text-delta" && parsed.textDelta) {
    observer?.recordText(String(parsed.textDelta));
    onTextChunk(String(parsed.textDelta));
    return;
  }
  if (parsed.type === "text" && parsed.text) {
    observer?.recordText(String(parsed.text));
    onTextChunk(String(parsed.text));
    return;
  }
  if (parsed.type === "tool-call") {
    if (parsed.toolCallId && parsed.toolName) {
      observer?.recordToolCall({
        toolCallId: String(parsed.toolCallId),
        toolName: String(parsed.toolName),
        args: (parsed as { args?: unknown; input?: unknown }).args ??
          (parsed as { input?: unknown }).input ??
          {},
      });
    }
    return;
  }
  if (parsed.type === "tool-result" || parsed.type === "tool-output-available") {
    if (parsed.toolCallId && parsed.toolName) {
      observer?.recordToolResult({
        toolCallId: String(parsed.toolCallId),
        toolName: String(parsed.toolName),
        result:
          (parsed as { result?: unknown }).result ??
          (parsed as { output?: { value?: unknown } }).output?.value ??
          (parsed as { output?: unknown }).output ??
          (parsed as { value?: unknown }).value,
      });
    }
  }
}

async function transformSseLine(params: {
  line: string;
  observer?: LlmObserver;
  onTextChunk: (text: string) => void;
  fileUploadContext?: FileUploadContext;
  toolNamesByCallId: Map<string, string>;
}): Promise<{
  line: string;
  fileParts: FilePartPayload[];
  extraLines: string[];
}> {
  const {
    line,
    observer,
    onTextChunk,
    fileUploadContext,
    toolNamesByCallId,
  } = params;
  if (!line.startsWith("data: ")) {
    return { line, fileParts: [], extraLines: [] };
  }

  const jsonStr = line.substring(6).trim();
  if (
    !jsonStr ||
    jsonStr === "[DONE]" ||
    (!jsonStr.startsWith("{") && !jsonStr.startsWith("["))
  ) {
    return { line, fileParts: [], extraLines: [] };
  }

  const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
  let outputLine = line;
  let fileParts: FilePartPayload[] = [];
  const extraLines: string[] = [];

  if (fileUploadContext) {
    const rewrite = await rewriteStreamEventWithFiles({
      event: parsed,
      uploadContext: fileUploadContext,
    });
    if (rewrite.fileParts.length > 0) {
      fileParts = rewrite.fileParts;
      outputLine = `data: ${JSON.stringify(rewrite.updatedEvent)}`;
    }
  }

  const toolCallId =
    typeof parsed.toolCallId === "string" ? parsed.toolCallId : undefined;
  const toolName = typeof parsed.toolName === "string" ? parsed.toolName : undefined;
  if (toolCallId && toolName) {
    toolNamesByCallId.set(toolCallId, toolName);
  }

  const parsedWithToolName =
    !toolName && toolCallId && toolNamesByCallId.has(toolCallId)
      ? {
          ...parsed,
          toolName: toolNamesByCallId.get(toolCallId),
        }
      : parsed;

  recordObserverEvent({ parsed: parsedWithToolName, observer, onTextChunk });

  const injectedFilePart = extractGenerateImageFileFromToolResult(
    parsedWithToolName
  );
  if (injectedFilePart) {
    const mediaType = injectedFilePart.mediaType || "application/octet-stream";
    const fileEvent = {
      type: "file",
      url: injectedFilePart.fileUrl,
      mediaType,
    };
    const messageLine = `data: ${JSON.stringify(fileEvent)}`;
    fileParts.push(injectedFilePart);
    extraLines.push(messageLine);
  }

  return { line: outputLine, fileParts, extraLines };
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
  observer?: LlmObserver, // Optional LLM observer for event capture
  fileUploadContext?: FileUploadContext
): Promise<Awaited<ReturnType<typeof streamText>>> {
  const resolvedModelName =
    typeof agent.modelName === "string" && agent.modelName.length > 0
      ? agent.modelName
      : getDefaultModel();
  const modelCapabilities = resolveModelCapabilities(
    "openrouter",
    resolvedModelName
  );
  const effectiveTools = resolveToolsForCapabilities(tools, modelCapabilities);

  // Prepare LLM call (logging and generate options)
  const generateOptions = prepareLLMCall(
    agent,
    effectiveTools,
    modelMessages,
    "stream",
    "stream",
    "stream"
  );

  const observerCallbacks = observer
    ? createStreamObserverCallbacks(observer)
    : undefined;

  console.log("[Stream Handler] streamText arguments:", {
    model: resolvedModelName || "default",
    systemPromptLength: agent.systemPrompt.length,
    messagesCount: modelMessages.length,
    toolsCount: effectiveTools ? Object.keys(effectiveTools).length : 0,
    hasAbortSignal: Boolean(abortSignal),
    hasObserverCallbacks: Boolean(observerCallbacks),
    ...generateOptions,
  });

  const streamResult = streamText({
    model: model as unknown as Parameters<typeof streamText>[0]["model"],
    system: agent.systemPrompt,
    messages: modelMessages,
    ...(effectiveTools ? { tools: effectiveTools } : {}),
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
  let sseBuffer = "";
  let streamCompletedSuccessfully = false; // Track if stream completed without error
  let hasWrittenData = false; // Track if we've written any data to the stream
  const toolNamesByCallId = new Map<string, string>();

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

        const chunk = decoder.decode(value, { stream: true });

        // Log the chunk (convert buffer to UTF-8 string for logging)
        console.log("[Stream Handler] Received chunk:", chunk);

        sseBuffer += chunk;
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() || "";

        for (const line of lines) {
          try {
            const transformed = await transformSseLine({
              line,
              observer,
              onTextChunk,
              fileUploadContext,
              toolNamesByCallId,
            });
            for (const filePart of transformed.fileParts) {
              observer?.recordFilePart({
                fileUrl: filePart.fileUrl,
                mediaType: filePart.mediaType,
                filename: filePart.filename,
              });
            }
            await writeChunkToStream(responseStream, `${transformed.line}\n\n`);
            for (const extraLine of transformed.extraLines) {
              await writeChunkToStream(responseStream, `${extraLine}\n\n`);
            }
          } catch (error) {
            console.error("[Stream Handler] Error parsing JSON:", line);
            Sentry.captureException(ensureError(error), {
              tags: {
                context: "stream-ai-pipeline",
                operation: "parse-stream-chunk",
              },
              extra: {
                lineSnippet: line.substring(0, 200),
              },
              level: "warning",
            });
            await writeChunkToStream(responseStream, `${line}\n`);
          }
        }
      }
    }

    if (sseBuffer.length > 0) {
      await writeChunkToStream(responseStream, sseBuffer);
    }

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
