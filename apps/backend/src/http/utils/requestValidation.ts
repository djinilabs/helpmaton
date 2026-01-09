import { badRequest, forbidden, unauthorized } from "@hapi/boom";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

import { database } from "../../tables";
import { isUserAuthorized } from "../../tables/permissions";
import { PERMISSION_LEVELS } from "../../tables/schema";
import type { RequestParams } from "../../utils/messageTypes";

import { requireSession, userRef } from "./session";


/**
 * Extracts path parameters from rawPath when pathParameters is not available
 * (e.g., when using Lambda URLs with HTTP_PROXY integration)
 */
function extractPathParametersFromRawPath(rawPath: string): {
  workspaceId?: string;
  agentId?: string;
} {
  if (!rawPath) {
    return {};
  }

  // Remove query parameters if present
  const pathWithoutQuery = rawPath.split("?")[0];

  // Pattern: /api/workspaces/:workspaceId/agents/:agentId/test
  // Also handle optional trailing slash
  const match = pathWithoutQuery.match(
    /^\/api\/workspaces\/([^/]+)\/agents\/([^/]+)\/test\/?$/
  );
  if (match) {
    return {
      workspaceId: match[1],
      agentId: match[2],
    };
  }
  return {};
}

/**
 * Validates HTTP method and extracts/validates path parameters and request body
 */
export function validateRequest(event: APIGatewayProxyEventV2): RequestParams {
  // Validate HTTP method
  if (event.requestContext.http.method !== "POST") {
    throw badRequest("Method not allowed");
  }

  // Extract and validate path parameters
  // When using Lambda URLs with HTTP_PROXY, pathParameters may not be populated
  // so we fall back to extracting from rawPath
  let workspaceId = event.pathParameters?.workspaceId;
  let agentId = event.pathParameters?.agentId;

  if (!workspaceId || !agentId) {
    // Try multiple possible path locations in the event
    // When HTTP_PROXY forwards to Lambda URL, the path might be in different places
    const possiblePaths = [
      event.rawPath,
      event.requestContext?.http?.path,
      event.routeKey?.split(" ")[1], // routeKey format: "POST /path"
      // Check headers for forwarded path (HTTP_PROXY might include it)
      event.headers?.["x-forwarded-path"],
      event.headers?.["x-original-path"],
      event.headers?.["x-path"],
      // Lambda Function URL events might have path in different location
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (event as any).path,
    ].filter(Boolean) as string[];

    console.log(
      "[validateRequest] Path parameters missing, attempting extraction:",
      {
        pathParameters: event.pathParameters,
        possiblePaths,
        headers: Object.keys(event.headers || {}),
        fullEvent: JSON.stringify(event, null, 2),
      }
    );

    // Try each possible path until we find one that works
    for (const path of possiblePaths) {
      if (!path || path === "/") {
        continue; // Skip empty or root paths
      }
      const extracted = extractPathParametersFromRawPath(path);
      if (extracted.workspaceId && extracted.agentId) {
        workspaceId = extracted.workspaceId;
        agentId = extracted.agentId;
        console.log(
          "[validateRequest] Successfully extracted from path:",
          path,
          {
            workspaceId,
            agentId,
          }
        );
        break;
      }
    }
  }

  if (!workspaceId || !agentId) {
    // Include event structure in error for debugging
    const errorDetails = {
      rawPath: event.rawPath,
      path: event.requestContext?.http?.path,
      routeKey: event.routeKey,
      pathParameters: event.pathParameters,
      headers: Object.keys(event.headers || {}),
      fullEventKeys: Object.keys(event),
      // Include a sample of the event structure (truncated)
      eventSample: JSON.stringify(
        {
          rawPath: event.rawPath,
          path: event.requestContext?.http?.path,
          routeKey: event.routeKey,
          pathParameters: event.pathParameters,
          headers: event.headers,
        },
        null,
        2
      ),
    };

    console.error(
      "[validateRequest] Failed to extract path parameters:",
      errorDetails
    );

    // Throw error with details that will be visible in the response
    const error = badRequest(
      "workspaceId and agentId are required in the URL path"
    );
    // Attach debug info to error output for troubleshooting
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (error.output.payload as any).debug = errorDetails;
    throw error;
  }

  // Parse and validate request body
  let messages: unknown[] = [];
  let conversationId: string | undefined;
  if (event.body) {
    const bodyText = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString()
      : event.body;
    const body = JSON.parse(bodyText) as {
      messages?: unknown[];
      conversationId?: string;
    };
    messages = body.messages || [];
    conversationId = body.conversationId;
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    throw badRequest("messages array is required");
  }

  return { workspaceId, agentId, messages, conversationId };
}

/**
 * Authenticates user and checks workspace permissions
 */
export async function authenticateAndAuthorize(
  event: APIGatewayProxyEventV2,
  workspaceId: string
): Promise<string> {
  const session = await requireSession(event);
  if (!session.user?.id) {
    throw unauthorized();
  }

  const currentUserRef = userRef(session.user.id);
  const resource = `workspaces/${workspaceId}`;
  const [authorized] = await isUserAuthorized(
    currentUserRef,
    resource,
    PERMISSION_LEVELS.READ
  );

  if (!authorized) {
    throw forbidden(
      `Insufficient permissions. Required level: ${PERMISSION_LEVELS.READ}`
    );
  }

  return currentUserRef;
}

/**
 * Extracts webhook path parameters from rawPath when pathParameters is not available
 * Pattern: /api/webhook/:workspaceId/:agentId/:key
 */
function extractWebhookPathParametersFromRawPath(rawPath: string): {
  workspaceId?: string;
  agentId?: string;
  key?: string;
} {
  if (!rawPath) {
    return {};
  }

  // Remove query parameters if present
  const pathWithoutQuery = rawPath.split("?")[0];

  // Pattern: /api/webhook/:workspaceId/:agentId/:key
  // Also handle optional trailing slash
  const match = pathWithoutQuery.match(
    /^\/api\/webhook\/([^/]+)\/([^/]+)\/([^/]+)\/?$/
  );
  if (match) {
    return {
      workspaceId: match[1],
      agentId: match[2],
      key: match[3],
    };
  }
  return {};
}

/**
 * Validates webhook request: extracts and validates path parameters and body text
 */
export function validateWebhookRequest(event: APIGatewayProxyEventV2): {
  workspaceId: string;
  agentId: string;
  key: string;
  bodyText: string;
} {
  // Validate HTTP method
  if (event.requestContext.http.method !== "POST") {
    throw badRequest("Method not allowed");
  }

  // Extract and validate path parameters
  // When using Lambda URLs with HTTP_PROXY, pathParameters may not be populated
  // so we fall back to extracting from rawPath
  let workspaceId = event.pathParameters?.workspaceId;
  let agentId = event.pathParameters?.agentId;
  let key = event.pathParameters?.key;

  if (!workspaceId || !agentId || !key) {
    // Try multiple possible path locations in the event
    const possiblePaths = [
      event.rawPath,
      event.requestContext?.http?.path,
      event.routeKey?.split(" ")[1], // routeKey format: "POST /path"
    ].filter(Boolean) as string[];

    console.log(
      "[validateWebhookRequest] Path parameters missing, attempting extraction:",
      {
        pathParameters: event.pathParameters,
        possiblePaths,
        fullEvent: JSON.stringify(event, null, 2),
      }
    );

    // Try each possible path until we find one that works
    for (const path of possiblePaths) {
      const extracted = extractWebhookPathParametersFromRawPath(path);
      if (extracted.workspaceId && extracted.agentId && extracted.key) {
        workspaceId = extracted.workspaceId;
        agentId = extracted.agentId;
        key = extracted.key;
        console.log(
          "[validateWebhookRequest] Successfully extracted from path:",
          path,
          {
            workspaceId,
            agentId,
            key,
          }
        );
        break;
      }
    }
  }

  if (!workspaceId || !agentId || !key) {
    console.error(
      "[validateWebhookRequest] Failed to extract path parameters:",
      {
        rawPath: event.rawPath,
        path: event.requestContext?.http?.path,
        routeKey: event.routeKey,
        pathParameters: event.pathParameters,
        fullEventKeys: Object.keys(event),
      }
    );
    throw badRequest(
      "workspaceId, agentId, and key are required in the URL path"
    );
  }

  // Extract request body as free-form text
  let bodyText = "";
  if (event.body) {
    const decodedBody = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString()
      : event.body;
    bodyText = decodedBody.trim();
  }

  if (!bodyText) {
    throw badRequest("Request body is required");
  }

  return { workspaceId, agentId, key, bodyText };
}

/**
 * Validates webhook key against the database
 */
export async function validateWebhookKey(
  workspaceId: string,
  agentId: string,
  key: string
): Promise<void> {
  const db = await database();

  // Query agent-key table by agentId using GSI
  const keysQuery = await db["agent-key"].query({
    IndexName: "byAgentId",
    KeyConditionExpression: "agentId = :agentId",
    ExpressionAttributeValues: {
      ":agentId": agentId,
    },
  });

  const agentKey = keysQuery.items.find(
    (k) =>
      k.key === key &&
      k.workspaceId === workspaceId &&
      (k.type === "webhook" || !k.type) // Default to webhook if type not set (backward compatibility)
  );

  if (!agentKey) {
    throw unauthorized("Invalid webhook key");
  }
}

/**
 * Validates widget key against the database
 */
export async function validateWidgetKey(
  workspaceId: string,
  agentId: string,
  key: string
): Promise<void> {
  const db = await database();

  // Query agent-key table by agentId using GSI
  const keysQuery = await db["agent-key"].query({
    IndexName: "byAgentId",
    KeyConditionExpression: "agentId = :agentId",
    ExpressionAttributeValues: {
      ":agentId": agentId,
    },
  });

  const agentKey = keysQuery.items.find(
    (k) =>
      k.key === key &&
      k.workspaceId === workspaceId &&
      k.type === "widget"
  );

  if (!agentKey) {
    throw unauthorized("Invalid widget key");
  }
}
