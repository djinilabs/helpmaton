import type { ResponseStream } from "lambda-stream";

import { getDefined } from "../../utils";

// Declare global awslambda for Lambda Function URL streaming
// We still need this for HttpResponseStream.from() metadata helper
declare const awslambda:
  | {
      HttpResponseStream: {
        from(
          underlyingStream: unknown,
          metadata: Record<string, unknown>
        ): ResponseStream;
      };
    }
  | undefined;

// Export ResponseStream type from lambda-stream for use throughout the codebase
// This provides better types and local testing support
export type HttpResponseStream = ResponseStream;

/**
 * Creates a response stream with headers for Lambda Function URLs
 * Uses awslambda.HttpResponseStream.from() for metadata (as shown in lambda-stream docs)
 */
export function createResponseStream(
  stream: HttpResponseStream,
  headers: Record<string, string>,
  statusCode: number = 200
): HttpResponseStream {
  if (typeof awslambda !== "undefined" && awslambda.HttpResponseStream) {
    return getDefined(
      awslambda,
      "awslambda is not defined"
    ).HttpResponseStream.from(stream, {
      statusCode,
      headers,
    });
  }
  // When awslambda is undefined (e.g., in tests), store status code and headers on the stream
  // This allows tests to extract status codes and headers
  const streamWithMetadata = stream as HttpResponseStream & {
    _statusCode?: number;
    _headers?: Record<string, string>;
  };
  streamWithMetadata._statusCode = statusCode;
  streamWithMetadata._headers = headers;
  return streamWithMetadata;
}

/**
 * Creates a mock response stream that buffers all chunks
 * Used for API Gateway where we need to return a complete response
 * The mock stream implements the ResponseStream interface from lambda-stream
 */
export function createMockResponseStream(): {
  stream: HttpResponseStream & { _statusCode?: number; _headers?: Record<string, string> };
  buffer: Uint8Array[];
  getBody(): string;
  getStatusCode(): number;
  getHeaders(): Record<string, string>;
} {
  const buffer: Uint8Array[] = [];
  const statusCode = 200;
  const headers: Record<string, string> = {};

  // Create a mock stream that matches ResponseStream interface
  // ResponseStream.write can return boolean or accept callback
  // ResponseStream.end can return ResponseStream or accept callback
  const stream = {
    _statusCode: statusCode,
    _headers: headers,
    write: (
      chunk: string | Uint8Array,
      callback?: (error?: Error | null) => void
    ): boolean => {
      const bytes =
        typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
      buffer.push(bytes);
      if (callback) {
        callback();
      }
      return true; // Return boolean as required by ResponseStream interface
    },
    end: (callback?: (error?: Error | null) => void): HttpResponseStream => {
      if (callback) {
        callback();
      }
      return stream; // Return ResponseStream as required by interface
    },
  } as HttpResponseStream & { _statusCode?: number; _headers?: Record<string, string> };

  const getBody = (): string => {
    const totalLength = buffer.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of buffer) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    return new TextDecoder().decode(combined);
  };

  const getStatusCode = (): number => {
    return stream._statusCode ?? 200;
  };

  const getHeaders = (): Record<string, string> => {
    return stream._headers ?? {};
  };

  return { stream, buffer, getBody, getStatusCode, getHeaders };
}

/**
 * Writes a chunk to the response stream
 * Returns a Promise that resolves when the chunk is written
 * Accepts both string and Uint8Array for flexibility
 */
export function writeChunkToStream(
  responseStream: HttpResponseStream,
  chunk: string | Uint8Array
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    responseStream.write(chunk, (error) => {
      if (error) {
        console.error("[Stream Handler] Error writing chunk:", {
          error: error instanceof Error ? error.message : String(error),
        });
        reject(error);
      } else {
        resolve();
      }
    });
  });
}
