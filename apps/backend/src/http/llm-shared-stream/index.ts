import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { streamifyResponse } from "lambda-stream";

import { type LambdaUrlEvent } from "../../utils/httpEventAdapter";
import { initSentry } from "../../utils/sentry";
import { internalHandler } from "../any-api-streams-catchall/internalHandler";
import { normalizeEventToHttpV2 } from "../utils/streamEventNormalization";
import { type HttpResponseStream } from "../utils/streamResponseStream";

// Initialize Sentry when this module is loaded (before any handlers are called)
initSentry();

/**
 * Streaming handler for stream + test endpoints.
 * Must be wrapped once with streamifyResponse so Lambda passes a real stream.
 */
export const handler = streamifyResponse(
  async (
    event: APIGatewayProxyEvent | APIGatewayProxyEventV2 | LambdaUrlEvent,
    responseStream: HttpResponseStream
  ): Promise<APIGatewayProxyResultV2 | void> => {
    const httpV2Event = normalizeEventToHttpV2(event);
    await internalHandler(httpV2Event, responseStream);
  }
);
