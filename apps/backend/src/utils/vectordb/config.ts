/**
 * Configuration for vector database operations
 */

// Get S3 bucket name from environment variables
// Uses staging or production bucket based on environment
// For local development, defaults to "vectordb.staging" (same bucket pattern as workspace documents)
export function getS3BucketName(): string {
  const arcEnv = process.env.ARC_ENV;
  const nodeEnv = process.env.NODE_ENV;
  const isProduction = arcEnv === "production" || nodeEnv === "production";

  // Bucket names come from secrets/environment variables
  // These should be set in the deployment configuration
  const bucketName = isProduction
    ? process.env.HELPMATON_VECTORDB_S3_BUCKET_PRODUCTION ||
      process.env.HELPMATON_S3_BUCKET_PRODUCTION
    : process.env.HELPMATON_VECTORDB_S3_BUCKET_STAGING ||
      process.env.HELPMATON_S3_BUCKET_STAGING ||
      "vectordb.staging"; // Default for local development

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
export function getS3ConnectionOptions(): {
  region?: string;
  storageOptions?: {
    awsAccessKeyId?: string;
    awsSecretAccessKey?: string;
    endpoint?: string;
    region?: string;
  };
} {
  // Check environment - be explicit about production detection
  // In Lambda, ARC_ENV should be set by Architect, but we also check NODE_ENV as fallback
  const arcEnv = process.env.ARC_ENV;
  const nodeEnv = process.env.NODE_ENV;
  const isLocal =
    arcEnv === "testing" ||
    (arcEnv !== "production" && nodeEnv !== "production");

  if (isLocal) {
    // Local development with s3rver
    const endpoint =
      process.env.HELPMATON_S3_ENDPOINT || "http://localhost:4568";

    console.log(
      `[VectorDB Config] Local mode - endpoint: ${endpoint}, region: us-east-1`
    );

    return {
      region: "us-east-1",
      storageOptions: {
        awsAccessKeyId: "S3RVER",
        awsSecretAccessKey: "S3RVER",
        endpoint,
        region: "us-east-1",
      },
    };
  }

  // Production - use explicit credentials from environment variables
  const region =
    process.env.HELPMATON_S3_REGION ||
    process.env.AWS_REGION ||
    DEFAULT_S3_REGION;

  // Use S3-specific credentials if provided, otherwise fall back to standard AWS credentials
  const accessKeyId =
    process.env.HELPMATON_S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey =
    process.env.HELPMATON_S3_SECRET_ACCESS_KEY ||
    process.env.AWS_SECRET_ACCESS_KEY;

  const options: {
    region?: string;
    storageOptions?: {
      awsAccessKeyId?: string;
      awsSecretAccessKey?: string;
      endpoint?: string;
      region?: string;
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
