import { randomBytes } from "crypto";

import { database } from "../tables";
import type { AgentStreamServerRecord } from "../tables/schema";

/**
 * Generates a secure random secret using crypto.randomBytes
 * @returns Base64-encoded secret (32 bytes = 44 characters in base64)
 */
export function generateSecret(): string {
  return randomBytes(32).toString("base64");
}

/**
 * Validates secret from database
 * @param workspaceId - Workspace ID
 * @param agentId - Agent ID
 * @param secret - Secret to validate
 * @returns true if secret is valid, false otherwise
 */
export async function validateSecret(
  workspaceId: string,
  agentId: string,
  secret: string
): Promise<boolean> {
  const db = await database();
  const pk = `stream-servers/${workspaceId}/${agentId}`;
  const config = await db["agent-stream-servers"].get(pk, "config");

  if (!config) {
    return false;
  }

  return config.secret === secret;
}

/**
 * Retrieves allowed origins from database
 * @param workspaceId - Workspace ID
 * @param agentId - Agent ID
 * @returns Array of allowed origins or null if not found
 */
export async function getAllowedOrigins(
  workspaceId: string,
  agentId: string
): Promise<string[] | null> {
  const db = await database();
  const pk = `stream-servers/${workspaceId}/${agentId}`;
  const config = await db["agent-stream-servers"].get(pk, "config");

  if (!config) {
    return null;
  }

  return config.allowedOrigins;
}

/**
 * Gets full stream server configuration including secret
 * @param workspaceId - Workspace ID
 * @param agentId - Agent ID
 * @returns Configuration or null if not found
 */
export async function getStreamServerConfig(
  workspaceId: string,
  agentId: string
): Promise<AgentStreamServerRecord | null> {
  const db = await database();
  const pk = `stream-servers/${workspaceId}/${agentId}`;
  const config = await db["agent-stream-servers"].get(pk, "config");

  return config || null;
}

/**
 * Creates stream server configuration in database
 * @param workspaceId - Workspace ID
 * @param agentId - Agent ID
 * @param allowedOrigins - Array of allowed origins (or ["*"] for wildcard)
 * @returns Created configuration
 */
export async function createStreamServerConfig(
  workspaceId: string,
  agentId: string,
  allowedOrigins: string[]
): Promise<AgentStreamServerRecord> {
  const db = await database();
  const pk = `stream-servers/${workspaceId}/${agentId}`;
  const secret = generateSecret();

  const config = await db["agent-stream-servers"].create({
    pk,
    sk: "config",
    workspaceId,
    agentId,
    secret,
    allowedOrigins,
  });

  return config;
}

/**
 * Updates allowed origins in database
 * @param workspaceId - Workspace ID
 * @param agentId - Agent ID
 * @param allowedOrigins - New array of allowed origins
 * @returns Updated configuration
 */
export async function updateStreamServerConfig(
  workspaceId: string,
  agentId: string,
  allowedOrigins: string[]
): Promise<AgentStreamServerRecord> {
  const db = await database();
  const pk = `stream-servers/${workspaceId}/${agentId}`;

  const config = await db["agent-stream-servers"].update({
    pk,
    sk: "config",
    allowedOrigins,
  });

  return config;
}

/**
 * Deletes stream server configuration from database
 * @param workspaceId - Workspace ID
 * @param agentId - Agent ID
 */
export async function deleteStreamServerConfig(
  workspaceId: string,
  agentId: string
): Promise<void> {
  const db = await database();
  const pk = `stream-servers/${workspaceId}/${agentId}`;

  await db["agent-stream-servers"].delete(pk, "config");
}

