import { beforeEach, describe, expect, it, vi } from "vitest";

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
const { mockGetDefined, mockStreamifyResponse, mockHttpResponseStreamFrom } =
  vi.hoisted(() => {
    const mockStreamifyResponseFn = vi.fn((handler) => handler);
    const mockHttpResponseStreamFromFn = vi.fn((stream) => stream);

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
vi.mock("lambda-stream", () => ({
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
    mockCloudFormationSend.mockClear();
    // Reset environment variables
    // Clear module cache
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
});
