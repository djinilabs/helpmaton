import type { Context ,
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
} from "aws-lambda";

import {
  transformLambdaUrlToHttpV2Event,
  transformRestToHttpV2Event,
  type LambdaUrlEvent,
} from "../../utils/httpEventAdapter";
import {
  augmentContextWithCreditTransactions,
  setCurrentHTTPContext,
} from "../../utils/workspaceCreditContext";

/**
 * Normalizes an event to APIGatewayProxyEventV2 format
 */
export function normalizeEventToHttpV2(
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2 | LambdaUrlEvent
): APIGatewayProxyEventV2 {
  // Transform REST API v1 events to v2 format if needed
  if ("httpMethod" in event && event.httpMethod !== undefined) {
    return transformRestToHttpV2Event(event as APIGatewayProxyEvent);
  }

  // Transform Lambda Function URL events
  if ("rawPath" in event && "requestContext" in event) {
    return transformLambdaUrlToHttpV2Event(event as LambdaUrlEvent);
  }

  // Already APIGatewayProxyEventV2
  return event as unknown as APIGatewayProxyEventV2;
}

/**
 * Ensures requestContext.http exists on an event
 */
export function ensureRequestContextHttp(
  event: APIGatewayProxyEventV2 | LambdaUrlEvent
): APIGatewayProxyEventV2 {
  const httpV2Event =
    "version" in event && event.version === "2.0"
      ? (event as APIGatewayProxyEventV2)
      : "rawPath" in event
      ? transformLambdaUrlToHttpV2Event(event as LambdaUrlEvent)
      : (event as APIGatewayProxyEventV2);

  if (!httpV2Event.requestContext?.http) {
    const eventAny = event as {
      requestContext?: {
        http?: { method?: string; path?: string };
        httpMethod?: string;
        path?: string;
      };
      rawPath?: string;
    };
    const method =
      eventAny.requestContext?.http?.method ||
      eventAny.requestContext?.httpMethod ||
      "POST";
    const path =
      eventAny.requestContext?.http?.path ||
      eventAny.requestContext?.path ||
      eventAny.rawPath ||
      "/";

    if (!httpV2Event.requestContext) {
      httpV2Event.requestContext = {
        accountId: "",
        apiId: "",
        domainName: "",
        domainPrefix: "",
        http: {
          method: method,
          path: path,
          protocol: "HTTP/1.1",
          sourceIp: "",
          userAgent: "",
        },
        requestId: "",
        routeKey: `${method} ${path}`,
        stage: "$default",
        time: new Date().toISOString(),
        timeEpoch: Date.now(),
      };
    } else {
      httpV2Event.requestContext.http = {
        method: method,
        path: path,
        protocol: "HTTP/1.1",
        sourceIp: "",
        userAgent: "",
      };
    }
  }

  return httpV2Event;
}

/**
 * Creates a synthetic Lambda context for workspace credit transactions
 */
export function createSyntheticContext(awsRequestId: string): Context {
  return {
    callbackWaitsForEmptyEventLoop: false,
    awsRequestId,
    functionName: process.env.AWS_LAMBDA_FUNCTION_NAME || "stream-handler",
    functionVersion: process.env.AWS_LAMBDA_FUNCTION_VERSION || "$LATEST",
    invokedFunctionArn: process.env.AWS_LAMBDA_FUNCTION_ARN || "",
    memoryLimitInMB: process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE || "512",
    getRemainingTimeInMillis: () => 300000,
    logGroupName: process.env.AWS_LAMBDA_LOG_GROUP_NAME || "",
    logStreamName: process.env.AWS_LAMBDA_LOG_STREAM_NAME || "",
    done: () => {},
    fail: () => {},
    succeed: () => {},
  };
}

/**
 * Sets up workspace credit context for a request
 */
export function setupWorkspaceCreditContext(
  awsRequestId: string | undefined,
  context?: Context
): void {
  if (!awsRequestId) return;

  if (context) {
    // Use provided context
    const augmentedContext = augmentContextWithCreditTransactions(context);
    setCurrentHTTPContext(awsRequestId, augmentedContext);
  } else {
    // Create synthetic context
    const syntheticContext = createSyntheticContext(awsRequestId);
    const augmentedContext =
      augmentContextWithCreditTransactions(syntheticContext);
    setCurrentHTTPContext(awsRequestId, augmentedContext);
  }
}

