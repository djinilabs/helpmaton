import { getS3BucketName } from "./config";
import { TEMPORAL_GRAINS, type TemporalGrain } from "./types";

/**
 * Get the S3 path for a vector database
 * Format: vectordb/{agentId}/{temporalGrain}/
 * For working grain, no time component is used
 */
export function getDatabasePath(
  agentId: string,
  temporalGrain: TemporalGrain
): string {
  return `vectordb/${agentId}/${temporalGrain}/`;
}

/**
 * Get the S3 URI for a vector database
 * Format: s3://{bucket}/vectordb/{agentId}/{temporalGrain}/
 */
export function getDatabaseUri(
  agentId: string,
  temporalGrain: TemporalGrain
): string {
  const bucket = getS3BucketName();
  const path = getDatabasePath(agentId, temporalGrain);
  return `s3://${bucket}/${path}`;
}

/**
 * Get the message group ID for SQS FIFO queue
 * Format: {agentId}-{temporalGrain} or {workspaceId}-docs for docs grain
 * This ensures serialized processing per database
 * For docs grain, workspaceId should be provided and will be used instead of agentId
 */
export function getMessageGroupId(
  agentId: string,
  temporalGrain: TemporalGrain,
  workspaceId?: string
): string {
  // For docs grain, use workspaceId if provided (since docs are workspace-scoped)
  if (temporalGrain === "docs" && workspaceId) {
    return `${workspaceId}-${temporalGrain}`;
  }
  return `${agentId}-${temporalGrain}`;
}

/**
 * Get all database paths for an agent (all temporal grains)
 * Useful for agent removal operations
 */
export function getAllAgentDatabasePaths(agentId: string): string[] {
  return TEMPORAL_GRAINS.map((grain) => getDatabasePath(agentId, grain));
}

/**
 * Get all database URIs for an agent (all temporal grains)
 */
export function getAllAgentDatabaseUris(agentId: string): string[] {
  return TEMPORAL_GRAINS.map((grain) => getDatabaseUri(agentId, grain));
}
