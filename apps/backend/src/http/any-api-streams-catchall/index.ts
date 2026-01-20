// Refactored streaming handler - simplified and using specialized utilities
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { streamifyResponse } from "lambda-stream";

import { type LambdaUrlEvent } from "../../utils/httpEventAdapter";
import { initSentry } from "../../utils/sentry";
import { normalizeEventToHttpV2 } from "../utils/streamEventNormalization";
import { type HttpResponseStream } from "../utils/streamResponseStream";

import { internalHandler } from "./internalHandler";

// Initialize Sentry when this module is loaded (before any handlers are called)
initSentry();

/**
 * Dual handler wrapper that supports both Lambda Function URL and API Gateway
 */
const createHandler = () => {
  return streamifyResponse(
    async (
      event: APIGatewayProxyEvent | APIGatewayProxyEventV2 | LambdaUrlEvent,
      responseStream: HttpResponseStream
    ): Promise<APIGatewayProxyResultV2 | void> => {
      console.log("[Stream Handler] Handler called", { event, responseStream });
      const httpV2Event = normalizeEventToHttpV2(event);
      console.log("[Stream Handler] Standard invocation");
      // Standard invocation
      await internalHandler(httpV2Event, responseStream);
    }
  );
};

/**
 * Streaming Lambda handler for agent interactions
 * Supports both Lambda Function URL (true streaming) and API Gateway (buffered)
 */
export const handler = createHandler();
