import { getDefined } from "../../utils";

// Declare global awslambda for Lambda Function URL streaming
declare const awslambda:
  | {
      HttpResponseStream: {
        from(
          underlyingStream: unknown,
          metadata: Record<string, unknown>
        ): HttpResponseStream;
      };
    }
  | undefined;

// Type for AWS Lambda HttpResponseStream (available in RESPONSE_STREAM mode)
export interface HttpResponseStream {
  write(chunk: string | Uint8Array, callback?: (error?: Error) => void): void;
  end(callback?: (error?: Error) => void): void;
}

/**
 * Creates a response stream with headers for Lambda Function URLs
 */
export function createResponseStream(
  stream: HttpResponseStream,
  headers: Record<string, string>
): HttpResponseStream {
  if (typeof awslambda !== "undefined" && awslambda) {
    return getDefined(
      awslambda,
      "awslambda is not defined"
    ).HttpResponseStream.from(stream, {
      statusCode: 200,
      headers,
    });
  }
  return stream;
}

/**
 * Creates a mock response stream that buffers all chunks
 * Used for API Gateway where we need to return a complete response
 */
export function createMockResponseStream(): {
  stream: HttpResponseStream;
  buffer: Uint8Array[];
  getBody(): string;
} {
  const buffer: Uint8Array[] = [];

  const stream: HttpResponseStream = {
    write: (chunk: string | Uint8Array, callback?: (error?: Error) => void) => {
      const bytes =
        typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
      buffer.push(bytes);
      if (callback) {
        callback();
      }
    },
    end: (callback?: (error?: Error) => void) => {
      if (callback) {
        callback();
      }
    },
  };

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

  return { stream, buffer, getBody };
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
