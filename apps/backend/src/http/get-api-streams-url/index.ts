import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import type { APIGatewayProxyResultV2 } from "aws-lambda";

import { handlingErrors } from "../../utils/handlingErrors";
import { adaptHttpHandler } from "../../utils/httpEventAdapter";

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
      "[get-api-streams-url] Stack name not found. Checked AWS_STACK_NAME, ARC_STACK_NAME, STACK_NAME"
    );
    return null;
  }

  console.log(
    `[get-api-streams-url] Looking up Function URL for stack: ${stackName}`
  );

  try {
    const cfClient = new CloudFormationClient({});
    const command = new DescribeStacksCommand({ StackName: stackName });
    const response = await cfClient.send(command);

    const stack = response.Stacks?.[0];
    if (!stack) {
      console.error(`[get-api-streams-url] Stack ${stackName} not found`);
      return null;
    }

    console.log(
      `[get-api-streams-url] Stack found. Available outputs: ${
        stack.Outputs?.map((o) => o.OutputKey).join(", ") || "none"
      }`
    );

    // Look for StreamingFunctionUrl output (created by lambda-urls plugin)
    const output = stack?.Outputs?.find(
      (o: { OutputKey?: string }) => o.OutputKey === "StreamingFunctionUrl"
    );

    if (output?.OutputValue) {
      const functionUrl = output.OutputValue as string;
      // Normalize URL: remove trailing slash to avoid double slashes when appending paths
      const normalizedUrl = functionUrl.replace(/\/+$/, "");
      console.log(
        `[get-api-streams-url] Found StreamingFunctionUrl output: ${functionUrl} (normalized: ${normalizedUrl})`
      );
      return normalizedUrl;
    } else {
      console.error(
        `[get-api-streams-url] StreamingFunctionUrl output not found in stack ${stackName}`
      );
    }
  } catch (error) {
    console.error(
      "[get-api-streams-url] Error getting Function URL from CloudFormation:",
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
  const functionUrl = await getFunctionUrlFromCloudFormation();
  if (functionUrl) {
    // Normalize URL: remove trailing slash to avoid double slashes when appending paths
    const normalizedUrl = functionUrl.replace(/\/+$/, "");
    cachedFunctionUrl = normalizedUrl;
    cacheExpiry = Date.now() + CACHE_TTL;
    console.log(
      `[get-api-streams-url] Retrieved Function URL from CloudFormation: ${functionUrl} (normalized: ${normalizedUrl})`
    );
    return normalizedUrl;
  }

  return null;
}

export const handler = adaptHttpHandler(
  handlingErrors(async (): Promise<APIGatewayProxyResultV2> => {
    console.log("[get-api-streams-url] Handler invoked");
    console.log(
      `[get-api-streams-url] Environment variables: STREAMING_FUNCTION_URL=${
        process.env.STREAMING_FUNCTION_URL || "not set"
      }, AWS_STACK_NAME=${
        process.env.AWS_STACK_NAME || "not set"
      }, ARC_STACK_NAME=${
        process.env.ARC_STACK_NAME || "not set"
      }, STACK_NAME=${process.env.STACK_NAME || "not set"}`
    );

    const streamingFunctionUrl = await getStreamingFunctionUrl();

    if (!streamingFunctionUrl) {
      console.error(
        "[get-api-streams-url] Failed to get streaming function URL. Returning 404."
      );
      return {
        statusCode: 404,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          error:
            "Streaming function URL not configured. The Lambda Function URL may not be deployed yet, or the URL could not be found in CloudFormation stack outputs.",
        }),
      };
    }

    console.log(
      `[get-api-streams-url] Successfully retrieved streaming function URL: ${streamingFunctionUrl}`
    );

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: streamingFunctionUrl,
      }),
    };
  })
);
