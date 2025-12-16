/**
 * Configuration for vector database operations
 */

// Get S3 bucket name from environment variables
// Uses staging or production bucket based on environment
export function getS3BucketName(): string {
  const arcEnv = process.env.ARC_ENV;
  const nodeEnv = process.env.NODE_ENV;
  const isProduction =
    arcEnv === "production" || nodeEnv === "production";

  // Bucket names come from secrets/environment variables
  // These should be set in the deployment configuration
  const bucketName = isProduction
    ? process.env.HELPMATON_VECTORDB_S3_BUCKET_PRODUCTION ||
      process.env.HELPMATON_S3_BUCKET_PRODUCTION
    : process.env.HELPMATON_VECTORDB_S3_BUCKET_STAGING ||
      process.env.HELPMATON_S3_BUCKET_STAGING;

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

