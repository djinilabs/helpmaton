import { badRequest, boomify, forbidden, unauthorized } from "@hapi/boom";
import express from "express";

import { isUserAuthorized } from "../../tables/permissions";
import { ensureError } from "../../utils/sentry";
import { verifyAccessToken } from "../../utils/tokenUtils";
import { requireSessionFromRequest, userRef } from "../utils/session";

/**
 * Helper to handle errors: boomify, log, then pass to next
 */
export const handleError = (
  error: unknown,
  next: express.NextFunction,
  context?: string
) => {
  // First, boomify the error
  const boomError = boomify(ensureError(error));

  // Then, log the error
  const logContext = context ? `[${context}]` : "";
  console.error(`${logContext} Error caught:`, {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    boom: {
      statusCode: boomError.output.statusCode,
      message: boomError.message,
      isServer: boomError.isServer,
    },
  });

  if (boomError.isServer) {
    console.error(`${logContext} Server error details:`, boomError);
  } else {
    console.warn(`${logContext} Client error:`, boomError);
  }

  // Finally, pass to next in the chain
  next(boomError);
};

/**
 * Helper to wrap async route handlers and pass errors to error handler
 */
export const asyncHandler = (
  fn: (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => Promise<unknown>
) => {
  return (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      handleError(error, next, "asyncHandler");
    });
  };
};

/**
 * Extract Bearer token from Authorization header
 * Checks multiple sources: req.headers, req.apiGateway.event.headers
 * Handles case variations robustly
 * @param req - Express Request object
 * @returns Bearer token or null if not found
 */
function extractBearerToken(req: express.Request): string | null {
  // First, try standard Express headers (case-insensitive check)
  let authHeader: string | undefined;

  // Check common case variations in req.headers
  const headerKeys = Object.keys(req.headers);
  for (const key of headerKeys) {
    if (key.toLowerCase() === "authorization") {
      const value = req.headers[key];
      if (value && typeof value === "string") {
        authHeader = value;
        break;
      }
    }
  }

  // Fallback to req.apiGateway.event.headers (serverless-express attaches the event)
  // Headers in API Gateway events are normalized to lowercase
  if (!authHeader && req.apiGateway?.event?.headers) {
    const eventHeaders = req.apiGateway.event.headers;
    // Check lowercase 'authorization' (normalized by API Gateway)
    authHeader = eventHeaders.authorization;

    // Also check case variations in event headers
    if (!authHeader) {
      for (const [key, value] of Object.entries(eventHeaders)) {
        if (
          key.toLowerCase() === "authorization" &&
          typeof value === "string"
        ) {
          authHeader = value;
          break;
        }
      }
    }
  }

  if (!authHeader || typeof authHeader !== "string") {
    // Debug logging to help diagnose header extraction issues
    console.log(`[extractBearerToken] No Authorization header found`, {
      hasHeaders: !!req.headers,
      headerKeys: Object.keys(req.headers || {}),
      hasApiGateway: !!req.apiGateway,
      hasEvent: !!req.apiGateway?.event,
      eventHeaderKeys: req.apiGateway?.event?.headers
        ? Object.keys(req.apiGateway.event.headers)
        : undefined,
      authorizationInHeaders: !!(
        req.headers.authorization || req.headers.Authorization
      ),
      authorizationInEvent: !!req.apiGateway?.event?.headers?.authorization,
    });
    return null;
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }
  return match[1];
}

/**
 * Helper middleware to require authentication via Bearer token
 * Validates Bearer token (JWT access token) and extracts user information
 */
export const requireAuth = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  try {
    const bearerToken = extractBearerToken(req);
    if (!bearerToken) {
      throw unauthorized("Bearer token required");
    }

    // Verify JWT access token (throws unauthorized if invalid)
    const tokenPayload = await verifyAccessToken(bearerToken);

    // Debug logging to diagnose authentication issues
    console.log(
      `[requireAuth] JWT token validated - userId: ${tokenPayload.userId}, email: ${tokenPayload.email}`
    );

    // Set user information on request for compatibility with existing code
    req.userRef = userRef(tokenPayload.userId);

    console.log(`[requireAuth] Set req.userRef to: ${req.userRef}`);
    // Create a session-like object for compatibility
    req.session = {
      user: {
        id: tokenPayload.userId,
        email: tokenPayload.email,
      },
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours from now
    };

    next();
  } catch (error) {
    handleError(error, next, "requireAuth");
  }
};

/**
 * Helper middleware to require authentication via Bearer token OR cookie-based session
 * Used for endpoints that need to work with either authentication method (e.g., token generation)
 */
export const requireAuthOrSession = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  try {
    // First try Bearer token authentication
    const bearerToken = extractBearerToken(req);
    if (bearerToken) {
      try {
        // Verify JWT access token (throws unauthorized if invalid)
        const tokenPayload = await verifyAccessToken(bearerToken);

        // Set user information on request for compatibility with existing code
        req.userRef = userRef(tokenPayload.userId);
        // Create a session-like object for compatibility
        req.session = {
          user: {
            id: tokenPayload.userId,
            email: tokenPayload.email,
          },
          expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours from now
        };

        return next();
      } catch {
        // JWT validation failed, fall through to cookie-based auth
      }
    }

    // Fall back to cookie-based session authentication
    const session = await requireSessionFromRequest(req);
    if (!session.user?.id) {
      throw unauthorized();
    }
    req.session = session;
    req.userRef = userRef(session.user.id);
    next();
  } catch (error) {
    handleError(error, next, "requireAuthOrSession");
  }
};

/**
 * Helper to check permission
 */
export const requirePermission = (minimumLevel: number) => {
  return async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    try {
      const workspaceId = req.params.workspaceId;
      if (!workspaceId) {
        throw badRequest("workspaceId is required");
      }
      const currentUserRef = req.userRef;
      if (!currentUserRef) {
        throw unauthorized();
      }
      const userRefValue = currentUserRef;
      const resource = `workspaces/${workspaceId}`;

      const [authorized] = await isUserAuthorized(
        userRefValue,
        resource,
        minimumLevel
      );

      if (!authorized) {
        throw forbidden(
          `Insufficient permissions. Required level: ${minimumLevel}`
        );
      }

      req.workspaceResource = resource;
      next();
    } catch (error) {
      handleError(error, next, "requirePermission");
    }
  };
};
