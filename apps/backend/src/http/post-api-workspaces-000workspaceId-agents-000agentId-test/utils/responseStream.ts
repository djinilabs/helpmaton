import { Writable } from "node:stream";

// Type definition for ResponseStream (previously from lambda-stream)
type ResponseStream = Writable & {
  writeHead?: (statusCode: number, headers?: unknown) => void;
  on?: (event: string, callback: () => void) => void;
};

import {
  enhanceResponseStream,
  HttpResponseStream,
} from "../../utils/responseStream";

import type { HttpResponseMetadata } from "./types";

/**
 * Creates and configures the response stream with proper headers
 */
export function setupResponseStream(
  responseStream: Writable,
  onFinish: () => void
): {
  enhancedStream: ReturnType<typeof enhanceResponseStream>;
  metadata: HttpResponseMetadata;
} {
  const httpResponseMetadata: HttpResponseMetadata = {
    statusCode: 200,
    statusMessage: "OK",
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  };

  const httpResponseStream = HttpResponseStream.from(
    responseStream,
    httpResponseMetadata as unknown as Record<string, unknown>
  );

  const enhancedStream = enhanceResponseStream(
    httpResponseStream as ResponseStream,
    httpResponseMetadata
  );

  enhancedStream.writeHead(200, httpResponseMetadata.headers);
  enhancedStream.on("finish", onFinish);

  return { enhancedStream, metadata: httpResponseMetadata };
}

/**
 * Extracts text delta from AI SDK chunk
 */
export function extractTextDelta(chunk: unknown): string | undefined {
  if (typeof chunk === "string") {
    return chunk;
  }
  if (typeof chunk !== "object" || chunk == null) {
    return undefined;
  }
  if ("textDelta" in chunk) {
    return chunk.textDelta as string | undefined;
  }
  if ("text" in chunk) {
    return chunk.text as string | undefined;
  }
  return undefined;
}
