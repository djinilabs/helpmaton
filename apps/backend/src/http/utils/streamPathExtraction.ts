import type { APIGatewayProxyEventV2 } from "aws-lambda";

import {
  transformLambdaUrlToHttpV2Event,
  type LambdaUrlEvent,
} from "../../utils/httpEventAdapter";

import {
  detectEndpointType,
  type EndpointType,
  WORKSPACE_AGENT_ID,
} from "./streamEndpointDetection";

/**
 * Path parameters extracted from the request
 */
export interface PathParameters {
  workspaceId: string;
  agentId: string;
  secret?: string; // Optional for test endpoint
  endpointType: EndpointType;
}

/**
 * Extracts path parameters from the event (supports both Lambda Function URL and API Gateway)
 */
export function extractStreamPathParameters(
  event: LambdaUrlEvent | APIGatewayProxyEventV2,
): PathParameters | null {
  // Normalize to HTTP v2 event format
  // If event already has version "2.0", it's already an APIGatewayProxyEventV2, don't transform
  const httpV2Event =
    "version" in event && event.version === "2.0"
      ? (event as APIGatewayProxyEventV2)
      : "rawPath" in event && "requestContext" in event
        ? transformLambdaUrlToHttpV2Event(event as LambdaUrlEvent)
        : (event as APIGatewayProxyEventV2);

  let rawPath = httpV2Event.rawPath || "";

  // For API Gateway catchall routes, the path might be in pathParameters.proxy
  // Reconstruct the full path if rawPath is empty or doesn't start with /api/streams
  if (!rawPath || !rawPath.startsWith("/api/streams")) {
    const proxy = httpV2Event.pathParameters?.proxy;
    if (proxy) {
      // Reconstruct the full path: /api/streams/{proxy}
      rawPath = `/api/streams/${proxy}`;
    }
  }

  const normalizedPath = rawPath.replace(/^\/+/, "/");

  // Detect endpoint type
  const endpointType = detectEndpointType(normalizedPath);

  let workspaceId = httpV2Event.pathParameters?.workspaceId;
  let agentId = httpV2Event.pathParameters?.agentId;
  let secret: string | undefined;

  // Extract based on endpoint type
  if (endpointType === "config-test") {
    // Pattern: /api/streams/{workspaceId}/{agentId}/config/test
    const configTestMatch = normalizedPath.match(
      /^\/api\/streams\/([^/]+)\/([^/]+)\/config\/test$/,
    );
    if (configTestMatch) {
      workspaceId = configTestMatch[1];
      agentId = configTestMatch[2];
    }
  } else if (endpointType === "test") {
    // Pattern: /api/streams/{workspaceId}/workspace/test or /_workspace/test → agentId = _workspace
    const workspaceAgentMatch = normalizedPath.match(
      /^\/api\/streams\/([^/]+)\/(?:workspace|_workspace)\/test$/,
    );
    if (workspaceAgentMatch) {
      workspaceId = workspaceAgentMatch[1];
      agentId = WORKSPACE_AGENT_ID;
    } else {
      // Pattern: /api/streams/{workspaceId}/{agentId}/test
      const streamTestMatch = normalizedPath.match(
        /^\/api\/streams\/([^/]+)\/([^/]+)\/test$/,
      );
      if (streamTestMatch) {
        workspaceId = streamTestMatch[1];
        agentId = streamTestMatch[2];
      }
    }
  } else {
    // Pattern: /api/streams/{workspaceId}/{agentId}/{secret}
    // Secret can contain slashes, so we match everything after agentId
    secret = httpV2Event.pathParameters?.secret;
    if (!workspaceId || !agentId || !secret) {
      const streamMatch = normalizedPath.match(
        /^\/api\/streams\/([^/]+)\/([^/]+)\/(.+)$/,
      );
      if (streamMatch) {
        workspaceId = streamMatch[1];
        agentId = streamMatch[2];
        secret = streamMatch[3]; // This can contain slashes
      }
    }
  }

  if (!workspaceId || !agentId) {
    console.log("[Stream Handler] Path extraction failed:", {
      rawPath,
      normalizedPath,
      pathParameters: httpV2Event.pathParameters,
      endpointType,
    });
    return null;
  }

  // For stream endpoint, secret is required
  if (endpointType === "stream" && !secret) {
    console.log("[Stream Handler] Secret missing for stream endpoint:", {
      rawPath,
      normalizedPath,
      pathParameters: httpV2Event.pathParameters,
    });
    return null;
  }

  return { workspaceId, agentId, secret, endpointType };
}
