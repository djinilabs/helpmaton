import type { APIGatewayProxyResultV2 } from "aws-lambda";

import type { EndpointType } from "./streamEndpointDetection";

const DEFAULT_CONTENT_TYPE = "text/event-stream; charset=utf-8";

/**
 * Computes CORS headers based on endpoint type and allowed origins
 */
export function computeCorsHeaders(
  endpointType: EndpointType,
  origin: string | undefined,
  allowedOrigins: string[] | null
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type":
      endpointType === "url"
        ? "application/json"
        : DEFAULT_CONTENT_TYPE,
  };

  if (endpointType === "test") {
    // Test endpoint: Always use FRONTEND_URL
    const frontendUrl = process.env.FRONTEND_URL;
    headers["Access-Control-Allow-Origin"] = frontendUrl || "*";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] =
      "Content-Type, Authorization, X-Requested-With, Origin, Accept, X-Conversation-Id";
    if (frontendUrl) {
      headers["Access-Control-Allow-Credentials"] = "true";
    }
    return headers;
  }

  if (endpointType === "url") {
    // URL endpoint: Use FRONTEND_URL for CORS
    const frontendUrl = process.env.FRONTEND_URL;
    headers["Access-Control-Allow-Origin"] = frontendUrl || "*";
    headers["Access-Control-Allow-Methods"] = "GET, OPTIONS";
    headers["Access-Control-Allow-Headers"] =
      "Content-Type, Authorization, X-Requested-With, Origin, Accept";
    if (frontendUrl) {
      headers["Access-Control-Allow-Credentials"] = "true";
    }
    return headers;
  }

  // Stream endpoint: Use agent streaming server configuration
  if (!allowedOrigins || allowedOrigins.length === 0) {
    // No CORS configuration - allow all origins (default permissive behavior)
    headers["Access-Control-Allow-Origin"] = "*";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] =
      "Content-Type, Authorization, X-Requested-With, Origin, Accept, X-Conversation-Id";
    return headers;
  }

  // Check if wildcard is allowed
  if (allowedOrigins.includes("*")) {
    headers["Access-Control-Allow-Origin"] = "*";
  } else if (origin && allowedOrigins.includes(origin)) {
    // Only allow if origin is explicitly in the allowed list
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  // If origin doesn't match and no wildcard, no Access-Control-Allow-Origin header is set
  // This will cause the browser to reject the CORS request

  headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
  headers["Access-Control-Allow-Headers"] =
    "Content-Type, Authorization, X-Requested-With, Origin, Accept, X-Conversation-Id";

  console.log("[Stream Handler] Response headers:", headers);
  return headers;
}

/**
 * Handles OPTIONS preflight request
 */
export function handleOptionsRequest(
  headers: Record<string, string>
): APIGatewayProxyResultV2 {
  return {
    statusCode: 200,
    headers,
    body: "",
  };
}

