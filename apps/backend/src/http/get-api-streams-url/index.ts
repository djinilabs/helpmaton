import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

import { computeCorsHeaders } from "../utils/streamCorsHeaders";
import {
  createResponseStream,
  HttpResponseStream,
} from "../utils/streamResponseStream";

// Cache the Function URL to avoid repeated API calls
let cachedFunctionUrl: string | null = null;
let cacheExpiry: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Gets the streaming Lambda Function URL from CloudFormation stack outputs.
 * This is the most reliable method since the plugin creates a CloudFormation output.
 */
async function getFunctionUrlFromCloudFormation(): Promise<string | null> {
  const stackName =
    process.env.AWS_STACK_NAME ||
    process.env.ARC_STACK_NAME ||
    process.env.STACK_NAME;

  if (!stackName) {
    console.error(
      "[streams-url-handler] Stack name not found. Checked AWS_STACK_NAME, ARC_STACK_NAME, STACK_NAME"
    );
    return null;
  }

  console.log(
    `[streams-url-handler] Looking up Function URL for stack: ${stackName}`
  );

  try {
    const cfClient = new CloudFormationClient({});
    const command = new DescribeStacksCommand({ StackName: stackName });
    const response = await cfClient.send(command);

    const stack = response.Stacks?.[0];
    if (!stack) {
      console.error(`[streams-url-handler] Stack ${stackName} not found`);
      return null;
    }

    console.log(
      `[streams-url-handler] Stack found. Available outputs: ${
        stack.Outputs?.map((o) => o.OutputKey).join(", ") || "none"
      }`
    );

    // Check if stack has no outputs at all
    if (!stack.Outputs || stack.Outputs.length === 0) {
      console.error(`[streams-url-handler] Stack ${stackName} has no outputs`);
      return null;
    }

    // Look for StreamingFunctionUrl output (created by lambda-urls plugin)
    const output = stack.Outputs.find(
      (o: { OutputKey?: string }) => o.OutputKey === "StreamingFunctionUrl"
    );

    if (output?.OutputValue) {
      const functionUrl = output.OutputValue as string;
      // Normalize URL: remove trailing slash to avoid double slashes when appending paths
      const normalizedUrl = functionUrl.replace(/\/+$/, "");
      console.log(
        `[streams-url-handler] Found StreamingFunctionUrl output: ${functionUrl} (normalized: ${normalizedUrl})`
      );
      return normalizedUrl;
    } else {
      console.error(
        `[streams-url-handler] StreamingFunctionUrl output not found in stack ${stackName}`
      );
    }
  } catch (error) {
    console.error(
      "[streams-url-handler] Error getting Function URL from CloudFormation:",
      error instanceof Error ? error.message : String(error),
      error instanceof Error ? error.stack : undefined
    );
  }

  return null;
}

/**
 * Gets the streaming Lambda Function URL by finding the function and getting its URL.
 * Falls back to CloudFormation stack output if direct lookup fails.
 */
async function getStreamingFunctionUrl(): Promise<string | null> {
  // First, check if environment variable is set
  const envFunctionUrl = process.env.STREAMING_FUNCTION_URL;

  if (envFunctionUrl) {
    // Normalize URL: remove trailing slash to avoid double slashes when appending paths
    return envFunctionUrl.replace(/\/+$/, "");
  }

  // Return cached Function URL if still valid
  if (cachedFunctionUrl && Date.now() < cacheExpiry) {
    return cachedFunctionUrl;
  }

  // Try to get from CloudFormation stack outputs
  const functionUrl =
    (await getFunctionUrlFromCloudFormation()) || process.env.FRONTEND_URL;
  if (functionUrl) {
    // Normalize URL: remove trailing slash to avoid double slashes when appending paths
    const normalizedUrl = functionUrl.replace(/\/+$/, "");
    cachedFunctionUrl = normalizedUrl;
    cacheExpiry = Date.now() + CACHE_TTL;
    console.log(
      `[streams-url-handler] Retrieved Function URL from CloudFormation: ${functionUrl} (normalized: ${normalizedUrl})`
    );
    return normalizedUrl;
  }

  return null;
}

/**
 * Handles the URL endpoint (Function URL discovery) - returns JSON, not streaming
 * This endpoint always uses standard API Gateway response format
 */
export async function handleUrlEndpoint(
  event: APIGatewayProxyEventV2,
  responseStream: HttpResponseStream
): Promise<void> {
  console.log("[handleUrlEndpoint] Event:", event);
  const origin = event.headers["origin"] || event.headers["Origin"];
  const headers = computeCorsHeaders("url", origin, null);

  responseStream = createResponseStream(responseStream, {
    "Content-Type": "application/json",
    ...headers,
  });

  // Ensure requestContext.http exists (construct if missing)
  if (!event.requestContext?.http) {
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
      "GET";
    const path =
      eventAny.requestContext?.http?.path ||
      eventAny.requestContext?.path ||
      eventAny.rawPath ||
      "/api/streams/url";
    if (!event.requestContext) {
      event.requestContext = {
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
      event.requestContext.http = {
        method: method,
        path: path,
        protocol: "HTTP/1.1",
        sourceIp: "",
        userAgent: "",
      };
    }
  }

  if (event.requestContext.http.method === "OPTIONS") {
    responseStream.write("");
    responseStream.end();
    return;
  }

  // Only allow GET requests for URL endpoint
  if (event.requestContext.http.method !== "GET") {
    responseStream.write(
      JSON.stringify({
        error: `Only GET method is allowed for /api/streams/url and we got a ${event.requestContext.http.method} request`,
      })
    );
    responseStream.end();
    return;
  }

  console.log("[streams-url-handler] Handler invoked for URL endpoint");
  console.log(
    `[streams-url-handler] Environment variables: STREAMING_FUNCTION_URL=${
      process.env.STREAMING_FUNCTION_URL || "not set"
    }, AWS_STACK_NAME=${
      process.env.AWS_STACK_NAME || "not set"
    }, ARC_STACK_NAME=${process.env.ARC_STACK_NAME || "not set"}, STACK_NAME=${
      process.env.STACK_NAME || "not set"
    }`
  );

  const streamingFunctionUrl = await getStreamingFunctionUrl();

  responseStream = createResponseStream(responseStream, headers);

  if (!streamingFunctionUrl) {
    console.error(
      "[streams-url-handler] Failed to get streaming function URL. Returning 404."
    );
    responseStream.write(
      JSON.stringify({
        error:
          "Streaming function URL not configured. The Lambda Function URL may not be deployed yet, or the URL could not be found in CloudFormation stack outputs.",
      })
    );
    responseStream.end();
    return;
  }

  console.log(
    `[streams-url-handler] Successfully retrieved streaming function URL: ${streamingFunctionUrl}`
  );

  responseStream.write(
    JSON.stringify({
      url: streamingFunctionUrl,
    })
  );
  responseStream.end();
}
