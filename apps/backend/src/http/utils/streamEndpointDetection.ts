import type { APIGatewayProxyEvent, APIGatewayProxyEventV2 } from "aws-lambda";

import {
  transformLambdaUrlToHttpV2Event,
  transformRestToHttpV2Event,
  type LambdaUrlEvent,
} from "../../utils/httpEventAdapter";

/**
 * Endpoint type: test (JWT auth), config-test (meta-agent, JWT auth), or stream (secret auth)
 */
export type EndpointType = "test" | "config-test" | "stream";

/** Reserved agentId for the virtual workspace agent */
export const WORKSPACE_AGENT_ID = "_workspace";

/**
 * Detects endpoint type based on path pattern
 */
export function detectEndpointType(path: string): EndpointType {
  // Pattern: /api/streams/{workspaceId}/{agentId}/config/test (meta-agent direct chat)
  if (path.match(/^\/api\/streams\/[^/]+\/[^/]+\/config\/test$/)) {
    return "config-test";
  }
  // Pattern: /api/streams/{workspaceId}/workspace/test or /api/streams/{workspaceId}/_workspace/test
  if (path.match(/^\/api\/streams\/[^/]+\/(?:workspace|_workspace)\/test$/)) {
    return "test"; // workspace agent uses test auth
  }
  // Pattern: /api/streams/{workspaceId}/{agentId}/test
  if (path.match(/^\/api\/streams\/[^/]+\/[^/]+\/test$/)) {
    return "test";
  }
  // Pattern: /api/streams/{workspaceId}/{agentId}/{secret}
  return "stream";
}

/**
 * Extracts the path from an event (handles multiple event types)
 */
export function extractPathFromEvent(
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2 | LambdaUrlEvent,
): string {
  // Transform REST API v1 events to v2 format if needed
  if ("httpMethod" in event && event.httpMethod !== undefined) {
    // API Gateway REST API v1 event - transform it to v2 format
    const httpV2Event = transformRestToHttpV2Event(
      event as APIGatewayProxyEvent,
    );
    return httpV2Event.rawPath || httpV2Event.requestContext.http.path || "";
  }

  // For Lambda Function URL events, transform to get the path
  // But only if requestContext.http exists (Lambda Function URL events have this)
  if (
    "rawPath" in event &&
    "requestContext" in event &&
    (event as { requestContext?: { http?: unknown } }).requestContext?.http
  ) {
    const httpV2Event = transformLambdaUrlToHttpV2Event(
      event as LambdaUrlEvent,
    );
    return httpV2Event.rawPath || "";
  }

  // For API Gateway v2 events, use rawPath directly
  if ("rawPath" in event && "version" in event) {
    return (event as unknown as APIGatewayProxyEventV2).rawPath || "";
  }

  // Fallback: try to get path from requestContext
  const eventAny = event as { requestContext?: { http?: { path?: string } } };
  return eventAny.requestContext?.http?.path || "";
}
