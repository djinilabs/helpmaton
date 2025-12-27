import { badRequest, unauthorized } from "@hapi/boom";
import { generateText } from "ai";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { AugmentedContext } from "../../../utils/workspaceCreditContext";
// eslint-disable-next-line import/order
import {
  createAPIGatewayEventV2,
  createMockContext,
  createMockCallback,
  createMockDatabase,
} from "../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const {
  mockDatabase,
  mockValidateWebhookRequest,
  mockValidateWebhookKey,
  mockCheckFreePlanExpiration,
  mockGetWorkspaceSubscription,
  mockCheckDailyRequestLimit,
  mockSetupAgentAndTools,
  mockConvertTextToUIMessage,
  mockConvertUIMessagesToModelMessages,
  mockValidateCreditsAndLimitsAndReserve,
  mockBuildGenerateTextOptions,
  mockExtractTokenUsage,
  mockAdjustCreditReservation,
  mockStartConversation,
  mockProcessSimpleNonStreamingResponse,
  mockFormatToolCallMessage,
  mockFormatToolResultMessage,
  mockIsCreditDeductionEnabled,
  mockExtractTokenUsageAndCosts,
  mockAdjustCreditsAfterLLMCall,
  mockEnqueueCostVerificationIfNeeded,
} = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockValidateWebhookRequest: vi.fn(),
    mockValidateWebhookKey: vi.fn(),
    mockCheckFreePlanExpiration: vi.fn(),
    mockGetWorkspaceSubscription: vi.fn(),
    mockCheckDailyRequestLimit: vi.fn(),
    mockSetupAgentAndTools: vi.fn(),
    mockConvertTextToUIMessage: vi.fn(),
    mockConvertUIMessagesToModelMessages: vi.fn(),
    mockValidateCreditsAndLimitsAndReserve: vi.fn(),
    mockBuildGenerateTextOptions: vi.fn(),
    mockExtractTokenUsage: vi.fn(),
    mockAdjustCreditReservation: vi.fn(),
    mockStartConversation: vi.fn(),
    mockProcessSimpleNonStreamingResponse: vi.fn(),
    mockFormatToolCallMessage: vi.fn(),
    mockFormatToolResultMessage: vi.fn(),
    mockIsCreditDeductionEnabled: vi.fn(),
    mockExtractTokenUsageAndCosts: vi.fn(),
    mockAdjustCreditsAfterLLMCall: vi.fn(),
    mockEnqueueCostVerificationIfNeeded: vi.fn(),
  };
});

// Mock the modules
vi.mock("../../../tables", () => ({
  database: mockDatabase,
}));

// Mock @architect/functions for database initialization
vi.mock("@architect/functions", () => ({
  tables: vi.fn().mockResolvedValue({
    reflect: vi.fn().mockResolvedValue({}),
    _client: {},
  }),
}));

vi.mock(
  "../../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/requestValidation",
  () => ({
    validateWebhookRequest: mockValidateWebhookRequest,
    validateWebhookKey: mockValidateWebhookKey,
  })
);

vi.mock("../../../utils/subscriptionUtils", () => ({
  checkFreePlanExpiration: mockCheckFreePlanExpiration,
  getWorkspaceSubscription: mockGetWorkspaceSubscription,
}));

vi.mock("../../../utils/requestTracking", () => ({
  checkDailyRequestLimit: mockCheckDailyRequestLimit,
  incrementRequestBucket: vi.fn(),
}));

vi.mock(
  "../../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/agentSetup",
  () => ({
    setupAgentAndTools: mockSetupAgentAndTools,
    logToolDefinitions: vi.fn(),
  })
);

vi.mock(
  "../../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/messageConversion",
  () => ({
    convertTextToUIMessage: mockConvertTextToUIMessage,
    convertUIMessagesToModelMessages: mockConvertUIMessagesToModelMessages,
  })
);

vi.mock("../../../utils/creditValidation", () => ({
  validateCreditsAndLimitsAndReserve: vi.fn(),
}));

vi.mock("../../utils/agentUtils", () => ({
  buildGenerateTextOptions: mockBuildGenerateTextOptions,
  MODEL_NAME: "gemini-2.5-flash",
}));

vi.mock("ai", async () => {
  const actual = await vi.importActual("ai");
  return {
    ...actual,
    generateText: vi.fn(),
  };
});

vi.mock("../../../utils/conversationLogger", async () => {
  const actual = await vi.importActual<
    typeof import("../../../utils/conversationLogger")
  >("../../../utils/conversationLogger");
  return {
    ...actual,
    extractTokenUsage: mockExtractTokenUsage,
    startConversation: mockStartConversation,
  };
});

vi.mock("../../../utils/creditManagement", () => ({
  adjustCreditReservation: mockAdjustCreditReservation,
  refundReservation: vi.fn(),
  adjustCreditsAfterLLMCall: mockAdjustCreditsAfterLLMCall,
  enqueueCostVerification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock(
  "../../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/streaming",
  () => ({
    processSimpleNonStreamingResponse: mockProcessSimpleNonStreamingResponse,
  })
);

// Mock workspaceCreditContext
const mockContext: AugmentedContext = {
  awsRequestId: "test-request-id",
  addWorkspaceCreditTransaction: vi.fn(),
  getRemainingTimeInMillis: () => 30000,
  functionName: "test-function",
  functionVersion: "$LATEST",
  invokedFunctionArn: "arn:aws:lambda:us-east-1:123456789012:function:test",
  memoryLimitInMB: "128",
  logGroupName: "/aws/lambda/test",
  logStreamName: "2024/01/01/[$LATEST]test",
  callbackWaitsForEmptyEventLoop: true,
  succeed: vi.fn(),
  fail: vi.fn(),
  done: vi.fn(),
} as AugmentedContext;

vi.mock("../../../utils/workspaceCreditContext", () => ({
  getContextFromRequestId: vi.fn(() => mockContext),
  augmentContextWithCreditTransactions: vi.fn((context) => ({
    ...context,
    addWorkspaceCreditTransaction: vi.fn(),
  })),
  commitContextTransactions: vi.fn().mockResolvedValue(undefined),
  setCurrentHTTPContext: vi.fn(),
  clearCurrentHTTPContext: vi.fn(),
}));

vi.mock(
  "../../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/toolFormatting",
  () => ({
    formatToolCallMessage: mockFormatToolCallMessage,
    formatToolResultMessage: mockFormatToolResultMessage,
  })
);

vi.mock("../../../utils/featureFlags", () => ({
  isCreditDeductionEnabled: mockIsCreditDeductionEnabled,
}));

vi.mock("../../utils/generationTokenExtraction", () => ({
  extractTokenUsageAndCosts: mockExtractTokenUsageAndCosts,
}));

vi.mock("../../utils/generationCreditManagement", () => ({
  adjustCreditsAfterLLMCall: mockAdjustCreditsAfterLLMCall,
  cleanupReservationOnError: vi.fn(),
  cleanupReservationWithoutTokenUsage: vi.fn(),
  enqueueCostVerificationIfNeeded: mockEnqueueCostVerificationIfNeeded,
  validateAndReserveCredits: mockValidateCreditsAndLimitsAndReserve,
}));

// Import the handler after mocks are set up
import { handler } from "../index";

describe("post-api-webhook-000workspaceId-000agentId-000key handler", () => {
  const mockContext = createMockContext();
  const mockCallback = createMockCallback();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should successfully process webhook request and return response", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const key = "key-789";
    const bodyText = "Hello, agent!";

    mockValidateWebhookRequest.mockReturnValue({
      workspaceId,
      agentId,
      key,
      bodyText,
    });
    // validateWebhookKey is async and doesn't return a value on success
    mockValidateWebhookKey.mockResolvedValue(undefined);
    mockCheckFreePlanExpiration.mockResolvedValue(undefined);

    const mockSubscription = {
      pk: "subscriptions/sub-123",
      plan: "pro" as const,
    };
    mockGetWorkspaceSubscription.mockResolvedValue(mockSubscription);
    mockCheckDailyRequestLimit.mockResolvedValue(undefined);

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      name: "Test Agent",
      systemPrompt: "You are helpful",
      provider: "google" as const,
    };

    const mockModel = {};
    const mockTools = {};
    mockSetupAgentAndTools.mockResolvedValue({
      agent: mockAgent,
      model: mockModel,
      tools: mockTools,
      usesByok: false,
    });

    mockConvertTextToUIMessage.mockReturnValue({
      role: "user",
      content: bodyText,
    });

    mockConvertUIMessagesToModelMessages.mockReturnValue([
      {
        role: "user",
        content: bodyText,
      },
    ]);

    mockValidateCreditsAndLimitsAndReserve.mockResolvedValue("reservation-123");

    mockBuildGenerateTextOptions.mockReturnValue({
      temperature: 0.7,
      maxTokens: 2048,
    });

    const mockGenerateTextResult = {
      text: "Hello! How can I help you?",
      usage: {
        promptTokens: 10,
        completionTokens: 5,
      },
    };

    vi.mocked(generateText).mockResolvedValue(
      mockGenerateTextResult as unknown as Awaited<
        ReturnType<typeof generateText>
      >
    );

    mockExtractTokenUsageAndCosts.mockReturnValue({
      tokenUsage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      },
      openrouterGenerationId: undefined,
      openrouterGenerationIds: [],
      provisionalCostUsd: 1000, // 0.001 USD in millionths
    });

    mockIsCreditDeductionEnabled.mockReturnValue(true);
    mockAdjustCreditsAfterLLMCall.mockResolvedValue(undefined);
    mockEnqueueCostVerificationIfNeeded.mockResolvedValue(undefined);

    mockStartConversation.mockResolvedValue("conversation-id-123");

    // processSimpleNonStreamingResponse returns a string (the text content)
    mockProcessSimpleNonStreamingResponse.mockResolvedValue(
      "Hello! How can I help you?"
    );

    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const baseEvent = createAPIGatewayEventV2({
      routeKey: "POST /api/webhook/workspace-123/agent-456/key-789",
      rawPath: "/api/webhook/workspace-123/agent-456/key-789",
      body: bodyText,
    });
    const event = {
      ...baseEvent,
      requestContext: {
        ...baseEvent.requestContext,
        http: {
          ...baseEvent.requestContext.http,
          method: "POST",
        },
      },
      pathParameters: {
        workspaceId,
        agentId,
        key,
      },
    };

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(result.statusCode).toBe(200);
    // Webhook returns plain text, not JSON
    expect(result.body).toBe("Hello! How can I help you?");
    expect(result.headers["Content-Type"]).toBe("text/plain; charset=utf-8");
    expect(mockValidateWebhookRequest).toHaveBeenCalledWith(event);
    expect(mockValidateWebhookKey).toHaveBeenCalledWith(
      workspaceId,
      agentId,
      key
    );
    expect(mockSetupAgentAndTools).toHaveBeenCalled();
    expect(vi.mocked(generateText)).toHaveBeenCalled();
  });

  it("should throw badRequest when validation fails", async () => {
    // Mock validateWebhookRequest to throw an error
    mockValidateWebhookRequest.mockImplementation(() => {
      throw badRequest("Invalid request format");
    });

    const event = createAPIGatewayEventV2({
      routeKey: "POST /api/webhook/workspace-123/agent-456/key-789",
      rawPath: "/api/webhook/workspace-123/agent-456/key-789",
      body: "test",
      requestContext: {
        ...createAPIGatewayEventV2().requestContext,
        http: {
          ...createAPIGatewayEventV2().requestContext.http,
          method: "POST",
        },
      },
      pathParameters: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
        key: "key-789",
      },
    });

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.message).toContain("Invalid request format");
  });

  it("should throw unauthorized when webhook key validation fails", async () => {
    mockValidateWebhookRequest.mockReturnValue({
      workspaceId: "workspace-123",
      agentId: "agent-456",
      key: "key-789",
      bodyText: "test",
    });
    mockValidateWebhookKey.mockRejectedValue(unauthorized("Invalid key"));

    const event = createAPIGatewayEventV2({
      routeKey: "POST /api/webhook/workspace-123/agent-456/key-789",
      rawPath: "/api/webhook/workspace-123/agent-456/key-789",
      body: "test",
      requestContext: {
        ...createAPIGatewayEventV2().requestContext,
        http: {
          ...createAPIGatewayEventV2().requestContext.http,
          method: "POST",
        },
      },
      pathParameters: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
        key: "key-789",
      },
    });

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body);
    expect(body.message).toContain("Invalid key");
  });

  it("should handle free plan expiration check", async () => {
    mockValidateWebhookRequest.mockReturnValue({
      workspaceId: "workspace-123",
      agentId: "agent-456",
      key: "key-789",
      bodyText: "test",
    });
    mockValidateWebhookKey.mockResolvedValue(undefined);
    mockCheckFreePlanExpiration.mockRejectedValue(
      badRequest("Free plan has expired")
    );

    const event = createAPIGatewayEventV2({
      routeKey: "POST /api/webhook/workspace-123/agent-456/key-789",
      rawPath: "/api/webhook/workspace-123/agent-456/key-789",
      body: "test",
      requestContext: {
        ...createAPIGatewayEventV2().requestContext,
        http: {
          ...createAPIGatewayEventV2().requestContext.http,
          method: "POST",
        },
      },
      pathParameters: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
        key: "key-789",
      },
    });

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.message).toContain("Free plan has expired");
  });

  it("should handle missing subscription gracefully", async () => {
    mockValidateWebhookRequest.mockReturnValue({
      workspaceId: "workspace-123",
      agentId: "agent-456",
      key: "key-789",
      bodyText: "test",
    });
    mockValidateWebhookKey.mockResolvedValue(undefined);
    mockCheckFreePlanExpiration.mockResolvedValue(undefined);
    mockGetWorkspaceSubscription.mockResolvedValue(undefined);

    const mockAgent = {
      pk: "agents/workspace-123/agent-456",
      name: "Test Agent",
      systemPrompt: "You are helpful",
      provider: "google" as const,
    };

    mockSetupAgentAndTools.mockResolvedValue({
      agent: mockAgent,
      model: {},
      tools: {},
      usesByok: false,
    });

    mockConvertTextToUIMessage.mockReturnValue({
      role: "user",
      content: "test",
    });

    mockConvertUIMessagesToModelMessages.mockReturnValue([
      {
        role: "user",
        content: "test",
      },
    ]);

    mockValidateCreditsAndLimitsAndReserve.mockResolvedValue("reservation-123");

    mockBuildGenerateTextOptions.mockReturnValue({});

    vi.mocked(generateText).mockResolvedValue({
      text: "response",
      usage: { promptTokens: 10, completionTokens: 5 },
    } as unknown as Awaited<ReturnType<typeof generateText>>);

    mockExtractTokenUsageAndCosts.mockReturnValue({
      tokenUsage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      },
      openrouterGenerationId: undefined,
      openrouterGenerationIds: [],
      provisionalCostUsd: 1000,
    });

    mockIsCreditDeductionEnabled.mockReturnValue(true);
    mockAdjustCreditsAfterLLMCall.mockResolvedValue(undefined);
    mockEnqueueCostVerificationIfNeeded.mockResolvedValue(undefined);
    mockStartConversation.mockResolvedValue("conv-id");
    mockProcessSimpleNonStreamingResponse.mockResolvedValue("response");

    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const event = createAPIGatewayEventV2({
      routeKey: "POST /api/webhook/workspace-123/agent-456/key-789",
      rawPath: "/api/webhook/workspace-123/agent-456/key-789",
      body: "test",
      requestContext: {
        ...createAPIGatewayEventV2().requestContext,
        http: {
          ...createAPIGatewayEventV2().requestContext.http,
          method: "POST",
        },
      },
      pathParameters: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
        key: "key-789",
      },
    });

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    // Should still process even without subscription
    expect(result.statusCode).toBe(200);
    expect(mockCheckDailyRequestLimit).not.toHaveBeenCalled();
  });

  it("should handle LLM call errors and refund credits", async () => {
    mockValidateWebhookRequest.mockReturnValue({
      workspaceId: "workspace-123",
      agentId: "agent-456",
      key: "key-789",
      bodyText: "test",
    });
    mockValidateWebhookKey.mockResolvedValue(undefined);
    mockCheckFreePlanExpiration.mockResolvedValue(undefined);
    mockGetWorkspaceSubscription.mockResolvedValue({
      pk: "subscriptions/sub-123",
      plan: "pro" as const,
    });
    mockCheckDailyRequestLimit.mockResolvedValue(undefined);

    mockSetupAgentAndTools.mockResolvedValue({
      agent: {
        pk: "agents/workspace-123/agent-456",
        name: "Test Agent",
        systemPrompt: "You are helpful",
        provider: "google" as const,
      },
      model: {},
      tools: {},
      usesByok: false,
    });

    mockConvertTextToUIMessage.mockReturnValue({
      role: "user",
      content: "test",
    });

    mockConvertUIMessagesToModelMessages.mockReturnValue([
      {
        role: "user",
        content: "test",
      },
    ]);

    mockValidateCreditsAndLimitsAndReserve.mockResolvedValue("reservation-123");

    mockBuildGenerateTextOptions.mockReturnValue({});

    const llmError = new Error("LLM API error");
    vi.mocked(generateText).mockRejectedValue(llmError);

    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const event = createAPIGatewayEventV2({
      routeKey: "POST /api/webhook/workspace-123/agent-456/key-789",
      rawPath: "/api/webhook/workspace-123/agent-456/key-789",
      body: "test",
      requestContext: {
        ...createAPIGatewayEventV2().requestContext,
        http: {
          ...createAPIGatewayEventV2().requestContext.http,
          method: "POST",
        },
      },
      pathParameters: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
        key: "key-789",
      },
    });

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.message).toBeDefined();
  });

  it("should record tool calls in conversation when tools are used", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const key = "key-789";
    const bodyText = "Search for documents about testing";

    mockValidateWebhookRequest.mockReturnValue({
      workspaceId,
      agentId,
      key,
      bodyText,
    });
    mockValidateWebhookKey.mockResolvedValue(undefined);
    mockCheckFreePlanExpiration.mockResolvedValue(undefined);

    const mockSubscription = {
      pk: "subscriptions/sub-123",
      plan: "pro" as const,
    };
    mockGetWorkspaceSubscription.mockResolvedValue(mockSubscription);
    mockCheckDailyRequestLimit.mockResolvedValue(undefined);

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      name: "Test Agent",
      systemPrompt: "You are helpful",
      provider: "google" as const,
    };

    const mockModel = {};
    const mockTools = {
      searchDocuments: {
        description: "Search documents",
        inputSchema: {},
      },
    };
    mockSetupAgentAndTools.mockResolvedValue({
      agent: mockAgent,
      model: mockModel,
      tools: mockTools,
      usesByok: false,
    });

    mockConvertTextToUIMessage.mockReturnValue({
      role: "user",
      content: bodyText,
    });

    mockConvertUIMessagesToModelMessages.mockReturnValue([
      {
        role: "user",
        content: bodyText,
      },
    ]);

    mockValidateCreditsAndLimitsAndReserve.mockResolvedValue("reservation-123");

    mockBuildGenerateTextOptions.mockReturnValue({
      temperature: 0.7,
      maxTokens: 2048,
    });

    // Mock generateText result with tool calls and results
    const mockToolCall = {
      toolCallId: "call-123",
      toolName: "searchDocuments",
      args: { query: "testing" },
    };

    const mockToolResult = {
      toolCallId: "call-123",
      toolName: "searchDocuments",
      result: "Found 3 documents about testing",
    };

    const mockGenerateTextResult = {
      text: "I found some documents about testing.",
      toolCalls: [mockToolCall],
      toolResults: [mockToolResult],
      usage: {
        promptTokens: 20,
        completionTokens: 10,
      },
    };

    vi.mocked(generateText).mockResolvedValue(
      mockGenerateTextResult as unknown as Awaited<
        ReturnType<typeof generateText>
      >
    );

    mockExtractTokenUsageAndCosts.mockReturnValue({
      tokenUsage: {
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
      },
      openrouterGenerationId: undefined,
      openrouterGenerationIds: [],
      provisionalCostUsd: 2000, // 0.002 USD in millionths
    });

    mockIsCreditDeductionEnabled.mockReturnValue(true);
    mockAdjustCreditsAfterLLMCall.mockResolvedValue(undefined);
    mockEnqueueCostVerificationIfNeeded.mockResolvedValue(undefined);

    // Mock formatToolCallMessage to return formatted tool call message
    const formattedToolCallMessage = {
      role: "assistant" as const,
      content: [
        {
          type: "tool-call" as const,
          toolCallId: "call-123",
          toolName: "searchDocuments",
          args: { query: "testing" },
        },
      ],
    };

    const formattedToolResultMessage = {
      role: "assistant" as const,
      content: [
        {
          type: "tool-result" as const,
          toolCallId: "call-123",
          toolName: "searchDocuments",
          result: "Found 3 documents about testing",
        },
      ],
    };

    mockFormatToolCallMessage.mockReturnValue(formattedToolCallMessage);
    mockFormatToolResultMessage.mockReturnValue(formattedToolResultMessage);

    mockStartConversation.mockResolvedValue("conversation-id-123");

    mockProcessSimpleNonStreamingResponse.mockResolvedValue(
      "I found some documents about testing."
    );

    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const baseEvent = createAPIGatewayEventV2({
      routeKey: "POST /api/webhook/workspace-123/agent-456/key-789",
      rawPath: "/api/webhook/workspace-123/agent-456/key-789",
      body: bodyText,
    });
    const event = {
      ...baseEvent,
      requestContext: {
        ...baseEvent.requestContext,
        http: {
          ...baseEvent.requestContext.http,
          method: "POST",
        },
      },
      pathParameters: {
        workspaceId,
        agentId,
        key,
      },
    };

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(result.statusCode).toBe(200);
    expect(result.body).toBe("I found some documents about testing.");

    // Verify startConversation was called
    expect(mockStartConversation).toHaveBeenCalled();

    // Get the call arguments to verify tool calls are included
    const startConversationCalls = mockStartConversation.mock.calls;
    expect(startConversationCalls.length).toBeGreaterThan(0);

    const conversationData = startConversationCalls[0][1];
    expect(conversationData.workspaceId).toBe(workspaceId);
    expect(conversationData.agentId).toBe(agentId);
    expect(conversationData.conversationType).toBe("webhook");

    // Verify messages include tool calls
    const messages = conversationData.messages;
    expect(Array.isArray(messages)).toBe(true);
    expect(messages.length).toBe(2); // user message + assistant message

    const assistantMessage = messages.find(
      (msg: { role: string }) => msg.role === "assistant"
    );
    expect(assistantMessage).toBeDefined();
    expect(Array.isArray(assistantMessage.content)).toBe(true);

    const assistantContent = assistantMessage.content as Array<unknown>;
    const toolCallsInContent = assistantContent.filter(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        item.type === "tool-call"
    );
    const toolResultsInContent = assistantContent.filter(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        item.type === "tool-result"
    );

    // Verify tool calls and results are in the assistant message content
    expect(toolCallsInContent.length).toBe(1);
    expect(toolResultsInContent.length).toBe(1);
    expect(toolCallsInContent[0]).toMatchObject({
      type: "tool-call",
      toolCallId: "call-123",
      toolName: "searchDocuments",
    });
    expect(toolResultsInContent[0]).toMatchObject({
      type: "tool-result",
      toolCallId: "call-123",
      toolName: "searchDocuments",
    });
  });

  it("should extract tool calls from _steps when toolCalls is empty", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const key = "key-789";
    const bodyText = "Search for documents";

    mockValidateWebhookRequest.mockReturnValue({
      workspaceId,
      agentId,
      key,
      bodyText,
    });
    mockValidateWebhookKey.mockResolvedValue(undefined);
    mockCheckFreePlanExpiration.mockResolvedValue(undefined);

    const mockSubscription = {
      pk: "subscriptions/sub-123",
      plan: "pro" as const,
    };
    mockGetWorkspaceSubscription.mockResolvedValue(mockSubscription);
    mockCheckDailyRequestLimit.mockResolvedValue(undefined);

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      name: "Test Agent",
      systemPrompt: "You are helpful",
      provider: "google" as const,
    };

    mockSetupAgentAndTools.mockResolvedValue({
      agent: mockAgent,
      model: {},
      tools: {
        searchDocuments: {
          description: "Search documents",
          inputSchema: {},
        },
      },
      usesByok: false,
    });

    mockConvertTextToUIMessage.mockReturnValue({
      role: "user",
      content: bodyText,
    });

    mockConvertUIMessagesToModelMessages.mockReturnValue([
      {
        role: "user",
        content: bodyText,
      },
    ]);

    mockValidateCreditsAndLimitsAndReserve.mockResolvedValue("reservation-123");

    mockBuildGenerateTextOptions.mockReturnValue({});

    // Mock generateText result with tool calls in _steps but not in toolCalls
    const mockGenerateTextResult = {
      text: "I found documents.",
      toolCalls: [], // Empty - tool calls are in _steps
      toolResults: [], // Empty - tool results are in _steps
      usage: {
        promptTokens: 20,
        completionTokens: 10,
      },
      _steps: {
        status: {
          value: [
            {
              content: [
                {
                  type: "tool-call",
                  toolCallId: "call-456",
                  toolName: "searchDocuments",
                  input: { query: "documents" },
                },
              ],
            },
            {
              content: [
                {
                  type: "tool-result",
                  toolCallId: "call-456",
                  toolName: "searchDocuments",
                  output: { value: "Found 5 documents" },
                },
              ],
            },
          ],
        },
      },
    };

    vi.mocked(generateText).mockResolvedValue(
      mockGenerateTextResult as unknown as Awaited<
        ReturnType<typeof generateText>
      >
    );

    mockExtractTokenUsageAndCosts.mockReturnValue({
      tokenUsage: {
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
      },
      openrouterGenerationId: undefined,
      openrouterGenerationIds: [],
      provisionalCostUsd: 2000,
    });

    mockIsCreditDeductionEnabled.mockReturnValue(true);
    mockAdjustCreditsAfterLLMCall.mockResolvedValue(undefined);
    mockEnqueueCostVerificationIfNeeded.mockResolvedValue(undefined);

    // Mock formatToolCallMessage to return formatted tool call message
    const formattedToolCallMessage = {
      role: "assistant" as const,
      content: [
        {
          type: "tool-call" as const,
          toolCallId: "call-456",
          toolName: "searchDocuments",
          args: { query: "documents" },
        },
      ],
    };

    const formattedToolResultMessage = {
      role: "assistant" as const,
      content: [
        {
          type: "tool-result" as const,
          toolCallId: "call-456",
          toolName: "searchDocuments",
          result: "Found 5 documents",
        },
      ],
    };

    mockFormatToolCallMessage.mockReturnValue(formattedToolCallMessage);
    mockFormatToolResultMessage.mockReturnValue(formattedToolResultMessage);

    mockStartConversation.mockResolvedValue("conversation-id-456");
    mockProcessSimpleNonStreamingResponse.mockResolvedValue(
      "I found documents."
    );

    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const baseEvent = createAPIGatewayEventV2({
      routeKey: "POST /api/webhook/workspace-123/agent-456/key-789",
      rawPath: "/api/webhook/workspace-123/agent-456/key-789",
      body: bodyText,
    });
    const event = {
      ...baseEvent,
      requestContext: {
        ...baseEvent.requestContext,
        http: {
          ...baseEvent.requestContext.http,
          method: "POST",
        },
      },
      pathParameters: {
        workspaceId,
        agentId,
        key,
      },
    };

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(result.statusCode).toBe(200);

    // Verify startConversation was called
    expect(mockStartConversation).toHaveBeenCalled();

    // Get the call arguments to verify tool calls from _steps are included
    const startConversationCalls = mockStartConversation.mock.calls;
    expect(startConversationCalls.length).toBeGreaterThan(0);

    const conversationData = startConversationCalls[0][1];
    const messages = conversationData.messages;

    const assistantMessage = messages.find(
      (msg: { role: string }) => msg.role === "assistant"
    );
    expect(assistantMessage).toBeDefined();
    expect(Array.isArray(assistantMessage.content)).toBe(true);

    const assistantContent = assistantMessage.content as Array<unknown>;
    const toolCallsInContent = assistantContent.filter(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        item.type === "tool-call"
    );
    const toolResultsInContent = assistantContent.filter(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        item.type === "tool-result"
    );

    // Verify tool calls and results from _steps are in the assistant message
    expect(toolCallsInContent.length).toBe(1);
    expect(toolResultsInContent.length).toBe(1);
    expect(toolCallsInContent[0]).toMatchObject({
      type: "tool-call",
      toolCallId: "call-456",
      toolName: "searchDocuments",
    });
  });

  it("should extract tool calls, token usage, and costs from result.steps structure (generateText format)", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const key = "key-789";
    const bodyText = "Search for documents";

    mockValidateWebhookRequest.mockReturnValue({
      workspaceId,
      agentId,
      key,
      bodyText,
    });
    mockValidateWebhookKey.mockResolvedValue(undefined);
    mockCheckFreePlanExpiration.mockResolvedValue(undefined);

    const mockSubscription = {
      pk: "subscriptions/sub-123",
      plan: "pro" as const,
    };
    mockGetWorkspaceSubscription.mockResolvedValue(mockSubscription);
    mockCheckDailyRequestLimit.mockResolvedValue(undefined);

    mockSetupAgentAndTools.mockResolvedValue({
      agent: {
        pk: `agents/${workspaceId}/${agentId}`,
        name: "Test Agent",
        systemPrompt: "You are helpful",
        provider: "google" as const,
      },
      model: {},
      tools: {
        searchDocuments: {
          description: "Search documents",
          inputSchema: {},
        },
      },
      usesByok: false,
    });

    mockConvertTextToUIMessage.mockReturnValue({
      role: "user",
      content: bodyText,
    });

    mockConvertUIMessagesToModelMessages.mockReturnValue([
      {
        role: "user",
        content: bodyText,
      },
    ]);

    mockValidateCreditsAndLimitsAndReserve.mockResolvedValue("reservation-123");

    mockBuildGenerateTextOptions.mockReturnValue({});

    // Mock generateText result with steps array (generateText format, not _steps)
    // This matches the actual structure from CloudWatch logs
    // totalUsage aggregates usage from all steps automatically
    const step1Usage = {
      promptTokens: 524,
      completionTokens: 9,
      totalTokens: 533,
      reasoningTokens: 0,
      cachedPromptTokens: 0,
    };
    const step2Usage = {
      promptTokens: 594,
      completionTokens: 28,
      totalTokens: 622,
      reasoningTokens: 0,
      cachedPromptTokens: 0,
    };
    const mockGenerateTextResult = {
      text: "I found documents.",
      toolCalls: [], // Empty - tool calls are in steps
      toolResults: [], // Empty - tool results are in steps
      usage: undefined, // No top-level usage - it's in steps[].usage
      totalUsage: {
        // AI SDK provides totalUsage that aggregates all steps
        promptTokens: step1Usage.promptTokens + step2Usage.promptTokens, // 1118
        completionTokens: step1Usage.completionTokens + step2Usage.completionTokens, // 37
        totalTokens: step1Usage.totalTokens + step2Usage.totalTokens, // 1155
        reasoningTokens: 0,
        cachedPromptTokens: 0,
      },
      steps: [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "tool_search_abc123",
              toolName: "searchDocuments",
              input: { query: "documents" },
            },
            {
              type: "tool-result",
              toolCallId: "tool_search_abc123",
              toolName: "searchDocuments",
              output: {
                type: "text",
                value: "Found 5 documents",
              },
            },
          ],
          usage: step1Usage,
          response: {
            id: "gen-1766755634-mSZupEMPTYHYviRp0kbj",
          },
          providerMetadata: {
            openrouter: {
              usage: {
                cost: 0.0001797,
              },
            },
          },
        },
        {
          content: [
            {
              type: "text",
              text: "I found documents.",
            },
          ],
          usage: step2Usage,
          response: {
            id: "gen-1766755635-GhZIxomllM8bIk1B2vXN",
          },
          providerMetadata: {
            openrouter: {
              usage: {
                cost: 0.0002482,
              },
            },
          },
        },
      ],
    };

    vi.mocked(generateText).mockResolvedValue(
      mockGenerateTextResult as unknown as Awaited<
        ReturnType<typeof generateText>
      >
    );

    // Mock extractTokenUsageAndCosts to return aggregated values
    const expectedTokenUsage = {
      promptTokens: 1118, // 524 + 594
      completionTokens: 37, // 9 + 28
      totalTokens: 1155, // 533 + 622
    };
    const expectedCostUsd = Math.ceil(
      (0.0001797 + 0.0002482) * 1_000_000 * 1.055
    ); // Sum of costs with markup

    mockExtractTokenUsageAndCosts.mockReturnValue({
      tokenUsage: expectedTokenUsage,
      openrouterGenerationId: "gen-1766755634-mSZupEMPTYHYviRp0kbj",
      openrouterGenerationIds: [
        "gen-1766755634-mSZupEMPTYHYviRp0kbj",
        "gen-1766755635-GhZIxomllM8bIk1B2vXN",
      ],
      provisionalCostUsd: expectedCostUsd,
    });

    mockIsCreditDeductionEnabled.mockReturnValue(true);
    mockAdjustCreditsAfterLLMCall.mockResolvedValue(undefined);
    mockEnqueueCostVerificationIfNeeded.mockResolvedValue(undefined);

    // Mock formatToolCallMessage to return formatted tool call message
    const formattedToolCallMessage = {
      role: "assistant" as const,
      content: [
        {
          type: "tool-call" as const,
          toolCallId: "tool_search_abc123",
          toolName: "searchDocuments",
          args: { query: "documents" },
        },
      ],
    };

    const formattedToolResultMessage = {
      role: "assistant" as const,
      content: [
        {
          type: "tool-result" as const,
          toolCallId: "tool_search_abc123",
          toolName: "searchDocuments",
          result: "Found 5 documents",
        },
      ],
    };

    mockFormatToolCallMessage.mockReturnValue(formattedToolCallMessage);
    mockFormatToolResultMessage.mockReturnValue(formattedToolResultMessage);

    mockStartConversation.mockResolvedValue("conversation-id-steps");
    mockProcessSimpleNonStreamingResponse.mockResolvedValue(
      "I found documents."
    );

    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const baseEvent = createAPIGatewayEventV2({
      routeKey: "POST /api/webhook/workspace-123/agent-456/key-789",
      rawPath: "/api/webhook/workspace-123/agent-456/key-789",
      body: bodyText,
    });
    const event = {
      ...baseEvent,
      requestContext: {
        ...baseEvent.requestContext,
        http: {
          ...baseEvent.requestContext.http,
          method: "POST",
        },
      },
      pathParameters: {
        workspaceId,
        agentId,
        key,
      },
    };

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(result.statusCode).toBe(200);

    // Verify extractTokenUsageAndCosts was called with the result
    expect(mockExtractTokenUsageAndCosts).toHaveBeenCalled();

    // Verify startConversation was called
    expect(mockStartConversation).toHaveBeenCalled();

    // Get the call arguments to verify tool calls, token usage, and costs
    const startConversationCalls = mockStartConversation.mock.calls;
    const conversationData = startConversationCalls[0][1];

    // Verify token usage is passed
    expect(conversationData.tokenUsage).toEqual(expectedTokenUsage);

    // Verify messages include tool calls from steps
    const messages = conversationData.messages;
    const assistantMessage = messages.find(
      (msg: { role: string }) => msg.role === "assistant"
    );
    expect(assistantMessage).toBeDefined();
    expect(Array.isArray(assistantMessage.content)).toBe(true);

    const assistantContent = assistantMessage.content as Array<unknown>;
    const toolCallsInContent = assistantContent.filter(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        item.type === "tool-call"
    );
    const toolResultsInContent = assistantContent.filter(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        item.type === "tool-result"
    );

    // Verify tool calls and results from steps are in the assistant message
    expect(toolCallsInContent.length).toBe(1);
    expect(toolResultsInContent.length).toBe(1);
    expect(toolCallsInContent[0]).toMatchObject({
      type: "tool-call",
      toolCallId: "tool_search_abc123",
      toolName: "searchDocuments",
    });

    // Verify token usage is passed to startConversation
    expect(conversationData.tokenUsage).toEqual(expectedTokenUsage);
    
    // Verify cost is in the assistant message (not in conversationData)
    expect(assistantMessage.provisionalCostUsd).toBe(expectedCostUsd);
    expect(assistantMessage.tokenUsage).toEqual(expectedTokenUsage);

    // Verify cost verification was enqueued with both generation IDs
    expect(mockEnqueueCostVerificationIfNeeded).toHaveBeenCalledWith(
      "gen-1766755634-mSZupEMPTYHYviRp0kbj",
      [
        "gen-1766755634-mSZupEMPTYHYviRp0kbj",
        "gen-1766755635-GhZIxomllM8bIk1B2vXN",
      ],
      workspaceId,
      "reservation-123",
      "conversation-id-steps",
      agentId,
      "webhook"
    );
  });

  it("should calculate and pass token usage and costs to startConversation", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const key = "key-789";
    const bodyText = "Hello";

    mockValidateWebhookRequest.mockReturnValue({
      workspaceId,
      agentId,
      key,
      bodyText,
    });
    mockValidateWebhookKey.mockResolvedValue(undefined);
    mockCheckFreePlanExpiration.mockResolvedValue(undefined);

    const mockSubscription = {
      pk: "subscriptions/sub-123",
      plan: "pro" as const,
    };
    mockGetWorkspaceSubscription.mockResolvedValue(mockSubscription);
    mockCheckDailyRequestLimit.mockResolvedValue(undefined);

    mockSetupAgentAndTools.mockResolvedValue({
      agent: {
        pk: `agents/${workspaceId}/${agentId}`,
        name: "Test Agent",
        systemPrompt: "You are helpful",
        provider: "google" as const,
      },
      model: {},
      tools: {},
      usesByok: false,
    });

    mockConvertTextToUIMessage.mockReturnValue({
      role: "user",
      content: bodyText,
    });

    mockConvertUIMessagesToModelMessages.mockReturnValue([
      {
        role: "user",
        content: bodyText,
      },
    ]);

    mockValidateCreditsAndLimitsAndReserve.mockResolvedValue("reservation-123");

    mockBuildGenerateTextOptions.mockReturnValue({});

    vi.mocked(generateText).mockResolvedValue({
      text: "Hello!",
      usage: {
        promptTokens: 50,
        completionTokens: 25,
      },
    } as unknown as Awaited<ReturnType<typeof generateText>>);

    const expectedTokenUsage = {
      promptTokens: 50,
      completionTokens: 25,
      totalTokens: 75,
    };
    const expectedCostUsd = 5000; // 0.005 USD in millionths

    mockExtractTokenUsageAndCosts.mockReturnValue({
      tokenUsage: expectedTokenUsage,
      openrouterGenerationId: "gen-123",
      openrouterGenerationIds: ["gen-123"],
      provisionalCostUsd: expectedCostUsd,
    });

    mockIsCreditDeductionEnabled.mockReturnValue(true);
    mockAdjustCreditsAfterLLMCall.mockResolvedValue(undefined);
    mockEnqueueCostVerificationIfNeeded.mockResolvedValue(undefined);
    mockStartConversation.mockResolvedValue("conversation-id-789");
    mockProcessSimpleNonStreamingResponse.mockResolvedValue("Hello!");

    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const baseEvent = createAPIGatewayEventV2({
      routeKey: "POST /api/webhook/workspace-123/agent-456/key-789",
      rawPath: "/api/webhook/workspace-123/agent-456/key-789",
      body: bodyText,
    });
    const event = {
      ...baseEvent,
      requestContext: {
        ...baseEvent.requestContext,
        http: {
          ...baseEvent.requestContext.http,
          method: "POST",
        },
      },
      pathParameters: {
        workspaceId,
        agentId,
        key,
      },
    };

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(result.statusCode).toBe(200);

    // Verify extractTokenUsageAndCosts was called
    expect(mockExtractTokenUsageAndCosts).toHaveBeenCalled();

    // Verify adjustCreditsAfterLLMCall was called with correct parameters
    expect(mockAdjustCreditsAfterLLMCall).toHaveBeenCalledWith(
      mockDb,
      workspaceId,
      agentId,
      "reservation-123",
      "openrouter",
      "gemini-2.5-flash",
      expectedTokenUsage,
      false,
      "gen-123",
      ["gen-123"],
      "webhook",
      expect.objectContaining({
        addWorkspaceCreditTransaction: expect.any(Function),
      })
    );

    // Verify startConversation was called with token usage
    expect(mockStartConversation).toHaveBeenCalled();
    const startConversationCalls = mockStartConversation.mock.calls;
    const conversationData = startConversationCalls[0][1];

    expect(conversationData.tokenUsage).toEqual(expectedTokenUsage);

    // Verify assistant message has tokenUsage and provisionalCostUsd
    const messages = conversationData.messages;
    const assistantMessage = messages.find(
      (msg: { role: string }) => msg.role === "assistant"
    );
    expect(assistantMessage.tokenUsage).toEqual(expectedTokenUsage);
    expect(assistantMessage.provisionalCostUsd).toBe(expectedCostUsd);

    // Verify cost verification was enqueued
    expect(mockEnqueueCostVerificationIfNeeded).toHaveBeenCalledWith(
      "gen-123",
      ["gen-123"],
      workspaceId,
      "reservation-123",
      "conversation-id-789",
      agentId,
      "webhook"
    );
  });
});
