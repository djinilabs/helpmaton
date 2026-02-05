import { forbidden, unauthorized } from "@hapi/boom";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

import { isUserAuthorized } from "../../tables/permissions";
import type { LambdaUrlEvent } from "../../utils/httpEventAdapter";
import { validateSecret } from "../../utils/streamServerUtils";
import { verifyAccessToken } from "../../utils/tokenUtils";

import type { EndpointType } from "./streamEndpointDetection";

/**
 * Authenticates request based on endpoint type
 * Test endpoint: JWT Bearer token authentication
 * Stream endpoint: Secret validation
 */
export async function authenticateStreamRequest(
  endpointType: EndpointType,
  event: LambdaUrlEvent | APIGatewayProxyEventV2,
  workspaceId: string,
  agentId: string,
  secret?: string
): Promise<{ authenticated: boolean; userId?: string }> {
  if (endpointType === "test" || endpointType === "config-test") {
    // Extract and verify JWT token
    const authHeader =
      event.headers["authorization"] || event.headers["Authorization"];
    if (!authHeader?.startsWith("Bearer ")) {
      throw unauthorized("Missing or invalid Authorization header");
    }
    const token = authHeader.substring(7);
    // Verify token
    const tokenPayload = await verifyAccessToken(token);

    // Verify workspace access (similar to Express middleware)
    const userRef = `users/${tokenPayload.userId}`;
    const resource = `workspaces/${workspaceId}`;
    const [authorized] = await isUserAuthorized(userRef, resource, 1); // READ permission

    if (!authorized) {
      throw forbidden("Insufficient permissions to access this workspace");
    }

    return { authenticated: true, userId: tokenPayload.userId };
  } else {
    // Validate secret
    if (!secret) {
      throw unauthorized("Missing secret");
    }
    const isValid = await validateSecret(workspaceId, agentId, secret);
    if (!isValid) {
      throw unauthorized("Invalid secret");
    }
    return { authenticated: true };
  }
}

