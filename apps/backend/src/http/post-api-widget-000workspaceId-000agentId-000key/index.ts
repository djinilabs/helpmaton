import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { streamifyResponse } from "lambda-stream";

import { handlingErrors } from "../../utils/handlingErrors";
import type { LambdaUrlEvent } from "../../utils/httpEventAdapter";
import { adaptHttpHandler } from "../../utils/httpEventAdapter";
import { initSentry } from "../../utils/sentry";
import { normalizeEventToHttpV2 } from "../utils/streamEventNormalization";
import { type HttpResponseStream } from "../utils/streamResponseStream";

import { internalHandler } from "./internalHandler";

// Declare global awslambda for Lambda Function URL streaming
// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare const awslambda:
  | {
      streamifyResponse: <TEvent, TStream extends HttpResponseStream>(
        handler: (event: TEvent, responseStream: TStream) => Promise<void>
      ) => (event: TEvent, responseStream: TStream) => Promise<void>;
      HttpResponseStream: {
        from(
          underlyingStream: unknown,
          metadata: Record<string, unknown>
        ): HttpResponseStream;
      };
    }
  | undefined;

// Initialize Sentry when this module is loaded
initSentry();

/**
 * Main handler for widget endpoint
 * Supports both API Gateway and Lambda Function URL
 */
const createHandler = () => {
  if (typeof streamifyResponse !== "undefined") {
    return streamifyResponse(
      async (
        _event: APIGatewayProxyEventV2 | LambdaUrlEvent,
        responseStream: HttpResponseStream
      ): Promise<void> => {
        const httpV2Event = normalizeEventToHttpV2(_event);
        await internalHandler(httpV2Event, responseStream);
      }
    );
  }
  // Fallback for non-streaming environments
  return adaptHttpHandler(
    handlingErrors(async (): Promise<APIGatewayProxyResultV2> => {
      throw new Error("streamifyResponse is not available");
    })
  );
};

export const handler = createHandler();
