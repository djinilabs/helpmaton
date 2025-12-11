import awsLite from "@aws-lite/client";
import s3Plugin from "@aws-lite/s3";

// Use bucket name with period to force path-style addressing for local S3 servers
const BUCKET_NAME = process.env.HELPMATON_S3_BUCKET || "workspace.documents";

// Get S3 client configuration
async function getS3Client() {
  // Check environment - be explicit about production detection
  // In Lambda, ARC_ENV should be set by Architect, but we also check NODE_ENV as fallback
  const arcEnv = process.env.ARC_ENV;
  const nodeEnv = process.env.NODE_ENV;
  const isLocal =
    arcEnv === "testing" ||
    (arcEnv !== "production" && nodeEnv !== "production");

  const config: {
    region?: string;
    endpoint?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    plugins?: unknown[];
  } = {
    plugins: [s3Plugin],
  };

  if (isLocal) {
    // Local development with s3rver
    const endpoint =
      process.env.HELPMATON_S3_ENDPOINT || "http://localhost:4568";
    config.endpoint = endpoint;
    config.accessKeyId = "S3RVER";
    config.secretAccessKey = "S3RVER";
    config.region = "us-east-1";

    console.log(
      `[getS3Client] Local mode - endpoint: ${config.endpoint}, bucket: ${BUCKET_NAME}`
    );
  } else {
    // Production - use explicit credentials from environment variables
    const region =
      process.env.HELPMATON_S3_REGION || process.env.AWS_REGION || "eu-west-2";
    config.region = region;

    // Explicitly set S3 endpoint to use path-style addressing
    // This prevents virtual-hosted-style addressing which can cause DNS resolution issues
    const customEndpoint = process.env.HELPMATON_S3_ENDPOINT;

    // In production, never use localhost endpoints - always use AWS S3 endpoint
    if (
      customEndpoint &&
      !customEndpoint.includes("localhost") &&
      !customEndpoint.includes("127.0.0.1")
    ) {
      // Use custom endpoint if provided (for S3-compatible services like MinIO, etc.)
      config.endpoint = customEndpoint;
      console.log(
        `[getS3Client] Production mode - custom endpoint: ${config.endpoint}, region: ${region}, bucket: ${BUCKET_NAME}`
      );
    } else {
      // Always use regional S3 endpoint in production - explicitly set to force path-style addressing
      // Path-style: https://s3.region.amazonaws.com/bucket/key
      // Virtual-hosted: https://bucket.s3.region.amazonaws.com/key (causes DNS issues)
      // Note: Bucket names with dots automatically force path-style, but we set endpoint explicitly anyway
      config.endpoint = `https://s3.${region}.amazonaws.com`;
      console.log(
        `[getS3Client] Production mode - AWS endpoint: ${config.endpoint}, region: ${region}, bucket: ${BUCKET_NAME}`
      );

      // Warn if custom endpoint was set but ignored
      if (customEndpoint) {
        console.warn(
          `[getS3Client] WARNING: HELPMATON_S3_ENDPOINT was set to ${customEndpoint} but contains localhost - using AWS endpoint instead`
        );
      }
    }

    // Use S3-specific credentials if provided, otherwise fall back to standard AWS credentials
    const accessKeyId =
      process.env.HELPMATON_S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey =
      process.env.HELPMATON_S3_SECRET_ACCESS_KEY ||
      process.env.AWS_SECRET_ACCESS_KEY;

    if (accessKeyId && secretAccessKey) {
      config.accessKeyId = accessKeyId;
      config.secretAccessKey = secretAccessKey;
      console.log(
        `[getS3Client] Using explicit credentials (accessKeyId: ${
          accessKeyId ? "set" : "not set"
        })`
      );
    } else {
      console.log(
        `[getS3Client] No explicit credentials - will use IAM role if available`
      );
    }
  }

  console.log(
    `[getS3Client] Final config - endpoint: ${config.endpoint}, region: ${config.region}, isLocal: ${isLocal}`
  );

  const aws = await awsLite(config);
  return (
    aws as unknown as {
      S3: {
        HeadObject: (params: { Bucket: string; Key: string }) => Promise<void>;
        PutObject: (params: {
          Bucket: string;
          Key: string;
          Body: Buffer | string;
          ContentType?: string;
        }) => Promise<void>;
        GetObject: (params: { Bucket: string; Key: string }) => Promise<{
          Body: Buffer | string | AsyncIterable<Uint8Array>;
        }>;
        DeleteObject: (params: {
          Bucket: string;
          Key: string;
        }) => Promise<void>;
        CopyObject: (params: {
          Bucket: string;
          CopySource: string;
          Key: string;
        }) => Promise<void>;
      };
    }
  ).S3;
}

// Normalize folder path: remove leading/trailing slashes, handle empty string as root
export function normalizeFolderPath(folderPath: string): string {
  if (!folderPath) return "";
  // Remove leading and trailing slashes
  const normalized = folderPath.trim().replace(/^\/+|\/+$/g, "");
  // Prevent path traversal
  if (normalized.includes("..")) {
    throw new Error("Invalid folder path: path traversal not allowed");
  }
  return normalized;
}

// Build S3 key from workspace ID, folder path, and filename
export function buildS3Key(
  workspaceId: string,
  folderPath: string,
  filename: string
): string {
  const normalizedPath = normalizeFolderPath(folderPath);
  if (normalizedPath) {
    return `workspaces/${workspaceId}/documents/${normalizedPath}/${filename}`;
  }
  return `workspaces/${workspaceId}/documents/${filename}`;
}

// Check if a filename exists in a folder
export async function checkFilenameExists(
  workspaceId: string,
  filename: string,
  folderPath: string
): Promise<boolean> {
  const s3 = await getS3Client();
  const key = buildS3Key(workspaceId, folderPath, filename);

  try {
    await s3.HeadObject({
      Bucket: BUCKET_NAME,
      Key: key,
    });
    return true;
  } catch (error: unknown) {
    if (error && typeof error === "object" && "statusCode" in error) {
      if (error.statusCode === 404) {
        return false;
      }
    }
    throw error;
  }
}

// Generate unique filename if conflict exists
export async function generateUniqueFilename(
  workspaceId: string,
  originalFilename: string,
  folderPath: string
): Promise<string> {
  const exists = await checkFilenameExists(
    workspaceId,
    originalFilename,
    folderPath
  );
  if (!exists) {
    return originalFilename;
  }

  // Extract name and extension
  const lastDot = originalFilename.lastIndexOf(".");
  if (lastDot === -1) {
    // No extension
    let counter = 1;
    let candidate = `${originalFilename}-${counter}`;
    while (await checkFilenameExists(workspaceId, candidate, folderPath)) {
      counter++;
      candidate = `${originalFilename}-${counter}`;
    }
    return candidate;
  }

  const name = originalFilename.substring(0, lastDot);
  const ext = originalFilename.substring(lastDot);
  let counter = 1;
  let candidate = `${name}-${counter}${ext}`;

  while (await checkFilenameExists(workspaceId, candidate, folderPath)) {
    counter++;
    candidate = `${name}-${counter}${ext}`;
  }

  return candidate;
}

// Upload document to S3
export async function uploadDocument(
  workspaceId: string,
  documentId: string,
  content: Buffer | string,
  filename: string,
  contentType: string,
  folderPath: string
): Promise<string> {
  const s3 = await getS3Client();
  const normalizedPath = normalizeFolderPath(folderPath);
  const key = buildS3Key(workspaceId, normalizedPath, filename);

  const buffer =
    typeof content === "string" ? Buffer.from(content, "utf-8") : content;

  await s3.PutObject({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  return key;
}

// Get document from S3
export async function getDocument(
  workspaceId: string,
  documentId: string,
  s3Key: string
): Promise<Buffer> {
  const s3 = await getS3Client();

  console.log(
    `[getDocument] Fetching from S3 - Bucket: ${BUCKET_NAME}, Key: ${s3Key}`
  );
  console.log(
    `[getDocument] Environment - ARC_ENV: ${process.env.ARC_ENV}, NODE_ENV: ${process.env.NODE_ENV}`
  );
  console.log(
    `[getDocument] Is local: ${
      process.env.ARC_ENV === "testing" || process.env.NODE_ENV !== "production"
    }`
  );

  const response = await s3.GetObject({
    Bucket: BUCKET_NAME,
    Key: s3Key,
  });

  if (response.Body instanceof Buffer) {
    return response.Body;
  }
  if (typeof response.Body === "string") {
    return Buffer.from(response.Body, "utf-8");
  }
  // Handle stream if needed
  const chunks: Uint8Array[] = [];
  if (
    response.Body &&
    typeof response.Body === "object" &&
    Symbol.asyncIterator in response.Body
  ) {
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
  }
  return Buffer.concat(chunks);
}

// Delete document from S3
export async function deleteDocument(
  workspaceId: string,
  documentId: string,
  s3Key: string
): Promise<void> {
  const s3 = await getS3Client();

  await s3.DeleteObject({
    Bucket: BUCKET_NAME,
    Key: s3Key,
  });
}

// Rename/move document in S3
export async function renameDocument(
  workspaceId: string,
  oldS3Key: string,
  newFilename: string,
  folderPath: string
): Promise<string> {
  const s3 = await getS3Client();
  const normalizedPath = normalizeFolderPath(folderPath);
  const newKey = buildS3Key(workspaceId, normalizedPath, newFilename);

  // Copy object to new location
  await s3.CopyObject({
    Bucket: BUCKET_NAME,
    CopySource: `${BUCKET_NAME}/${oldS3Key}`,
    Key: newKey,
  });

  // Delete old object
  await s3.DeleteObject({
    Bucket: BUCKET_NAME,
    Key: oldS3Key,
  });

  return newKey;
}
