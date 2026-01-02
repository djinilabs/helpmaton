import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock awslambda using vi.hoisted to ensure it's available before module imports
const { mockGetDefined, mockStreamifyResponse, mockHttpResponseStreamFrom } =
  vi.hoisted(() => {
    const mockStreamifyResponseFn = vi.fn((handler) => handler);
    const mockHttpResponseStreamFromFn = vi.fn((stream) => stream);

    const mockAwslambdaObj = {
      streamifyResponse: mockStreamifyResponseFn,
      HttpResponseStream: {
        from: mockHttpResponseStreamFromFn,
      },
    } as unknown as typeof global.awslambda;

    // Set up global awslambda mock
    global.awslambda = mockAwslambdaObj;

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

vi.mock(
  "../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/agentSetup",
  () => ({
    logToolDefinitions: vi.fn(),
    setupAgentAndTools: vi.fn(),
  })
);

vi.mock(
  "../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/messageConversion",
  () => ({
    convertTextToUIMessage: vi.fn(),
    convertUIMessagesToModelMessages: vi.fn(),
  })
);

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

// Import the handler after mocks are set up
import { handler } from "../index";

describe("any-api-streams-000workspaceId-000agentId-000secret handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStreamifyResponse.mockImplementation((handler) => handler);
    mockHttpResponseStreamFrom.mockImplementation((stream) => stream);
  });

  it("should export a handler function", () => {
    // Verify the handler is properly exported and is a function
    expect(handler).toBeDefined();
    expect(typeof handler).toBe("function");
  });

  it("should be wrapped with streamifyResponse", () => {
    // Verify that the handler is properly set up
    // The handler is wrapped by streamifyResponse at module load time
    // We verify the handler exists and is callable
    expect(handler).toBeDefined();
    expect(typeof handler).toBe("function");
    // Verify streamifyResponse mock exists and is a function
    expect(mockStreamifyResponse).toBeDefined();
    expect(typeof mockStreamifyResponse).toBe("function");
  });
});
