/**
 * Configuration for vector database operations
 */

// Get S3 bucket name from environment variables
// Uses staging or production bucket based on environment
// For local development (ARC_ENV=testing), always uses "vectordb.staging" to match the local S3 server (s3rver) configuration
export function getS3BucketName(): string {
  const arcEnv = process.env.ARC_ENV;
  const isLocalTesting = arcEnv === "testing";

  // In local testing mode (sandbox), always use "vectordb.staging" to match s3rver plugin configuration
  // This ensures LanceDB uses the bucket that's automatically created by the local S3 server
  if (isLocalTesting) {
    const bucketName = "vectordb.staging";
    console.log(
      `[VectorDB Config] Local testing mode - using bucket: ${bucketName} (matches s3rver configuration)`
    );
    return bucketName;
  }

  // Production/staging environments - use environment variables
  // Bucket names come from secrets/environment variables
  // These should be set in the deployment configuration
  const bucketName =
    process.env.HELPMATON_VECTORDB_S3_BUCKET_PRODUCTION ||
    process.env.HELPMATON_VECTORDB_S3_BUCKET_STAGING ||
    "vectordb.staging"; // Fallback for other non-production environments

  if (!bucketName) {
    throw new Error(
      `S3 bucket name not configured. Set HELPMATON_VECTORDB_S3_BUCKET_PRODUCTION or HELPMATON_VECTORDB_S3_BUCKET_STAGING environment variable.`
    );
  }

  return bucketName;
}

/**
 * Default query limit
 */
export const DEFAULT_QUERY_LIMIT = 100;

/**
 * Maximum query limit
 */
export const MAX_QUERY_LIMIT = 1000;

/**
 * Connection timeout in milliseconds
 */
export const CONNECTION_TIMEOUT_MS = 30000; // 30 seconds

/**
 * Default S3 region
 */
export const DEFAULT_S3_REGION = "eu-west-2";

/**
 * Get S3 connection options for LanceDB
 * Handles local development (s3rver) vs production (AWS S3)
 */
// Return type matches what LanceDB expects, but we use Record<string, unknown> for flexibility
export function getS3ConnectionOptions(): {
  region?: string;
  storageOptions?: Record<string, unknown>;
} {
  // Check environment - only use local s3rver configuration when explicitly in testing mode
  // Architect sandbox sets ARC_ENV=testing for local development
  const arcEnv = process.env.ARC_ENV;
  const isLocal = arcEnv === "testing";

  // Use S3-specific credentials if provided, otherwise fall back to standard AWS credentials
  const accessKeyId =
    process.env.HELPMATON_S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey =
    process.env.HELPMATON_S3_SECRET_ACCESS_KEY ||
    process.env.AWS_SECRET_ACCESS_KEY;

  // If no credentials are provided, fall back to local configuration
  // This handles test environments and local development
  if (isLocal || !accessKeyId || !secretAccessKey) {
    // Local development with s3rver
    // Use DEFAULT_S3_REGION for consistency (region doesn't matter for local s3rver)
    // Force path-style addressing for local S3 (bucket in path, not hostname)
    const endpoint =
      process.env.HELPMATON_S3_ENDPOINT || "http://localhost:4568";

    const storageOptions: Record<string, string> = {
      // Primary configuration (camelCase for JavaScript/TypeScript)
      awsAccessKeyId: "S3RVER",
      awsSecretAccessKey: "S3RVER",
      endpoint: endpoint,
      region: DEFAULT_S3_REGION,
      s3ForcePathStyle: "true", // Force path-style: http://endpoint/bucket/path (required for s3rver)
      // Also include snake_case versions for Python API compatibility
      aws_access_key_id: "S3RVER",
      aws_secret_access_key: "S3RVER",
      aws_endpoint: endpoint,
      aws_region: DEFAULT_S3_REGION,
    };

    console.log(
      `[VectorDB Config] Local mode - endpoint: ${endpoint}, region: ${DEFAULT_S3_REGION}, path-style addressing (s3ForcePathStyle=true)`
    );
    console.log(
      `[VectorDB Config] Storage options:`,
      JSON.stringify(storageOptions, null, 2)
    );

    return {
      region: DEFAULT_S3_REGION,
      storageOptions,
    };
  }

  // Production - use explicit credentials from environment variables
  const region =
    process.env.HELPMATON_S3_REGION ||
    process.env.AWS_REGION ||
    DEFAULT_S3_REGION;

  const options: {
    region?: string;
    storageOptions?: {
      awsAccessKeyId?: string;
      awsSecretAccessKey?: string;
      endpoint?: string;
      region?: string;
      virtualHostedStyleRequest?: boolean;
      [key: string]: string | boolean | undefined;
    };
  } = {
    region,
  };

  // Only set credentials if explicitly provided
  // Otherwise, LanceDB will use AWS SDK default credential chain (IAM roles, etc.)
  if (accessKeyId && secretAccessKey) {
    options.storageOptions = {
      awsAccessKeyId: accessKeyId,
      awsSecretAccessKey: secretAccessKey,
      region,
    };

    // Check for custom endpoint (for S3-compatible services like MinIO)
    const customEndpoint = process.env.HELPMATON_S3_ENDPOINT;
    if (
      customEndpoint &&
      !customEndpoint.includes("localhost") &&
      !customEndpoint.includes("127.0.0.1")
    ) {
      options.storageOptions.endpoint = customEndpoint;
      console.log(
        `[VectorDB Config] Production mode - custom endpoint: ${customEndpoint}, region: ${region}`
      );
    } else {
      console.log(
        `[VectorDB Config] Production mode - AWS S3, region: ${region}`
      );
    }
  } else {
    console.log(
      `[VectorDB Config] Production mode - using IAM role/default credentials, region: ${region}`
    );
  }

  return options;
}
