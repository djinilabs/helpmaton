import { randomUUID } from "crypto";

import { getSession as getExpressSession } from "@auth/express";
import { unauthorized } from "@hapi/boom";
import { APIGatewayProxyEventV2 } from "aws-lambda";
import { Request } from "express";

import { authConfig } from "../../auth-config";
import { getDefined } from "../../utils";

const eventToRequest = (event: APIGatewayProxyEventV2): Request => {
  const headers = new Headers(
    Object.fromEntries(
      Object.entries(event.headers).filter(([, v]) => v !== undefined)
    ) as Record<string, string>
  );
  if (event.cookies?.length) {
    headers.set("cookie", event.cookies.join("; "));
  }
  headers.set("accept", "application/json");

  // Ensure host is set - use event.headers.host or fallback to a default
  const host = event.headers.host || "localhost:3333";
  // Protocol should be "http" or "https", not extracted from host
  // For production domains, assume https; for localhost, use http
  const protocol =
    host.includes("localhost") || host.includes("127.0.0.1") ? "http" : "https";

  // CRITICAL: Ensure host header is set in headers object
  // @auth/express's createActionURL uses req.headers.host to construct the URL
  if (!headers.has("host")) {
    headers.set("host", host);
  }

  // Construct full URL for the request
  // @auth/express needs the full URL to make internal requests
  const fullUrl = `${protocol}://${host}/api/auth/session`;

  // Convert Headers to plain object for Express Request
  const headersObj = Object.fromEntries(headers.entries());

  console.log(
    `[eventToRequest] Creating request - protocol: ${protocol}, host: ${host}, fullUrl: ${fullUrl}, hasCookie: ${headers.has(
      "cookie"
    )}, cookieValue: ${headers.get("cookie")?.substring(0, 50) || "none"}...`
  );

  return {
    protocol: getDefined(protocol, "Protocol could not be determined"),
    url: fullUrl,
    originalUrl: fullUrl,
    method: "GET",
    headers: headersObj,
    cookies: event.cookies,
    get: (name: string) => headers.get(name.toLowerCase()) || undefined,
  } as Request;
};

/**
 * Get session from API Gateway event
 * @param event - API Gateway event
 * @returns Session object or null if not authenticated
 */
export const getSession = async (event: APIGatewayProxyEventV2) => {
  const request = eventToRequest(event);
  return getExpressSession(request, await authConfig());
};

/**
 * Reconstruct API Gateway event from Express Request
 * @param req - Express Request object
 * @returns Reconstructed API Gateway event
 */
const reconstructEventFromRequest = (req: Request): APIGatewayProxyEventV2 => {
  // Extract cookies from request
  const cookies: string[] = [];
  if (req.headers.cookie) {
    const cookieHeader = Array.isArray(req.headers.cookie)
      ? req.headers.cookie.join("; ")
      : req.headers.cookie;
    cookies.push(
      ...cookieHeader
        .split(";")
        .map((c) => c.trim())
        .filter((c) => c.length > 0)
    );
  }

  // Build headers object (normalize to lowercase keys as API Gateway does)
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      headers[key.toLowerCase()] = Array.isArray(value)
        ? value.join(", ")
        : String(value);
    }
  }

  // Ensure host header exists
  if (!headers.host && req.get("host")) {
    headers.host = req.get("host") || "";
  }

  // Reconstruct the API Gateway event
  const event: APIGatewayProxyEventV2 = {
    version: "2.0",
    routeKey: `${req.method} ${req.path}`,
    rawPath: req.path,
    rawQueryString: req.url.split("?")[1] || "",
    headers,
    requestContext: {
      accountId: "local",
      apiId: "local",
      domainName: headers.host || "localhost",
      domainPrefix: "local",
      http: {
        method: req.method,
        path: req.path,
        protocol: req.protocol === "https" ? "HTTP/1.1" : "HTTP/1.1",
        sourceIp: req.ip || "127.0.0.1",
        userAgent: headers["user-agent"] || "",
      },
      requestId: randomUUID(),
      routeKey: `${req.method} ${req.path}`,
      stage: "local",
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    isBase64Encoded: false,
    cookies: cookies.length > 0 ? cookies : undefined,
    body: req.body ? JSON.stringify(req.body) : undefined,
  };

  return event;
};

/**
 * Get session from Express Request (extracts event from request)
 * @param req - Express Request object
 * @returns Session object or null if not authenticated
 */
export const getSessionFromRequest = async (req: Request) => {
  // serverless-express attaches the event to req.apiGateway.event
  let event = req.apiGateway?.event;
  if (!event) {
    // Reconstruct event from request if not available
    // This is a fallback for cases where event is not attached
    event = reconstructEventFromRequest(req);
  }
  return getSession(event);
};

/**
 * Require session - throws unauthorized if not authenticated
 * @param event - API Gateway event
 * @returns Session object
 * @throws unauthorized error if not authenticated
 */
export const requireSession = async (event: APIGatewayProxyEventV2) => {
  const session = await getSession(event);
  if (!session) {
    throw unauthorized();
  }
  return session;
};

/**
 * Require session from Express Request - throws unauthorized if not authenticated
 * @param req - Express Request object
 * @returns Session object
 * @throws unauthorized error if not authenticated
 */
export const requireSessionFromRequest = async (req: Request) => {
  const session = await getSessionFromRequest(req);
  if (!session) {
    throw unauthorized();
  }
  return session;
};

/**
 * Convert user ID to resource reference format
 * @param userId - User ID from session
 * @returns Resource reference (e.g., "users/{userId}")
 */
export const userRef = (userId: string): string => {
  return `users/${userId}`;
};

/**
 * Extract user ID from request object
 * Supports both Express Request with userRef/session and plain objects
 * @param req - Request object with userRef or session
 * @returns User ID or undefined if not available
 */
export function extractUserId(req: {
  userRef?: string;
  session?: { user?: { id?: string } };
}): string | undefined {
  if (req.userRef) {
    return req.userRef.replace("users/", "");
  }
  if (req.session?.user?.id) {
    return req.session.user.id;
  }
  return undefined;
}
