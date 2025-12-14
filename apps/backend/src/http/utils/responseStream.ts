import { OutgoingHttpHeader, ServerResponse } from "node:http";
import { OutgoingHttpHeaders } from "node:http2";
import { Writable } from "node:stream";

// Type definition for ResponseStream (previously from lambda-stream)
type ResponseStream = Writable & {
  writeHead?: (statusCode: number, headers?: unknown) => void;
  on?: (event: string, callback: () => void) => void;
};

declare const awslambda: {
  HttpResponseStream: {
    from(
      stream: Writable,
      metadata: Record<string, unknown>
    ): Writable;
  };
} | undefined;

export const HttpResponseStream = {
  from(stream: Writable, metadata: Record<string, unknown>) {
    try {
      if (
        typeof awslambda !== "undefined" &&
        awslambda &&
        awslambda.HttpResponseStream &&
        typeof awslambda.HttpResponseStream.from === "function"
      ) {
        return awslambda.HttpResponseStream.from(
          stream as Writable,
          metadata as Record<string, unknown>
        );
      }
    } catch {
      // Fall through to return stream
    }
    return stream;
  },
};

export const enhanceResponseStream = (
  responseStream: ResponseStream,
  responseMetadata: {
    statusCode: number;
    statusMessage?: string;
    headers?: string | OutgoingHttpHeaders | OutgoingHttpHeader[] | undefined;
  }
): ServerResponse => {
  Object.assign(responseStream, {
    statusCode: 200,
    statusMessage: "OK",
    writeHead(
      statusCode: number,
      statusMessage?:
        | string
        | OutgoingHttpHeaders
        | OutgoingHttpHeader[]
        | undefined,
      headers?: OutgoingHttpHeaders | OutgoingHttpHeader[] | undefined
    ) {
      responseMetadata.statusCode = statusCode;
      if (typeof statusMessage === "string") {
        responseMetadata.statusMessage = statusMessage;
      } else {
        responseMetadata.headers = statusMessage;
      }
      if (headers) {
        responseMetadata.headers = headers;
      }
      return responseStream as unknown as ServerResponse;
    },
  } as ServerResponse);
  return responseStream as unknown as ServerResponse;
};

