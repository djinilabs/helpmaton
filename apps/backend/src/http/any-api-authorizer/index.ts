import { boomify, unauthorized } from "@hapi/boom";
import type {
  APIGatewayRequestAuthorizerEvent,
  APIGatewayAuthorizerResult,
} from "aws-lambda";

import { database } from "../../tables/database";
import { associateSubscriptionWithPlan } from "../../utils/apiGatewayUsagePlans";
import { validateApiKeyAndGetUserId } from "../../utils/apiKeyUtils";
import {
  initSentry,
  Sentry,
  flushSentry,
  ensureError,
} from "../../utils/sentry";
import {
  getWorkspaceSubscription,
  getUserSubscription,
  getSubscriptionById,
} from "../../utils/subscriptionUtils";
import { verifyAccessToken } from "../../utils/tokenUtils";

// Initialize Sentry when this module is loaded
initSentry();

/**
 * Extract workspace ID from request path
 * Supports multiple path patterns:
 * - /api/webhook/:workspaceId/:agentId/:key
 * - /api/workspaces/:workspaceId/...
 * - Other patterns with workspaceId parameter
 * 
 * Note: Paths without workspace IDs (e.g., /api/scrape) will return null,
 * and the authorizer will fall back to user-based authentication.
 */
function extractWorkspaceIdFromPath(path: string): string | null {
  // Pattern 1: /api/webhook/:workspaceId/:agentId/:key
  const webhookMatch = path.match(/^\/api\/webhook\/([^/]+)\//);
  if (webhookMatch) {
    return webhookMatch[1];
  }

  // Pattern 2: /api/workspaces/:workspaceId/...
  const workspacesMatch = path.match(/^\/api\/workspaces\/([^/]+)/);
  if (workspacesMatch) {
    return workspacesMatch[1];
  }

  return null;
}

/**
 * Extract Bearer token from Authorization header
 * @param headers - Request headers
 * @returns Bearer token or null if not found
 */
function extractBearerToken(headers: Record<string, string>): string | null {
  const authHeader = headers.authorization || headers.Authorization;
  if (!authHeader) {
    return null;
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }
  const token = match[1];

  // Basic validation for API keys (format: hmat_<64 hex chars> = 69 chars total)
  // JWT tokens have variable length, so we only validate API key format here
  // This helps avoid unnecessary database scans for malformed API keys
  if (token.startsWith("hmat_") && token.length !== 69) {
    return null; // Invalid API key format
  }

  return token;
}

/**
 * Lambda authorizer for API Gateway
 * Extracts workspace ID from request path, looks up subscription, and returns API key ID for throttling
 * Falls back to user-based authentication if no workspace is found in the path
 */
export const handler = async (
  event: APIGatewayRequestAuthorizerEvent
): Promise<APIGatewayAuthorizerResult> => {
  try {
    // Log the incoming event structure to debug cookie issues
    console.log(
      `[api-authorizer] Event received - headers keys: ${Object.keys(
        event.headers || {}
      ).join(", ")}, multiValueHeaders keys: ${Object.keys(
        event.multiValueHeaders || {}
      ).join(", ")}, has Cookie header: ${
        !!event.headers?.Cookie || !!event.headers?.cookie
      }, has Cookie in multiValueHeaders: ${!!event.multiValueHeaders?.Cookie}`
    );

    // Extract workspace ID from the method ARN
    // Method ARN format: arn:aws:execute-api:region:account-id:api-id/stage/method/resource-path
    const methodArn = event.methodArn;
    const arnParts = methodArn.split(":");

    if (arnParts.length < 6) {
      throw unauthorized("Invalid method ARN format");
    }

    // Extract resource path from method ARN
    // Format: api-id/stage/method/resource-path
    const resourcePath = arnParts[5];
    const pathParts = resourcePath.split("/");

    if (pathParts.length < 4) {
      throw unauthorized("Invalid resource path in method ARN");
    }

    // Reconstruct the path (skip api-id, stage, method)
    const path = "/" + pathParts.slice(3).join("/");

    // Build a wildcard policy ARN that allows all methods and paths for this API and stage
    // This is safer than using the exact methodArn, which might not match due to path parameter variations
    // Format: arn:aws:execute-api:region:account-id:api-id/stage/*/*
    const apiId = pathParts[0];
    const stage = pathParts[1];
    const policyArn = `${arnParts.slice(0, 5).join(":")}:${apiId}/${stage}/*/*`;

    console.log(
      `[api-authorizer] Processing request - methodArn: ${methodArn}, extracted path: ${path}`
    );

    // Extract workspace ID from path
    const extractedWorkspaceId = extractWorkspaceIdFromPath(path);
    let workspaceId: string | undefined;
    let subscription;
    let subscriptionId: string | undefined;
    let plan: string | undefined;

    if (extractedWorkspaceId) {
      // Case 1: Workspace-based request - try to get subscription from workspace first
      workspaceId = extractedWorkspaceId;
      console.log(
        `[api-authorizer] Extracted workspaceId: ${workspaceId} from path: ${path}`
      );

      try {
        subscription = await getWorkspaceSubscription(workspaceId);
        console.log(
          `[api-authorizer] getWorkspaceSubscription returned: ${
            subscription ? `subscription ${subscription.pk}` : "null"
          }`
        );
      } catch (workspaceError) {
        console.error(
          `[api-authorizer] Error getting workspace subscription:`,
          workspaceError instanceof Error
            ? workspaceError.message
            : String(workspaceError)
        );
        // Fall through to user-based authentication
        subscription = undefined;
      }

      // If workspace has no subscription, fall back to user-based authentication
      if (!subscription || !subscription.pk || !subscription.plan) {
        console.log(
          `[api-authorizer] Workspace ${workspaceId} has no subscription, falling back to user-based authentication`
        );
        // Fall through to user-based authentication below
        subscription = undefined;
      } else {
        // Workspace has a valid subscription, use it
        subscriptionId = subscription.pk.replace("subscriptions/", "");
        plan = subscription.plan;
        console.log(
          `[api-authorizer] Using workspace subscription ${subscriptionId} (plan: ${plan}) for workspace ${workspaceId}`
        );
      }
    }

    // Case 2: No workspace subscription OR no workspace in path - get authenticated user's subscription
    if (!subscription) {
      // Case 2: No workspace subscription found (either no workspace in path, or workspace has no subscription)
      console.log(
        `[api-authorizer] ${
          workspaceId
            ? `Workspace ${workspaceId} has no subscription`
            : `No workspaceId found in path: ${path}`
        }, attempting user-based authentication`
      );

      // Get user from Bearer token authentication
      const headers: Record<string, string> = {};

      // Copy headers from request (normalize to lowercase)
      if (event.headers) {
        for (const [key, value] of Object.entries(event.headers)) {
          headers[key.toLowerCase()] = value || "";
        }
      }

      // Extract and validate Bearer token (JWT access token or API key)
      const bearerToken = extractBearerToken(headers);
      let userId: string | undefined;

      if (bearerToken) {
        console.log(
          `[api-authorizer] Bearer token found, attempting authentication`
        );

        // First try JWT access token validation
        try {
          const tokenPayload = await verifyAccessToken(bearerToken);
          userId = tokenPayload.userId;
          console.log(
            `[api-authorizer] JWT access token validated successfully for user: ${userId}`
          );
        } catch (jwtError) {
          // If it's an unauthorized error from JWT validation, fall back to API key
          // Otherwise, re-throw the error
          if (
            jwtError &&
            typeof jwtError === "object" &&
            "isBoom" in jwtError
          ) {
            // Fall back to API key validation (for backward compatibility with API keys)
            console.log(
              `[api-authorizer] JWT validation failed, trying API key authentication`
            );
            userId =
              (await validateApiKeyAndGetUserId(bearerToken)) || undefined;

            if (userId) {
              console.log(
                `[api-authorizer] API key validated successfully for user: ${userId}`
              );
            }
          } else {
            // Re-throw non-unauthorized errors
            throw jwtError;
          }
        }
      }

      // At this point, userId should be set from Bearer token
      if (!userId) {
        throw unauthorized("User not authenticated");
      }
      console.log(
        `[api-authorizer] Found authenticated user: ${userId}, getting subscription`
      );

      // Get user's subscription (auto-creates free subscription if needed)
      subscription = await getUserSubscription(userId);

      if (!subscription) {
        console.error(
          `[api-authorizer] Failed to get or create subscription for user: ${userId}`
        );
        throw unauthorized("Failed to get user subscription");
      }

      if (!subscription.pk) {
        console.error(
          `[api-authorizer] Subscription has no pk for user: ${userId}`
        );
        throw unauthorized("Subscription has no pk");
      }

      if (!subscription.plan) {
        console.error(
          `[api-authorizer] Subscription has no plan for user: ${userId}, subscription: ${subscription.pk}`
        );
        throw unauthorized("Subscription has no plan");
      }

      subscriptionId = subscription.pk.replace("subscriptions/", "");
      plan = subscription.plan;

      console.log(
        `[api-authorizer] Using user subscription ${subscriptionId} (plan: ${plan}) for user ${userId}${
          workspaceId ? ` (fallback for workspace ${workspaceId})` : ""
        }`
      );
    }

    // At this point, subscriptionId and plan must be set (either from workspace or user)
    if (!subscriptionId || !plan) {
      throw unauthorized("Failed to determine subscription");
    }

    // Get the subscription record to retrieve the API key ID
    // The API key ID is stored in the subscription record when it's created/updated
    const subscriptionRecord = await getSubscriptionById(subscriptionId);

    if (!subscriptionRecord) {
      throw unauthorized("Subscription not found");
    }

    // Get API key ID from subscription record
    // If not found, create it and associate with the usage plan
    let apiKeyId = subscriptionRecord.apiKeyId;

    if (!apiKeyId) {
      console.log(
        `[api-authorizer] Subscription ${subscriptionId} has no apiKeyId. Creating API key and associating with usage plan...`
      );

      try {
        // Create API key and associate with usage plan
        apiKeyId = await associateSubscriptionWithPlan(
          subscriptionId,
          plan as "free" | "starter" | "pro"
        );

        // Update subscription record with the new API key ID
        const db = await database();
        await db.subscription.update({
          ...subscriptionRecord,
          apiKeyId,
        });

        console.log(
          `[api-authorizer] Created API key ${apiKeyId} for subscription ${subscriptionId} and updated subscription record`
        );
      } catch (error) {
        console.error(
          `[api-authorizer] Error creating API key for subscription ${subscriptionId}:`,
          error
        );
        throw new Error(
          "Unauthorized: failed to create API key for throttling"
        );
      }
    }

    // Log subscription info (workspaceId may be undefined for user-based auth)
    if (workspaceId) {
      console.log(
        `[api-authorizer] Using subscription ${subscriptionId} (plan: ${plan}, apiKeyId: ${apiKeyId}) for workspace ${workspaceId}`
      );
    } else {
      console.log(
        `[api-authorizer] Using subscription ${subscriptionId} (plan: ${plan}, apiKeyId: ${apiKeyId}) for user-based authentication`
      );
    }

    // Return authorizer response with usageIdentifierKey for throttling
    // The usageIdentifierKey tells API Gateway which API key to use for rate limiting
    // Use wildcard policy ARN to allow all methods and paths for this API and stage
    // This is safer than using the exact methodArn, which might not match due to path parameter variations
    const authorizerResponse: APIGatewayAuthorizerResult = {
      principalId: subscriptionId,
      usageIdentifierKey: apiKeyId,
      policyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Action: "execute-api:Invoke",
            Effect: "Allow" as const,
            Resource: policyArn,
          },
        ],
      },
      context: {
        subscriptionId,
        plan,
        ...(workspaceId && { workspaceId }),
      },
    };

    console.log(
      `[api-authorizer] Policy ARN: ${policyArn} (from methodArn: ${methodArn})`
    );

    console.log(
      `[api-authorizer] Returning authorizer response: ${JSON.stringify(
        authorizerResponse,
        null,
        2
      )}`
    );

    return authorizerResponse;
  } catch (error) {
    console.error("[api-authorizer] Error in authorizer:", error);

    const boomed = boomify(error as Error);

    // Log error details including status code
    console.error("[api-authorizer] Error details:", {
      statusCode: boomed.output.statusCode,
      message: boomed.message,
      isServer: boomed.isServer,
    });

    if (boomed.isServer) {
      console.error("[api-authorizer] Server error:", boomed);
      Sentry.captureException(ensureError(error), {
        tags: {
          handler: "APIGatewayAuthorizer",
          statusCode: boomed.output.statusCode,
        },
        contexts: {
          request: {
            methodArn: event.methodArn,
            resource: event.resource,
            path: event.path,
          },
        },
      });
    }

    // Extract policy ARN from methodArn for the Deny policy
    // Format: arn:aws:execute-api:region:account-id:api-id/stage/method/resource-path
    const methodArn = event.methodArn;
    const arnParts = methodArn.split(":");
    let policyArn: string;

    if (arnParts.length >= 6) {
      const resourcePath = arnParts[5];
      const pathParts = resourcePath.split("/");
      if (pathParts.length >= 2) {
        const apiId = pathParts[0];
        const stage = pathParts[1];
        // Use wildcard policy ARN to deny all methods and paths for this API and stage
        policyArn = `${arnParts.slice(0, 5).join(":")}:${apiId}/${stage}/*/*`;
      } else {
        // Fallback: use the methodArn as-is
        policyArn = methodArn;
      }
    } else {
      // Fallback: use the methodArn as-is
      policyArn = methodArn;
    }

    // Return a Deny policy - API Gateway will use the status code from the boom error
    // The status code is preserved in the error context for API Gateway to use
    const denyResponse: APIGatewayAuthorizerResult = {
      principalId: "unauthorized",
      policyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Action: "execute-api:Invoke",
            Effect: "Deny" as const,
            Resource: policyArn,
          },
        ],
      },
      // Include error context so API Gateway can use the status code
      context: {
        statusCode: String(boomed.output.statusCode),
        errorMessage: boomed.message,
      },
    };

    console.error(
      `[api-authorizer] Returning Deny policy with status code ${boomed.output.statusCode}: ${boomed.message}`
    );

    return denyResponse;
  } finally {
    // Flush Sentry events before Lambda terminates (critical for Lambda)
    // This ensures flushing happens on both success and error paths
    try {
      await flushSentry();
    } catch (flushError) {
      console.error("[Sentry] Error flushing events:", flushError);
    }
  }
};
