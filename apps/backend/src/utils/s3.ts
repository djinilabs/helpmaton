import { randomBytes, randomUUID } from "crypto";

import awsLite from "@aws-lite/client";
import s3Plugin from "@aws-lite/s3";
import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";

// Use bucket name with period to force path-style addressing for local S3 servers
const BUCKET_NAME = (
  process.env.HELPMATON_S3_BUCKET || "workspace.documents"
).trim();

// Get S3 client configuration
export async function getS3Client() {
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

/**
 * Generate a high-entropy filename for conversation files
 * Uses randomUUID() + randomBytes() for unguessable filenames
 */
function generateHighEntropyFilename(fileExtension?: string): string {
  const uuid = randomUUID();
  const additionalEntropy = randomBytes(16).toString("hex");
  const baseFilename = `${uuid}-${additionalEntropy}`;

  if (fileExtension) {
    // Ensure extension starts with a dot
    const ext = fileExtension.startsWith(".")
      ? fileExtension
      : `.${fileExtension}`;
    return `${baseFilename}${ext}`;
  }

  return baseFilename;
}

/**
 * Build S3 key for conversation files with nested path structure
 */
function buildConversationFileKey(
  workspaceId: string,
  agentId: string,
  conversationId: string,
  filename: string
): string {
  return `conversation-files/${workspaceId}/${agentId}/${conversationId}/${filename}`;
}

/**
 * Get AWS SDK v3 S3 client for presigned URL generation
 * Uses AWS SDK v3 for presigned POST URL support
 */
function getAwsSdkS3Client(): S3Client {
  const arcEnv = process.env.ARC_ENV;
  const nodeEnv = process.env.NODE_ENV;
  const isLocal =
    arcEnv === "testing" ||
    (arcEnv !== "production" && nodeEnv !== "production");

  const config: {
    endpoint?: string;
    credentials?: {
      accessKeyId: string;
      secretAccessKey: string;
    };
    region?: string;
    forcePathStyle?: boolean;
  } = {};

  if (isLocal) {
    // Local development with s3rver
    const endpoint =
      process.env.HELPMATON_S3_ENDPOINT || "http://localhost:4568";
    config.endpoint = endpoint;
    config.credentials = {
      accessKeyId: "S3RVER",
      secretAccessKey: "S3RVER",
    };
    config.region = "us-east-1";
    config.forcePathStyle = true; // Force path-style for local S3
  } else {
    // Production - use explicit credentials from environment variables
    const region =
      process.env.HELPMATON_S3_REGION || process.env.AWS_REGION || "eu-west-2";
    config.region = region;

    // Use S3-specific credentials if provided, otherwise fall back to standard AWS credentials
    const accessKeyId =
      process.env.HELPMATON_S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey =
      process.env.HELPMATON_S3_SECRET_ACCESS_KEY ||
      process.env.AWS_SECRET_ACCESS_KEY;

    if (accessKeyId && secretAccessKey) {
      config.credentials = {
        accessKeyId,
        secretAccessKey,
      };
    }
  }

  return new S3Client(config);
}

/**
 * Generate a presigned POST URL for uploading conversation files to S3
 * @param workspaceId - Workspace ID
 * @param agentId - Agent ID
 * @param conversationId - Conversation ID
 * @param contentType - File content type (e.g., "image/jpeg", "application/pdf")
 * @param fileExtension - Optional file extension (e.g., "jpg", "pdf")
 * @param expiresIn - URL expiration time in seconds (default: 300 = 5 minutes)
 * @param maxFileSize - Maximum file size in bytes (default: 10MB)
 * @returns Presigned POST URL data including upload URL, form fields, and final S3 URL
 */
export async function generatePresignedPostUrl(
  workspaceId: string,
  agentId: string,
  conversationId: string,
  contentType: string,
  fileExtension?: string,
  expiresIn: number = 300,
  maxFileSize: number = 10 * 1024 * 1024 // 10MB
): Promise<{
  uploadUrl: string;
  fields: Record<string, string>;
  finalUrl: string;
  expiresIn: number;
}> {
  // Generate high-entropy filename
  const filename = generateHighEntropyFilename(fileExtension);
  const key = buildConversationFileKey(
    workspaceId,
    agentId,
    conversationId,
    filename
  );

  // Get AWS SDK v3 S3 client
  const s3Client = getAwsSdkS3Client();

  // Generate presigned POST URL using AWS SDK v3
  // Note: We do NOT include ACL here because BlockPublicAcls is enabled on the bucket.
  // Public read access is granted via bucket policy instead (see s3/index.js).
  // Attempting to set ACL when BlockPublicAcls is true will cause "Access Denied" errors.
  const presignedPost = await createPresignedPost(s3Client, {
    Bucket: BUCKET_NAME,
    Key: key,
    Fields: {
      "Content-Type": contentType,
    },
    Conditions: [
      ["content-length-range", 0, maxFileSize], // Max file size
      ["eq", "$Content-Type", contentType], // Exact content type match
      ["eq", "$key", key], // Exact key match
    ],
    Expires: expiresIn,
  });

  // Construct final S3 URL
  // For local S3, use the endpoint directly
  // For production, construct the S3 URL
  const arcEnv = process.env.ARC_ENV;
  const nodeEnv = process.env.NODE_ENV;
  const isLocal =
    arcEnv === "testing" ||
    (arcEnv !== "production" && nodeEnv !== "production");

  let finalUrl: string;
  if (isLocal) {
    const endpoint =
      process.env.HELPMATON_S3_ENDPOINT || "http://localhost:4568";
    finalUrl = `${endpoint}/${BUCKET_NAME}/${key}`;
  } else {
    const region =
      process.env.HELPMATON_S3_REGION || process.env.AWS_REGION || "eu-west-2";
    // Use path-style URL (bucket name with dots forces path-style)
    finalUrl = `https://s3.${region}.amazonaws.com/${BUCKET_NAME}/${key}`;
  }

  return {
    uploadUrl: presignedPost.url,
    fields: presignedPost.fields,
    finalUrl,
    expiresIn,
  };
}

/**
 * Upload a conversation file from a buffer (for AI-generated files)
 * Uses the same path structure and high-entropy filenames as user-uploaded files
 * @param workspaceId - Workspace ID
 * @param agentId - Agent ID
 * @param conversationId - Conversation ID
 * @param buffer - File content as Buffer or Uint8Array
 * @param mediaType - MIME type (e.g., "image/png", "application/pdf")
 * @returns Public S3 URL for the uploaded file
 */
export async function uploadConversationFileFromBuffer(
  workspaceId: string,
  agentId: string,
  conversationId: string,
  buffer: Buffer | Uint8Array,
  mediaType: string
): Promise<string> {
  // Extract file extension from mediaType
  // e.g., "image/png" -> "png", "application/pdf" -> "pdf"
  let fileExtension: string | undefined;
  const mediaTypeParts = mediaType.split("/");
  if (mediaTypeParts.length === 2) {
    const subtype = mediaTypeParts[1];
    // Handle common cases where extension might differ from subtype
    // e.g., "jpeg" -> "jpg"
    if (subtype === "jpeg") {
      fileExtension = "jpg";
    } else if (subtype && subtype.length <= 5) {
      // Only use as extension if it's short and looks like a file extension
      fileExtension = subtype;
    }
  }

  // Generate high-entropy filename
  const filename = generateHighEntropyFilename(fileExtension);
  const key = buildConversationFileKey(
    workspaceId,
    agentId,
    conversationId,
    filename
  );

  // Get S3 client
  const s3 = await getS3Client();

  // Convert Uint8Array to Buffer if needed
  const bufferData =
    buffer instanceof Buffer ? buffer : Buffer.from(buffer);

  // Upload to S3
  // Public read access is granted via bucket policy (see s3/index.js)
  await s3.PutObject({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: bufferData,
    ContentType: mediaType,
  });

  // Construct and return the public S3 URL
  const arcEnv = process.env.ARC_ENV;
  const nodeEnv = process.env.NODE_ENV;
  const isLocal =
    arcEnv === "testing" ||
    (arcEnv !== "production" && nodeEnv !== "production");

  if (isLocal) {
    const endpoint =
      process.env.HELPMATON_S3_ENDPOINT || "http://localhost:4568";
    return `${endpoint}/${BUCKET_NAME}/${key}`;
  } else {
    const region =
      process.env.HELPMATON_S3_REGION || process.env.AWS_REGION || "eu-west-2";
    // Use path-style URL (bucket name with dots forces path-style)
    return `https://s3.${region}.amazonaws.com/${BUCKET_NAME}/${key}`;
  }
}
