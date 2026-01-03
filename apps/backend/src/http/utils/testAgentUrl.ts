import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";

// Cache the Function URL to avoid repeated API calls
let cachedFunctionUrl: string | null = null;
let cacheExpiry: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Gets the API base URL for local development
 * This is a shared utility function used by both test agent and other tools
 */
function getApiBaseUrl(): string {
  const baseUrl = process.env.BASE_URL;
  if (baseUrl) {
    // Remove trailing slash if present
    return baseUrl.replace(/\/+$/, "");
  }
  // Default to localhost for local development
  return "http://localhost:3333";
}

/**
 * Gets the test agent Lambda Function URL from CloudFormation stack outputs.
 * This is the most reliable method since the plugin creates a CloudFormation output.
 */
async function getTestAgentFunctionUrlFromCloudFormation(): Promise<
  string | null
> {
  const stackName =
    process.env.AWS_STACK_NAME ||
    process.env.ARC_STACK_NAME ||
    process.env.STACK_NAME;

  if (!stackName) {
    console.error(
      "[test-agent-url] Stack name not found. Checked AWS_STACK_NAME, ARC_STACK_NAME, STACK_NAME"
    );
    return null;
  }

  console.log(`[test-agent-url] Looking up Function URL for stack: ${stackName}`);

  try {
    const cfClient = new CloudFormationClient({});
    const command = new DescribeStacksCommand({ StackName: stackName });
    const response = await cfClient.send(command);

    const stack = response.Stacks?.[0];
    if (!stack) {
      console.error(`[test-agent-url] Stack ${stackName} not found`);
      return null;
    }

    console.log(
      `[test-agent-url] Stack found. Available outputs: ${
        stack.Outputs?.map((o) => o.OutputKey).join(", ") || "none"
      }`
    );

    // Look for TestAgentFunctionUrl output (created by lambda-urls plugin)
    const output = stack?.Outputs?.find(
      (o: { OutputKey?: string }) => o.OutputKey === "TestAgentFunctionUrl"
    );

    if (output?.OutputValue) {
      const functionUrl = output.OutputValue as string;
      // Normalize URL: remove trailing slash to avoid double slashes when appending paths
      const normalizedUrl = functionUrl.replace(/\/+$/, "");
      console.log(
        `[test-agent-url] Found TestAgentFunctionUrl output: ${functionUrl} (normalized: ${normalizedUrl})`
      );
      return normalizedUrl;
    } else {
      console.error(
        `[test-agent-url] TestAgentFunctionUrl output not found in stack ${stackName}`
      );
    }
  } catch (error) {
    console.error(
      "[test-agent-url] Error getting Function URL from CloudFormation:",
      error instanceof Error ? error.message : String(error),
      error instanceof Error ? error.stack : undefined
    );
  }

  return null;
}

/**
 * Gets the test agent Lambda Function URL with caching and local development support.
 * In local development (ARC_ENV === "testing"), returns the API Gateway URL directly.
 * In deployed environments, retrieves the Function URL from CloudFormation with caching.
 * 
 * @param workspaceId - Workspace ID for constructing the full endpoint path
 * @param agentId - Agent ID for constructing the full endpoint path
 * @returns The full Function URL including the test endpoint path, or API Gateway URL in local dev
 */
export async function getTestAgentFunctionUrl(
  workspaceId: string,
  agentId: string
): Promise<string> {
  // Local development: skip function URL discovery and use API Gateway URL directly
  if (process.env.ARC_ENV === "testing") {
    const apiBaseUrl = getApiBaseUrl();
    const testUrl = `${apiBaseUrl}/api/streams/${workspaceId}/${agentId}/test`;
    console.log(
      `[test-agent-url] Local development detected (ARC_ENV=testing), using API Gateway URL: ${testUrl}`
    );
    return testUrl;
  }

  // First, check if environment variable is set
  const envFunctionUrl = process.env.TEST_AGENT_FUNCTION_URL;

  if (envFunctionUrl) {
    // Normalize URL: remove trailing slash to avoid double slashes when appending paths
    const normalizedUrl = envFunctionUrl.replace(/\/+$/, "");
    const testUrl = `${normalizedUrl}/api/streams/${workspaceId}/${agentId}/test`;
    console.log(
      `[test-agent-url] Using TEST_AGENT_FUNCTION_URL environment variable: ${testUrl}`
    );
    return testUrl;
  }

  // Return cached Function URL if still valid
  if (cachedFunctionUrl && Date.now() < cacheExpiry) {
    const testUrl = `${cachedFunctionUrl}/api/streams/${workspaceId}/${agentId}/test`;
    console.log(
      `[test-agent-url] Using cached Function URL: ${testUrl}`
    );
    return testUrl;
  }

  // Try to get from CloudFormation stack outputs
  const functionUrl = await getTestAgentFunctionUrlFromCloudFormation();
  if (functionUrl) {
    // Normalize URL: remove trailing slash to avoid double slashes when appending paths
    const normalizedUrl = functionUrl.replace(/\/+$/, "");
    cachedFunctionUrl = normalizedUrl;
    cacheExpiry = Date.now() + CACHE_TTL;
    const testUrl = `${normalizedUrl}/api/streams/${workspaceId}/${agentId}/test`;
    console.log(
      `[test-agent-url] Retrieved Function URL from CloudFormation: ${functionUrl} (normalized: ${normalizedUrl}) with path: ${testUrl}`
    );
    return testUrl;
  }

  // Fallback to API Gateway URL if function URL not available
  // This can happen during deployment transition or if CloudFormation lookup fails
  const apiBaseUrl = getApiBaseUrl();
  const fallbackUrl = `${apiBaseUrl}/api/streams/${workspaceId}/${agentId}/test`;
  console.warn(
    `[test-agent-url] Function URL not available, falling back to API Gateway URL: ${fallbackUrl}`
  );
  return fallbackUrl;
}

