import { unauthorized } from "@hapi/boom";
import type { APIGatewayRequestAuthorizerEvent } from "aws-lambda";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const {
  mockGetWorkspaceSubscription,
  mockGetUserSubscription,
  mockGetSubscriptionById,
  mockGetSession,
  mockAssociateSubscriptionWithPlan,
  mockDatabase,
  mockVerifyAccessToken,
  mockValidateApiKeyAndGetUserId,
} = vi.hoisted(() => {
  return {
    mockGetWorkspaceSubscription: vi.fn(),
    mockGetUserSubscription: vi.fn(),
    mockGetSubscriptionById: vi.fn(),
    mockGetSession: vi.fn(),
    mockAssociateSubscriptionWithPlan: vi.fn(),
    mockDatabase: vi.fn(),
    mockVerifyAccessToken: vi.fn(),
    mockValidateApiKeyAndGetUserId: vi.fn(),
  };
});

// Mock the utility modules
vi.mock("../../../utils/subscriptionUtils", () => ({
  getWorkspaceSubscription: mockGetWorkspaceSubscription,
  getUserSubscription: mockGetUserSubscription,
  getSubscriptionById: mockGetSubscriptionById,
}));

vi.mock("../../../utils/apiGatewayUsagePlans", () => ({
  associateSubscriptionWithPlan: mockAssociateSubscriptionWithPlan,
}));

vi.mock("../../../tables/database", () => ({
  database: mockDatabase,
}));

vi.mock("../../utils/session", () => ({
  getSession: mockGetSession,
}));

vi.mock("../../../utils/tokenUtils", () => ({
  verifyAccessToken: mockVerifyAccessToken,
}));

// Import the handler after mocks are set up
import { handler } from "../index";

describe("API Authorizer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Helper to convert methodArn to wildcard policy ARN
   * Format: arn:aws:execute-api:region:account-id:api-id/stage/WILDCARD/WILDCARD
   * (where WILDCARD means * for all methods and paths)
   */
  function getPolicyArn(methodArn: string): string {
    const arnParts = methodArn.split(":");
    if (arnParts.length < 6) {
      throw new Error("Invalid method ARN format");
    }
    const resourcePath = arnParts[5];
    const pathParts = resourcePath.split("/");
    if (pathParts.length < 2) {
      throw new Error("Invalid resource path in method ARN");
    }
    const apiId = pathParts[0];
    const stage = pathParts[1];
    return `${arnParts.slice(0, 5).join(":")}:${apiId}/${stage}/*/*`;
  }

  /**
   * Helper to create a valid APIGatewayRequestAuthorizerEvent
   */
  function createAuthorizerEvent(
    overrides?: Partial<APIGatewayRequestAuthorizerEvent>
  ): APIGatewayRequestAuthorizerEvent {
    return {
      type: "REQUEST",
      methodArn:
        "arn:aws:execute-api:eu-west-2:123456789012:abc123/default/GET/api/workspaces/workspace-123",
      resource: "/api/workspaces/{workspaceId}",
      path: "/api/workspaces/workspace-123",
      httpMethod: "GET",
      headers: {},
      multiValueHeaders: {},
      pathParameters: {},
      queryStringParameters: {},
      multiValueQueryStringParameters: {},
      stageVariables: {},
      requestContext: {
        accountId: "123456789012",
        apiId: "abc123",
        authorizer: undefined,
        protocol: "HTTP/1.1",
        httpMethod: "GET",
        path: "/api/workspaces/workspace-123",
        stage: "default",
        requestId: "test-request-id",
        requestTime: "09/Apr/2015:12:34:56 +0000",
        requestTimeEpoch: 1428582896000,
        identity: {
          accessKey: null,
          accountId: null,
          apiKey: null,
          apiKeyId: null,
          caller: null,
          cognitoAuthenticationProvider: null,
          cognitoAuthenticationType: null,
          cognitoIdentityId: null,
          cognitoIdentityPoolId: null,
          principalOrgId: null,
          sourceIp: "127.0.0.1",
          user: null,
          userAgent: "test-agent",
          userArn: null,
          clientCert: null,
        },
        resourceId: "resource-id",
        resourcePath: "/api/workspaces/{workspaceId}",
      },
      ...overrides,
    };
  }

  describe("Workspace-based authentication", () => {
    it("should authorize request with workspace ID in webhook path", async () => {
      const event = createAuthorizerEvent({
        methodArn:
          "arn:aws:execute-api:eu-west-2:123456789012:abc123/default/POST/api/webhook/workspace-123/agent-456/key-789",
      });

      const mockSubscription = {
        pk: "subscriptions/sub-123",
        plan: "pro" as const,
        userId: "user-123",
        apiKeyId: "api-key-123",
      };

      mockGetWorkspaceSubscription.mockResolvedValue(mockSubscription);
      mockGetSubscriptionById.mockResolvedValue(mockSubscription);

      const result = await handler(event);

      expect(mockGetWorkspaceSubscription).toHaveBeenCalledWith(
        "workspace-123"
      );
      expect(mockGetSubscriptionById).toHaveBeenCalledWith("sub-123");
      expect(result).toEqual({
        principalId: "sub-123",
        usageIdentifierKey: "api-key-123",
        policyDocument: {
          Version: "2012-10-17",
          Statement: [
            {
              Action: "execute-api:Invoke",
              Effect: "Allow",
              Resource: getPolicyArn(event.methodArn),
            },
          ],
        },
        context: {
          subscriptionId: "sub-123",
          plan: "pro",
          workspaceId: "workspace-123",
        },
      });
    });

    it("should authorize request with workspace ID in workspaces path", async () => {
      const event = createAuthorizerEvent({
        methodArn:
          "arn:aws:execute-api:eu-west-2:123456789012:abc123/default/GET/api/workspaces/workspace-456",
      });

      const mockSubscription = {
        pk: "subscriptions/sub-456",
        plan: "starter" as const,
        userId: "user-456",
        apiKeyId: "api-key-456",
      };

      mockGetWorkspaceSubscription.mockResolvedValue(mockSubscription);
      mockGetSubscriptionById.mockResolvedValue(mockSubscription);

      const result = await handler(event);

      expect(mockGetWorkspaceSubscription).toHaveBeenCalledWith(
        "workspace-456"
      );
      expect(result.context?.workspaceId).toBe("workspace-456");
      expect(result.context?.plan).toBe("starter");
    });

    it("should create API key when subscription has no apiKeyId for webhook request", async () => {
      const event = createAuthorizerEvent({
        methodArn:
          "arn:aws:execute-api:eu-west-2:123456789012:abc123/default/POST/api/webhook/workspace-123/agent-456/key-789",
      });

      const mockSubscription = {
        pk: "subscriptions/sub-123",
        plan: "free" as const,
        userId: "user-123",
        // No apiKeyId
      };

      const createdApiKeyId = "new-api-key-123";
      const mockDb = {
        subscription: {
          update: vi.fn().mockResolvedValue({
            ...mockSubscription,
            apiKeyId: createdApiKeyId,
          }),
        },
      };

      mockGetWorkspaceSubscription.mockResolvedValue(mockSubscription);
      mockGetSubscriptionById.mockResolvedValue(mockSubscription);
      mockAssociateSubscriptionWithPlan.mockResolvedValue(createdApiKeyId);
      mockDatabase.mockResolvedValue(mockDb);

      const result = await handler(event);

      // Verify API key was created and associated with plan
      expect(mockAssociateSubscriptionWithPlan).toHaveBeenCalledWith(
        "sub-123",
        "free"
      );

      // Verify subscription was updated with API key ID
      expect(mockDb.subscription.update).toHaveBeenCalledWith({
        ...mockSubscription,
        apiKeyId: createdApiKeyId,
      });

      // Verify authorizer response includes the API key ID
      expect(result.usageIdentifierKey).toBe(createdApiKeyId);
      expect(result.principalId).toBe("sub-123");
      expect(result.context?.workspaceId).toBe("workspace-123");
    });

    it("should handle error when workspace subscription lookup fails for webhook", async () => {
      const event = createAuthorizerEvent({
        methodArn:
          "arn:aws:execute-api:eu-west-2:123456789012:abc123/default/POST/api/webhook/workspace-123/agent-456/key-789",
        headers: {}, // No Bearer token - typical for webhook requests
      });

      const workspaceError = new Error("Database connection failed");
      mockGetWorkspaceSubscription.mockRejectedValue(workspaceError);
      mockVerifyAccessToken.mockRejectedValue(
        unauthorized("Invalid or expired access token")
      ); // No valid Bearer token
      mockValidateApiKeyAndGetUserId.mockResolvedValue(null); // No valid API key

      const result = await handler(event);
      expect(result.policyDocument.Statement[0].Effect).toBe("Deny");
      expect(result.principalId).toBe("unauthorized");
      expect(result.context?.statusCode).toBe("401");
      expect(result.context?.errorMessage).toBe("User not authenticated");

      expect(mockGetWorkspaceSubscription).toHaveBeenCalledWith(
        "workspace-123"
      );
      expect(mockGetSubscriptionById).not.toHaveBeenCalled();
    });

    it("should fail when webhook workspace has no subscription and no Bearer token", async () => {
      const event = createAuthorizerEvent({
        methodArn:
          "arn:aws:execute-api:eu-west-2:123456789012:abc123/default/POST/api/webhook/workspace-789/agent-456/key-789",
        headers: {}, // No Bearer token - typical for webhook requests
      });

      mockGetWorkspaceSubscription.mockResolvedValue(undefined);
      mockVerifyAccessToken.mockRejectedValue(
        unauthorized("Invalid or expired access token")
      ); // No valid Bearer token
      mockValidateApiKeyAndGetUserId.mockResolvedValue(null); // No valid API key

      const result = await handler(event);
      expect(result.policyDocument.Statement[0].Effect).toBe("Deny");
      expect(result.principalId).toBe("unauthorized");
      expect(result.context?.statusCode).toBe("401");
      expect(result.context?.errorMessage).toBe("User not authenticated");

      expect(mockGetWorkspaceSubscription).toHaveBeenCalledWith(
        "workspace-789"
      );
      expect(mockGetSubscriptionById).not.toHaveBeenCalled();
    });

    it("should fall back to user-based auth when workspace has no subscription", async () => {
      const event = createAuthorizerEvent({
        methodArn:
          "arn:aws:execute-api:eu-west-2:123456789012:abc123/default/GET/api/workspaces/workspace-789",
        headers: {
          Authorization: "Bearer valid-jwt-token",
        },
      });

      mockGetWorkspaceSubscription.mockResolvedValue(undefined);
      // No user authenticated via Bearer token, so fallback fails
      mockVerifyAccessToken.mockRejectedValue(
        unauthorized("Invalid or expired access token")
      );
      mockValidateApiKeyAndGetUserId.mockResolvedValue(null);

      const result = await handler(event);
      expect(result.policyDocument.Statement[0].Effect).toBe("Deny");
      expect(result.principalId).toBe("unauthorized");
      expect(result.context?.statusCode).toBe("401");
      expect(result.context?.errorMessage).toBe("User not authenticated");

      expect(mockGetWorkspaceSubscription).toHaveBeenCalledWith(
        "workspace-789"
      );
      expect(mockGetSubscriptionById).not.toHaveBeenCalled();
    });

    it("should fall back to user-based auth when subscription has no pk", async () => {
      const event = createAuthorizerEvent({
        methodArn:
          "arn:aws:execute-api:eu-west-2:123456789012:abc123/default/GET/api/workspaces/workspace-999",
        headers: {
          Authorization: "Bearer valid-jwt-token",
        },
      });

      const mockSubscription = {
        plan: "free" as const,
        userId: "user-999",
        // Missing pk
      } as Partial<{
        pk: string;
        plan: "free" | "starter" | "pro";
        userId: string;
        apiKeyId?: string;
      }>;

      mockGetWorkspaceSubscription.mockResolvedValue(mockSubscription);
      // No user authenticated via Bearer token, so fallback fails
      mockVerifyAccessToken.mockRejectedValue(
        unauthorized("Invalid or expired access token")
      );
      mockValidateApiKeyAndGetUserId.mockResolvedValue(null);

      const result = await handler(event);
      expect(result.policyDocument.Statement[0].Effect).toBe("Deny");
      expect(result.principalId).toBe("unauthorized");
      expect(result.context?.statusCode).toBe("401");
      expect(result.context?.errorMessage).toBe("User not authenticated");

      expect(mockGetWorkspaceSubscription).toHaveBeenCalledWith(
        "workspace-999"
      );
    });

    it("should fall back to user-based auth when subscription has no plan", async () => {
      const event = createAuthorizerEvent({
        methodArn:
          "arn:aws:execute-api:eu-west-2:123456789012:abc123/default/GET/api/workspaces/workspace-888",
        headers: {
          Authorization: "Bearer valid-jwt-token",
        },
      });

      const mockSubscription = {
        pk: "subscriptions/sub-888",
        userId: "user-888",
        // Missing plan
      } as Partial<{
        pk: string;
        plan: "free" | "starter" | "pro";
        userId: string;
        apiKeyId?: string;
      }>;

      mockGetWorkspaceSubscription.mockResolvedValue(mockSubscription);
      // No user authenticated via Bearer token, so fallback fails
      mockVerifyAccessToken.mockRejectedValue(
        unauthorized("Invalid or expired access token")
      );
      mockValidateApiKeyAndGetUserId.mockResolvedValue(null);

      const result = await handler(event);
      expect(result.policyDocument.Statement[0].Effect).toBe("Deny");
      expect(result.principalId).toBe("unauthorized");
      expect(result.context?.statusCode).toBe("401");
      expect(result.context?.errorMessage).toBe("User not authenticated");

      expect(mockGetWorkspaceSubscription).toHaveBeenCalledWith(
        "workspace-888"
      );
    });
  });

  describe("User-based authentication", () => {
    it("should authorize request with authenticated user when no workspace in path", async () => {
      const event = createAuthorizerEvent({
        methodArn:
          "arn:aws:execute-api:eu-west-2:123456789012:abc123/default/GET/api/subscription",
        headers: {
          Authorization: "Bearer valid-jwt-token",
        },
      });

      const mockTokenPayload = {
        userId: "user-123",
        email: "user@example.com",
      };

      const mockSubscription = {
        pk: "subscriptions/sub-789",
        plan: "free" as const,
        userId: "user-123",
        apiKeyId: "api-key-789",
      };

      mockVerifyAccessToken.mockResolvedValue(mockTokenPayload);
      mockGetUserSubscription.mockResolvedValue(mockSubscription);
      mockGetSubscriptionById.mockResolvedValue(mockSubscription);

      const result = await handler(event);

      expect(mockVerifyAccessToken).toHaveBeenCalled();
      expect(mockGetUserSubscription).toHaveBeenCalledWith("user-123");
      expect(mockGetSubscriptionById).toHaveBeenCalledWith("sub-789");
      expect(result).toEqual({
        principalId: "sub-789",
        usageIdentifierKey: "api-key-789",
        policyDocument: {
          Version: "2012-10-17",
          Statement: [
            {
              Action: "execute-api:Invoke",
              Effect: "Allow",
              Resource: getPolicyArn(event.methodArn),
            },
          ],
        },
        context: {
          subscriptionId: "sub-789",
          plan: "free",
          // workspaceId should not be present
        },
      });
      expect(result.context?.workspaceId).toBeUndefined();
    });

    it("should throw error when no authenticated user found", async () => {
      const event = createAuthorizerEvent({
        methodArn:
          "arn:aws:execute-api:eu-west-2:123456789012:abc123/default/GET/api/subscription",
        headers: {},
      });

      mockVerifyAccessToken.mockResolvedValue(null);
      mockValidateApiKeyAndGetUserId.mockResolvedValue(null);

      const result = await handler(event);
      expect(result.policyDocument.Statement[0].Effect).toBe("Deny");
      expect(result.principalId).toBe("unauthorized");
      expect(result.context?.statusCode).toBe("401");
      expect(result.context?.errorMessage).toBe("User not authenticated");

      expect(mockGetUserSubscription).not.toHaveBeenCalled();
    });

    it("should throw error when Bearer token is invalid", async () => {
      const event = createAuthorizerEvent({
        methodArn:
          "arn:aws:execute-api:eu-west-2:123456789012:abc123/default/GET/api/subscription",
        headers: {
          Authorization: "Bearer invalid-token",
        },
      });

      mockVerifyAccessToken.mockRejectedValue(
        unauthorized("Invalid or expired access token")
      );
      mockValidateApiKeyAndGetUserId.mockResolvedValue(null);

      const result = await handler(event);
      expect(result.policyDocument.Statement[0].Effect).toBe("Deny");
      expect(result.principalId).toBe("unauthorized");
      expect(result.context?.statusCode).toBe("401");
      expect(result.context?.errorMessage).toBe("User not authenticated");
    });

    it("should throw error when user subscription cannot be retrieved", async () => {
      const event = createAuthorizerEvent({
        methodArn:
          "arn:aws:execute-api:eu-west-2:123456789012:abc123/default/GET/api/subscription",
        headers: {
          Authorization: "Bearer valid-jwt-token",
        },
      });

      const mockTokenPayload = {
        userId: "user-123",
        email: "test@example.com",
      };

      mockVerifyAccessToken.mockResolvedValue(mockTokenPayload);
      mockGetUserSubscription.mockResolvedValue(undefined);

      const result = await handler(event);
      expect(result.policyDocument.Statement[0].Effect).toBe("Deny");
      expect(result.principalId).toBe("unauthorized");
      expect(result.context?.statusCode).toBe("401");
      expect(result.context?.errorMessage).toBe(
        "Failed to get user subscription"
      );
    });

    it("should throw error when user subscription has no pk", async () => {
      const event = createAuthorizerEvent({
        methodArn:
          "arn:aws:execute-api:eu-west-2:123456789012:abc123/default/GET/api/subscription",
        headers: {
          Authorization: "Bearer valid-jwt-token",
        },
      });

      const mockTokenPayload = {
        userId: "user-123",
        email: "test@example.com",
      };

      const mockSubscription = {
        plan: "free" as const,
        userId: "user-123",
        // Missing pk
      } as Partial<{
        pk: string;
        plan: "free" | "starter" | "pro";
        userId: string;
        apiKeyId?: string;
      }>;

      mockVerifyAccessToken.mockResolvedValue(mockTokenPayload);
      mockGetUserSubscription.mockResolvedValue(mockSubscription);

      const result = await handler(event);
      expect(result.policyDocument.Statement[0].Effect).toBe("Deny");
      expect(result.principalId).toBe("unauthorized");
      expect(result.context?.statusCode).toBe("401");
      expect(result.context?.errorMessage).toBe("Subscription has no pk");
    });

    it("should throw error when user subscription has no plan", async () => {
      const event = createAuthorizerEvent({
        methodArn:
          "arn:aws:execute-api:eu-west-2:123456789012:abc123/default/GET/api/subscription",
        headers: {
          Authorization: "Bearer valid-jwt-token",
        },
      });

      const mockTokenPayload = {
        userId: "user-123",
        email: "test@example.com",
      };

      const mockSubscription = {
        pk: "subscriptions/sub-123",
        userId: "user-123",
        // Missing plan
      } as Partial<{
        pk: string;
        plan: "free" | "starter" | "pro";
        userId: string;
        apiKeyId?: string;
      }>;

      mockVerifyAccessToken.mockResolvedValue(mockTokenPayload);
      mockGetUserSubscription.mockResolvedValue(mockSubscription);

      const result = await handler(event);
      expect(result.policyDocument.Statement[0].Effect).toBe("Deny");
      expect(result.principalId).toBe("unauthorized");
      expect(result.context?.statusCode).toBe("401");
      expect(result.context?.errorMessage).toBe("Subscription has no plan");
    });
  });

  describe("Method ARN parsing", () => {
    it("should throw error for invalid method ARN format", async () => {
      const event = createAuthorizerEvent({
        methodArn: "invalid-arn",
      });

      const result = await handler(event);
      expect(result.policyDocument.Statement[0].Effect).toBe("Deny");
      expect(result.principalId).toBe("unauthorized");
      expect(result.context?.statusCode).toBe("401");
      expect(result.context?.errorMessage).toBe("Invalid method ARN format");
    });

    it("should throw error for method ARN with insufficient parts", async () => {
      const event = createAuthorizerEvent({
        methodArn: "arn:aws:execute-api:eu-west-2",
      });

      const result = await handler(event);
      expect(result.policyDocument.Statement[0].Effect).toBe("Deny");
      expect(result.principalId).toBe("unauthorized");
      expect(result.context?.statusCode).toBe("401");
      expect(result.context?.errorMessage).toBe("Invalid method ARN format");
    });

    it("should throw error for invalid resource path in method ARN", async () => {
      const event = createAuthorizerEvent({
        methodArn: "arn:aws:execute-api:eu-west-2:123456789012:abc123/default",
      });

      const result = await handler(event);
      expect(result.policyDocument.Statement[0].Effect).toBe("Deny");
      expect(result.principalId).toBe("unauthorized");
      expect(result.context?.statusCode).toBe("401");
      expect(result.context?.errorMessage).toBe(
        "Invalid resource path in method ARN"
      );
    });

    it("should correctly extract path from method ARN", async () => {
      const event = createAuthorizerEvent({
        methodArn:
          "arn:aws:execute-api:eu-west-2:123456789012:abc123/default/POST/api/webhook/workspace-123/agent-456/key-789",
      });

      const mockSubscription = {
        pk: "subscriptions/sub-123",
        plan: "pro" as const,
        userId: "user-123",
        apiKeyId: "api-key-123",
      };

      mockGetWorkspaceSubscription.mockResolvedValue(mockSubscription);
      mockGetSubscriptionById.mockResolvedValue(mockSubscription);

      const result = await handler(event);

      expect(mockGetWorkspaceSubscription).toHaveBeenCalledWith(
        "workspace-123"
      );
      expect(result.context?.workspaceId).toBe("workspace-123");
    });
  });

  describe("API key management", () => {
    it("should get API key ID from subscription record", async () => {
      const event = createAuthorizerEvent({
        methodArn:
          "arn:aws:execute-api:eu-west-2:123456789012:abc123/default/GET/api/workspaces/workspace-123",
      });

      const mockSubscription = {
        pk: "subscriptions/sub-123",
        plan: "free" as const,
        userId: "user-123",
        apiKeyId: "api-key-123",
      };

      mockGetWorkspaceSubscription.mockResolvedValue(mockSubscription);
      mockGetSubscriptionById.mockResolvedValue(mockSubscription);

      const result = await handler(event);

      expect(mockGetSubscriptionById).toHaveBeenCalledWith("sub-123");
      expect(result.usageIdentifierKey).toBe("api-key-123");
    });

    it("should create API key when subscription has no apiKeyId", async () => {
      const event = createAuthorizerEvent({
        methodArn:
          "arn:aws:execute-api:eu-west-2:123456789012:abc123/default/GET/api/workspaces/workspace-123",
      });

      const mockSubscription = {
        pk: "subscriptions/sub-123",
        plan: "free" as const,
        userId: "user-123",
        // No apiKeyId
      };

      const createdApiKeyId = "new-api-key-123";
      const mockDb = {
        subscription: {
          update: vi.fn().mockResolvedValue({
            ...mockSubscription,
            apiKeyId: createdApiKeyId,
          }),
        },
      };

      mockGetWorkspaceSubscription.mockResolvedValue(mockSubscription);
      mockGetSubscriptionById.mockResolvedValue(mockSubscription);
      mockAssociateSubscriptionWithPlan.mockResolvedValue(createdApiKeyId);
      mockDatabase.mockResolvedValue(mockDb);

      const result = await handler(event);

      // Verify API key was created and associated with plan
      expect(mockAssociateSubscriptionWithPlan).toHaveBeenCalledWith(
        "sub-123",
        "free"
      );

      // Verify subscription was updated with API key ID
      expect(mockDb.subscription.update).toHaveBeenCalledWith({
        ...mockSubscription,
        apiKeyId: createdApiKeyId,
      });

      // Verify authorizer response includes the API key ID
      expect(result.usageIdentifierKey).toBe(createdApiKeyId);
      expect(result.principalId).toBe("sub-123");
    });
  });

  describe("Error handling", () => {
    it("should fall back to user-based auth when workspace subscription lookup fails", async () => {
      const event = createAuthorizerEvent({
        methodArn:
          "arn:aws:execute-api:eu-west-2:123456789012:abc123/default/GET/api/workspaces/workspace-123",
        headers: {
          Authorization: "Bearer valid-jwt-token",
        },
      });

      mockGetWorkspaceSubscription.mockRejectedValue(
        new Error("Database connection failed")
      );
      // No user authenticated via Bearer token, so fallback fails
      mockVerifyAccessToken.mockRejectedValue(
        unauthorized("Invalid or expired access token")
      );
      mockValidateApiKeyAndGetUserId.mockResolvedValue(null);

      // Error from getWorkspaceSubscription is caught and it falls back to user-based auth
      // Since user is not authenticated, it throws "user not authenticated"
      const result = await handler(event);
      expect(result.policyDocument.Statement[0].Effect).toBe("Deny");
      expect(result.principalId).toBe("unauthorized");
      expect(result.context?.statusCode).toBe("401");
      expect(result.context?.errorMessage).toBe("User not authenticated");

      expect(mockGetWorkspaceSubscription).toHaveBeenCalledWith(
        "workspace-123"
      );
    });

    it("should fall back to user-based auth when workspace subscription lookup throws non-Error", async () => {
      const event = createAuthorizerEvent({
        methodArn:
          "arn:aws:execute-api:eu-west-2:123456789012:abc123/default/GET/api/workspaces/workspace-123",
        headers: {
          Authorization: "Bearer valid-jwt-token",
        },
      });

      mockGetWorkspaceSubscription.mockRejectedValue("String error");
      // No user authenticated via Bearer token, so fallback fails
      mockVerifyAccessToken.mockRejectedValue(
        unauthorized("Invalid or expired access token")
      );
      mockValidateApiKeyAndGetUserId.mockResolvedValue(null);

      // Error from getWorkspaceSubscription is caught and it falls back to user-based auth
      // Since user is not authenticated, it throws "user not authenticated"
      const result = await handler(event);
      expect(result.policyDocument.Statement[0].Effect).toBe("Deny");
      expect(result.principalId).toBe("unauthorized");
      expect(result.context?.statusCode).toBe("401");
      expect(result.context?.errorMessage).toBe("User not authenticated");

      expect(mockGetWorkspaceSubscription).toHaveBeenCalledWith(
        "workspace-123"
      );
    });
  });

  describe("Path extraction", () => {
    it("should extract workspace ID from webhook path pattern", async () => {
      const event = createAuthorizerEvent({
        methodArn:
          "arn:aws:execute-api:eu-west-2:123456789012:abc123/default/POST/api/webhook/workspace-abc/agent-123/key-456",
      });

      const mockSubscription = {
        pk: "subscriptions/sub-abc",
        plan: "pro" as const,
        userId: "user-abc",
        apiKeyId: "api-key-abc",
      };

      mockGetWorkspaceSubscription.mockResolvedValue(mockSubscription);
      mockGetSubscriptionById.mockResolvedValue(mockSubscription);

      const result = await handler(event);

      expect(mockGetWorkspaceSubscription).toHaveBeenCalledWith(
        "workspace-abc"
      );
      expect(result.context?.workspaceId).toBe("workspace-abc");
    });

    it("should handle webhook request with no cookies (typical webhook scenario)", async () => {
      const event = createAuthorizerEvent({
        methodArn:
          "arn:aws:execute-api:eu-west-2:123456789012:abc123/default/POST/api/webhook/workspace-123/agent-456/key-789",
        headers: {}, // No cookies - typical for webhook requests
        multiValueHeaders: {}, // No cookies in multiValueHeaders either
      });

      const mockSubscription = {
        pk: "subscriptions/sub-123",
        plan: "pro" as const,
        userId: "user-123",
        apiKeyId: "api-key-123",
      };

      mockGetWorkspaceSubscription.mockResolvedValue(mockSubscription);
      mockGetSubscriptionById.mockResolvedValue(mockSubscription);
      mockGetSession.mockResolvedValue(null); // No session (no cookies)

      const result = await handler(event);

      // Should use workspace-based auth (no fallback to user auth needed)
      expect(mockGetWorkspaceSubscription).toHaveBeenCalledWith(
        "workspace-123"
      );
      expect(mockGetSession).not.toHaveBeenCalled(); // Should not try user auth when workspace subscription exists
      expect(result.context?.workspaceId).toBe("workspace-123");
      expect(result.usageIdentifierKey).toBe("api-key-123");
    });

    it("should extract workspace ID from workspaces path pattern", async () => {
      const event = createAuthorizerEvent({
        methodArn:
          "arn:aws:execute-api:eu-west-2:123456789012:abc123/default/GET/api/workspaces/workspace-xyz",
      });

      const mockSubscription = {
        pk: "subscriptions/sub-xyz",
        plan: "starter" as const,
        userId: "user-xyz",
        apiKeyId: "api-key-xyz",
      };

      mockGetWorkspaceSubscription.mockResolvedValue(mockSubscription);
      mockGetSubscriptionById.mockResolvedValue(mockSubscription);

      const result = await handler(event);

      expect(mockGetWorkspaceSubscription).toHaveBeenCalledWith(
        "workspace-xyz"
      );
      expect(result.context?.workspaceId).toBe("workspace-xyz");
    });

    it("should fall back to user authentication when no workspace pattern matches", async () => {
      const event = createAuthorizerEvent({
        methodArn:
          "arn:aws:execute-api:eu-west-2:123456789012:abc123/default/GET/api/subscription",
        headers: {
          Authorization: "Bearer valid-jwt-token",
        },
      });

      const mockTokenPayload = {
        userId: "user-123",
        email: "test@example.com",
      };

      const mockSubscription = {
        pk: "subscriptions/sub-123",
        plan: "free" as const,
        userId: "user-123",
        apiKeyId: "api-key-123",
      };

      mockVerifyAccessToken.mockResolvedValue(mockTokenPayload);
      mockGetUserSubscription.mockResolvedValue(mockSubscription);
      mockGetSubscriptionById.mockResolvedValue(mockSubscription);

      const result = await handler(event);

      expect(mockGetWorkspaceSubscription).not.toHaveBeenCalled();
      expect(mockVerifyAccessToken).toHaveBeenCalled();
      expect(result.context?.workspaceId).toBeUndefined();
    });
  });

  describe("Response structure", () => {
    it("should return correct policy document structure", async () => {
      const event = createAuthorizerEvent({
        methodArn:
          "arn:aws:execute-api:eu-west-2:123456789012:abc123/default/GET/api/workspaces/workspace-123",
      });

      const mockSubscription = {
        pk: "subscriptions/sub-123",
        plan: "pro" as const,
        userId: "user-123",
        apiKeyId: "api-key-123",
      };

      mockGetWorkspaceSubscription.mockResolvedValue(mockSubscription);
      mockGetSubscriptionById.mockResolvedValue(mockSubscription);

      const result = await handler(event);

      expect(result.policyDocument).toEqual({
        Version: "2012-10-17",
        Statement: [
          {
            Action: "execute-api:Invoke",
            Effect: "Allow",
            Resource: getPolicyArn(event.methodArn),
          },
        ],
      });
    });

    it("should include workspaceId in context when workspace-based auth", async () => {
      const event = createAuthorizerEvent({
        methodArn:
          "arn:aws:execute-api:eu-west-2:123456789012:abc123/default/GET/api/workspaces/workspace-123",
      });

      const mockSubscription = {
        pk: "subscriptions/sub-123",
        plan: "free" as const,
        userId: "user-123",
        apiKeyId: "api-key-123",
      };

      mockGetWorkspaceSubscription.mockResolvedValue(mockSubscription);
      mockGetSubscriptionById.mockResolvedValue(mockSubscription);

      const result = await handler(event);

      expect(result.context?.workspaceId).toBe("workspace-123");
    });

    it("should not include workspaceId in context when user-based auth", async () => {
      const event = createAuthorizerEvent({
        methodArn:
          "arn:aws:execute-api:eu-west-2:123456789012:abc123/default/GET/api/subscription",
        headers: {
          Authorization: "Bearer valid-jwt-token",
        },
      });

      const mockTokenPayload = {
        userId: "user-123",
        email: "test@example.com",
      };

      const mockSubscription = {
        pk: "subscriptions/sub-123",
        plan: "free" as const,
        userId: "user-123",
        apiKeyId: "api-key-123",
      };

      mockVerifyAccessToken.mockResolvedValue(mockTokenPayload);
      mockGetUserSubscription.mockResolvedValue(mockSubscription);
      mockGetSubscriptionById.mockResolvedValue(mockSubscription);

      const result = await handler(event);

      expect(result.context?.workspaceId).toBeUndefined();
      expect(result.context?.subscriptionId).toBe("sub-123");
      expect(result.context?.plan).toBe("free");
    });
  });
});
