import { createHash } from "crypto";

import { unauthorized } from "@hapi/boom";
import express from "express";
import { jwtDecrypt } from "jose";

/**
 * Get JWT secret key from environment
 * Derives a 256-bit key from AUTH_SECRET using SHA-256 for A256GCM encryption
 */
export function getJwtSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is required");
  }
  // Derive a 256-bit key from the secret using SHA-256
  // A256GCM requires exactly 32 bytes (256 bits)
  const keyMaterial = Buffer.from(secret, "utf-8");
  const derivedKey = createHash("sha256").update(keyMaterial).digest();
  return new Uint8Array(derivedKey);
}

/**
 * Extract and validate encrypted JWT from Authorization header
 * Returns workspaceId, agentId, and conversationId from the token payload
 */
export async function extractWorkspaceContextFromToken(
  req: express.Request
): Promise<{
  workspaceId: string;
  agentId: string;
  conversationId: string;
}> {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || typeof authHeader !== "string") {
    throw unauthorized("Authorization header with Bearer token is required");
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw unauthorized(
      "Invalid Authorization header format. Expected: Bearer <token>"
    );
  }

  const encryptedToken = match[1];
  const secret = getJwtSecret();

  try {
    const { payload } = await jwtDecrypt(encryptedToken, secret, {
      issuer: "helpmaton",
      audience: "helpmaton-api",
    });

    // Extract required fields from payload
    const workspaceId = payload.workspaceId;
    const agentId = payload.agentId;
    const conversationId = payload.conversationId;

    if (
      typeof workspaceId !== "string" ||
      typeof agentId !== "string" ||
      typeof conversationId !== "string"
    ) {
      throw unauthorized(
        "Token payload must contain workspaceId, agentId, and conversationId as strings"
      );
    }

    return { workspaceId, agentId, conversationId };
  } catch (error) {
    console.error("[jwt-utils] Error decrypting JWT token:", error);
    if (error && typeof error === "object" && "isBoom" in error) {
      throw error;
    }
    throw unauthorized("Invalid or expired encrypted token");
  }
}

