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
 * This is a shared utility function used by both scrape and other tools
 */
function getApiBaseUrl(): string {
  const baseUrl = process.env.BASE_URL;
  if (baseUrl) {
    // Remove trailing slash if present
    return baseUrl.replace(/\/+$/, "");
  }
  // Default to localhost for local development
  return "http://localhost:5173";
}

/**
 * Gets the scrape Lambda Function URL from CloudFormation stack outputs.
 * This is the most reliable method since the plugin creates a CloudFormation output.
 */
async function getScrapeFunctionUrlFromCloudFormation(): Promise<
  string | null
> {
  const stackName =
    process.env.AWS_STACK_NAME ||
    process.env.ARC_STACK_NAME ||
    process.env.STACK_NAME;

  if (!stackName) {
    console.error(
      "[scrape-url] Stack name not found. Checked AWS_STACK_NAME, ARC_STACK_NAME, STACK_NAME"
    );
    return null;
  }

  console.log(`[scrape-url] Looking up Function URL for stack: ${stackName}`);

  try {
    const cfClient = new CloudFormationClient({});
    const command = new DescribeStacksCommand({ StackName: stackName });
    const response = await cfClient.send(command);

    const stack = response.Stacks?.[0];
    if (!stack) {
      console.error(`[scrape-url] Stack ${stackName} not found`);
      return null;
    }

    console.log(
      `[scrape-url] Stack found. Available outputs: ${
        stack.Outputs?.map((o) => o.OutputKey).join(", ") || "none"
      }`
    );

    // Look for ScrapeFunctionUrl output (created by lambda-urls plugin)
    const output = stack?.Outputs?.find(
      (o: { OutputKey?: string }) => o.OutputKey === "ScrapeFunctionUrl"
    );

    if (output?.OutputValue) {
      const functionUrl = output.OutputValue as string;
      // Normalize URL: remove trailing slash to avoid double slashes when appending paths
      const normalizedUrl = functionUrl.replace(/\/+$/, "");
      console.log(
        `[scrape-url] Found ScrapeFunctionUrl output: ${functionUrl} (normalized: ${normalizedUrl})`
      );
      return normalizedUrl;
    } else {
      console.error(
        `[scrape-url] ScrapeFunctionUrl output not found in stack ${stackName}`
      );
    }
  } catch (error) {
    console.error(
      "[scrape-url] Error getting Function URL from CloudFormation:",
      error instanceof Error ? error.message : String(error),
      error instanceof Error ? error.stack : undefined
    );
  }

  return null;
}

/**
 * Gets the scrape Lambda Function URL with caching and local development support.
 * In local development (ARC_ENV === "testing"), returns the API Gateway URL directly.
 * In deployed environments, retrieves the Function URL from CloudFormation with caching.
 */
export async function getScrapeFunctionUrl(): Promise<string> {
  // Local development: skip function URL discovery and use API Gateway URL directly
  if (process.env.ARC_ENV === "testing") {
    const apiBaseUrl = getApiBaseUrl();
    const scrapeUrl = `${apiBaseUrl}/api/scrape`;
    console.log(
      `[scrape-url] Local development detected (ARC_ENV=testing), using API Gateway URL: ${scrapeUrl}`
    );
    return scrapeUrl;
  }

  // First, check if environment variable is set
  const envFunctionUrl = process.env.SCRAPE_FUNCTION_URL;

  if (envFunctionUrl) {
    // Normalize URL: remove trailing slash to avoid double slashes when appending paths
    return envFunctionUrl.replace(/\/+$/, "");
  }

  // Return cached Function URL if still valid
  if (cachedFunctionUrl && Date.now() < cacheExpiry) {
    return cachedFunctionUrl;
  }

  // Try to get from CloudFormation stack outputs
  const functionUrl = await getScrapeFunctionUrlFromCloudFormation();
  if (functionUrl) {
    // Normalize URL: remove trailing slash to avoid double slashes when appending paths
    const normalizedUrl = functionUrl.replace(/\/+$/, "");
    cachedFunctionUrl = normalizedUrl;
    cacheExpiry = Date.now() + CACHE_TTL;
    console.log(
      `[scrape-url] Retrieved Function URL from CloudFormation: ${functionUrl} (normalized: ${normalizedUrl})`
    );
    return normalizedUrl;
  }

  // Fallback to API Gateway URL if function URL not available
  // This can happen during deployment transition or if CloudFormation lookup fails
  const apiBaseUrl = getApiBaseUrl();
  const fallbackUrl = `${apiBaseUrl}/api/scrape`;
  console.warn(
    `[scrape-url] Function URL not available, falling back to API Gateway URL: ${fallbackUrl}`
  );
  return fallbackUrl;
}
