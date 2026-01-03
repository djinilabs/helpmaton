import type { APIGatewayProxyEventV2, Callback, Context } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAPIGatewayEventV2,
  createMockCallback,
  createMockContext,
} from "../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const mockCloudFormationModule = vi.hoisted(() => {
  const mockSend = vi.fn();
  return {
    mockCloudFormationSend: mockSend,
    CloudFormationClientClass: class {
      send = mockSend;
    },
    DescribeStacksCommandClass: class {
      input: unknown;
      constructor(input: unknown) {
        this.input = input;
      }
    },
  };
});

// Mock awslambda using vi.hoisted to ensure it's available before module imports
// For URL endpoint tests, we want to test the API Gateway path, so we don't set up awslambda
const { mockGetDefined, mockStreamifyResponse, mockHttpResponseStreamFrom } =
  vi.hoisted(() => {
    const mockStreamifyResponseFn = vi.fn((handler) => handler);
    const mockHttpResponseStreamFromFn = vi.fn((stream) => stream);

    // Don't set up global awslambda for URL endpoint tests - we want to test API Gateway path
    // Only set it up if needed for other tests
    // global.awslambda = undefined; // Explicitly undefined for API Gateway tests

    return {
      mockStreamifyResponse: mockStreamifyResponseFn,
      mockHttpResponseStreamFrom: mockHttpResponseStreamFromFn,
      mockGetDefined: vi.fn((value) => {
        // getDefined checks if value is defined, if not it throws
        // In our case, awslambda should be defined, so return it
        if (value === undefined || value === null) {
          throw new Error("Value is not defined");
        }
        return value;
      }),
    };
  });

// Mock lambda-stream
const mockIsInAWS = vi.fn(() => false); // Default to false for API Gateway tests
vi.mock("lambda-stream", () => ({
  isInAWS: mockIsInAWS,
  streamifyResponse: mockStreamifyResponse,
}));

// Mock CloudFormationClient
vi.mock("@aws-sdk/client-cloudformation", () => ({
  CloudFormationClient: mockCloudFormationModule.CloudFormationClientClass,
  DescribeStacksCommand: mockCloudFormationModule.DescribeStacksCommandClass,
}));

// Export the mock send function for use in tests
const { mockCloudFormationSend } = mockCloudFormationModule;

// Mock all the complex dependencies
vi.mock("../../tables", () => ({
  database: vi.fn(),
}));

vi.mock("../../utils/conversationLogger", () => ({
  extractTokenUsage: vi.fn(),
  startConversation: vi.fn(),
}));

vi.mock("../../utils/creditErrors", () => ({
  InsufficientCreditsError: class extends Error {
    constructor(
      public workspaceId: string,
      public required: number,
      public available: number,
      public currency: string
    ) {
      super("Insufficient credits");
    }
  },
  SpendingLimitExceededError: class extends Error {
    constructor(public failedLimits: string[]) {
      super("Spending limit exceeded");
    }
  },
}));

vi.mock("../../utils/creditManagement", () => ({
  adjustCreditReservation: vi.fn(),
  refundReservation: vi.fn(),
}));

vi.mock("../../utils/creditValidation", () => ({
  validateCreditsAndLimitsAndReserve: vi.fn(),
}));

vi.mock("../../utils/featureFlags", () => ({
  isCreditDeductionEnabled: vi.fn(() => true),
}));

vi.mock("../../utils/httpEventAdapter", () => ({
  transformLambdaUrlToHttpV2Event: vi.fn((event) => event),
}));

vi.mock("../../utils/requestTracking", () => ({
  checkDailyRequestLimit: vi.fn(),
  incrementRequestBucket: vi.fn(),
}));

vi.mock("../../utils/sentry", () => ({
  initSentry: vi.fn(),
  Sentry: {
    captureException: vi.fn(),
  },
  flushSentry: vi.fn(),
  ensureError: vi.fn((error) => error),
}));

vi.mock("../../utils/streamServerUtils", () => ({
  getAllowedOrigins: vi.fn(),
  validateSecret: vi.fn(),
}));

vi.mock("../../utils/subscriptionUtils", () => ({
  checkFreePlanExpiration: vi.fn(),
  getWorkspaceSubscription: vi.fn(),
}));

vi.mock("../utils/agentSetup", () => ({
  logToolDefinitions: vi.fn(),
  setupAgentAndTools: vi.fn(),
}));

vi.mock("../utils/messageConversion", () => ({
  convertTextToUIMessage: vi.fn(),
  convertUIMessagesToModelMessages: vi.fn(),
}));

vi.mock("../../http/utils/agentUtils", () => ({
  MODEL_NAME: "test-model",
  buildGenerateTextOptions: vi.fn(() => ({})),
}));

vi.mock("ai", () => ({
  convertToModelMessages: vi.fn(),
  streamText: vi.fn(),
}));

// Mock workspaceCreditContext module
const mockContext = {
  callbackWaitsForEmptyEventLoop: false,
  awsRequestId: "test-request-id",
  functionName: "test-function",
  functionVersion: "$LATEST",
  invokedFunctionArn: "arn:aws:lambda:us-east-1:123456789012:function:test",
  memoryLimitInMB: "512",
  getRemainingTimeInMillis: () => 300000,
  logGroupName: "/aws/lambda/test",
  logStreamName: "2024/01/01/[$LATEST]test",
  done: vi.fn(),
  fail: vi.fn(),
  succeed: vi.fn(),
  addWorkspaceCreditTransaction: vi.fn(),
};

vi.mock("../../utils/workspaceCreditContext", () => ({
  getContextFromRequestId: vi.fn(() => mockContext),
  augmentContextWithCreditTransactions: vi.fn((context) => ({
    ...context,
    addWorkspaceCreditTransaction: vi.fn(),
  })),
  setCurrentHTTPContext: vi.fn(),
  clearCurrentHTTPContext: vi.fn(),
}));

// Mock getDefined to return the awslambda object
vi.mock("@/utils", () => ({
  getDefined: mockGetDefined,
}));

// Import handler dynamically to allow cache clearing between tests
let handler: typeof import("../index")["handler"];

describe("any-api-streams-000workspaceId-000agentId-000secret handler", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockStreamifyResponse.mockImplementation((handler) => handler);
    mockHttpResponseStreamFrom.mockImplementation((stream) => stream);
    mockIsInAWS.mockReturnValue(false); // Default to false for API Gateway tests
    mockCloudFormationSend.mockClear();
    // Reset environment variables
    delete process.env.STREAMING_FUNCTION_URL;
    delete process.env.AWS_STACK_NAME;
    delete process.env.ARC_STACK_NAME;
    delete process.env.STACK_NAME;
    // Ensure awslambda is undefined for API Gateway tests (URL endpoint tests)
    // @ts-expect-error - We're explicitly setting it to undefined for testing
    global.awslambda = undefined;
    // Clear module cache to reset cachedFunctionUrl and cacheExpiry
    // This is needed because the URL endpoint caches the Function URL
    vi.resetModules();
    // Re-import handler after resetting modules to get fresh cache state
    const handlerModule = await import("../index");
    handler = handlerModule.handler;
  });

  it("should export a handler function", () => {
    // Verify the handler is properly exported and is a function
    expect(handler).toBeDefined();
    expect(typeof handler).toBe("function");
  });

  describe("GET /api/streams/url endpoint", () => {
    let mockContext: ReturnType<typeof createMockContext>;
    let mockCallback: ReturnType<typeof createMockCallback>;

    beforeEach(() => {
      mockContext = createMockContext();
      mockCallback = createMockCallback();
    });

    it("should return streaming function URL from environment variable", async () => {
      process.env.STREAMING_FUNCTION_URL = "https://example.com/stream";

      const event = createAPIGatewayEventV2({
        routeKey: "GET /api/streams/url",
        rawPath: "/api/streams/url",
      });

      const result = (await (
        handler as (
          event: APIGatewayProxyEventV2,
          context: Context,
          callback: Callback
        ) => Promise<unknown>
      )(event, mockContext, mockCallback)) as {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      };

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.url).toBe("https://example.com/stream");
      expect(mockCloudFormationSend).not.toHaveBeenCalled();
    });

    it("should normalize URL by removing trailing slash", async () => {
      process.env.STREAMING_FUNCTION_URL = "https://example.com/stream/";

      const event = createAPIGatewayEventV2({
        routeKey: "GET /api/streams/url",
        rawPath: "/api/streams/url",
      });

      const result = (await (
        handler as (
          event: APIGatewayProxyEventV2,
          context: Context,
          callback: Callback
        ) => Promise<unknown>
      )(event, mockContext, mockCallback)) as {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      };

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.url).toBe("https://example.com/stream");
    });

    it("should return URL from CloudFormation stack output", async () => {
      process.env.AWS_STACK_NAME = "test-stack";

      const mockStackOutput = {
        Stacks: [
          {
            Outputs: [
              {
                OutputKey: "StreamingFunctionUrl",
                OutputValue: "https://stream.example.com",
              },
            ],
          },
        ],
      };

      mockCloudFormationSend.mockResolvedValue(mockStackOutput);

      const event = createAPIGatewayEventV2({
        routeKey: "GET /api/streams/url",
        rawPath: "/api/streams/url",
      });

      const result = (await (
        handler as (
          event: APIGatewayProxyEventV2,
          context: Context,
          callback: Callback
        ) => Promise<unknown>
      )(event, mockContext, mockCallback)) as {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      };

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.url).toBe("https://stream.example.com");
      expect(mockCloudFormationSend).toHaveBeenCalled();
    });

    it("should use ARC_STACK_NAME if AWS_STACK_NAME is not set", async () => {
      process.env.ARC_STACK_NAME = "arc-stack";

      const mockStackOutput = {
        Stacks: [
          {
            Outputs: [
              {
                OutputKey: "StreamingFunctionUrl",
                OutputValue: "https://arc-stream.example.com",
              },
            ],
          },
        ],
      };

      mockCloudFormationSend.mockResolvedValue(mockStackOutput);

      const event = createAPIGatewayEventV2({
        routeKey: "GET /api/streams/url",
        rawPath: "/api/streams/url",
      });

      const result = (await (
        handler as (
          event: APIGatewayProxyEventV2,
          context: Context,
          callback: Callback
        ) => Promise<unknown>
      )(event, mockContext, mockCallback)) as {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      };

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.url).toBe("https://arc-stream.example.com");
    });

    it("should use STACK_NAME if other stack name env vars are not set", async () => {
      process.env.STACK_NAME = "fallback-stack";

      const mockStackOutput = {
        Stacks: [
          {
            Outputs: [
              {
                OutputKey: "StreamingFunctionUrl",
                OutputValue: "https://fallback-stream.example.com",
              },
            ],
          },
        ],
      };

      mockCloudFormationSend.mockResolvedValue(mockStackOutput);

      const event = createAPIGatewayEventV2({
        routeKey: "GET /api/streams/url",
        rawPath: "/api/streams/url",
      });

      const result = (await (
        handler as (
          event: APIGatewayProxyEventV2,
          context: Context,
          callback: Callback
        ) => Promise<unknown>
      )(event, mockContext, mockCallback)) as {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      };

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.url).toBe("https://fallback-stream.example.com");
    });

    it("should return 404 when no URL is found", async () => {
      // No environment variables set
      mockCloudFormationSend.mockResolvedValue({
        Stacks: [
          {
            Outputs: [],
          },
        ],
      });

      const event = createAPIGatewayEventV2({
        routeKey: "GET /api/streams/url",
        rawPath: "/api/streams/url",
      });

      const result = (await (
        handler as (
          event: APIGatewayProxyEventV2,
          context: Context,
          callback: Callback
        ) => Promise<unknown>
      )(event, mockContext, mockCallback)) as {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      };

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error).toContain("Streaming function URL not configured");
    });

    it("should return 404 when stack name is not found", async () => {
      // No stack name environment variables set

      const event = createAPIGatewayEventV2({
        routeKey: "GET /api/streams/url",
        rawPath: "/api/streams/url",
      });

      const result = (await (
        handler as (
          event: APIGatewayProxyEventV2,
          context: Context,
          callback: Callback
        ) => Promise<unknown>
      )(event, mockContext, mockCallback)) as {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      };

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error).toContain("Streaming function URL not configured");
      expect(mockCloudFormationSend).not.toHaveBeenCalled();
    });

    it("should return 404 when CloudFormation call fails", async () => {
      process.env.AWS_STACK_NAME = "test-stack";
      mockCloudFormationSend.mockRejectedValue(new Error("Stack not found"));

      const event = createAPIGatewayEventV2({
        routeKey: "GET /api/streams/url",
        rawPath: "/api/streams/url",
      });

      const result = (await (
        handler as (
          event: APIGatewayProxyEventV2,
          context: Context,
          callback: Callback
        ) => Promise<unknown>
      )(event, mockContext, mockCallback)) as {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      };

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error).toContain("Streaming function URL not configured");
    });

    it("should return 404 when stack has no outputs", async () => {
      process.env.AWS_STACK_NAME = "test-stack";
      mockCloudFormationSend.mockResolvedValue({
        Stacks: [{}],
      });

      const event = createAPIGatewayEventV2({
        routeKey: "GET /api/streams/url",
        rawPath: "/api/streams/url",
      });

      const result = (await (
        handler as (
          event: APIGatewayProxyEventV2,
          context: Context,
          callback: Callback
        ) => Promise<unknown>
      )(event, mockContext, mockCallback)) as {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      };

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error).toContain("Streaming function URL not configured");
    });

    it("should reject non-GET methods", async () => {
      const event = createAPIGatewayEventV2({
        routeKey: "POST /api/streams/url",
        rawPath: "/api/streams/url",
      });
      // Override the method in requestContext
      event.requestContext.http.method = "POST";

      const result = (await (
        handler as (
          event: APIGatewayProxyEventV2,
          context: Context,
          callback: Callback
        ) => Promise<unknown>
      )(event, mockContext, mockCallback)) as {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      };

      expect(result.statusCode).toBe(406);
      const body = JSON.parse(result.body);
      expect(body.error).toContain("Only GET method is allowed");
    });

    // Note: Event normalization, path extraction, and REST API v1 handling
    // are now tested in dedicated utility test files:
    // - streamEventNormalization.test.ts
    // - streamPathExtraction.test.ts
  });
});
