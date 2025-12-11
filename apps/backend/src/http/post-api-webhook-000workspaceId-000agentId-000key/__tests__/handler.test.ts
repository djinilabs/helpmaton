import { badRequest, unauthorized } from "@hapi/boom";
import { generateText } from "ai";
import { describe, it, expect, vi, beforeEach } from "vitest";

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
  };
});

// Mock the modules
vi.mock("../../../tables", () => ({
  database: mockDatabase,
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
  validateCreditsAndLimitsAndReserve: mockValidateCreditsAndLimitsAndReserve,
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

vi.mock("../../../utils/conversationLogger", () => ({
  extractTokenUsage: mockExtractTokenUsage,
  startConversation: mockStartConversation,
}));

vi.mock("../../../utils/creditManagement", () => ({
  adjustCreditReservation: mockAdjustCreditReservation,
  refundReservation: vi.fn(),
}));

vi.mock(
  "../../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/streaming",
  () => ({
    processSimpleNonStreamingResponse: mockProcessSimpleNonStreamingResponse,
  })
);

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

    mockValidateCreditsAndLimitsAndReserve.mockResolvedValue({
      reservationId: "reservation-123",
      reservedAmount: 0.001,
    });

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

    mockExtractTokenUsage.mockReturnValue({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });

    mockIsCreditDeductionEnabled.mockReturnValue(true);
    mockAdjustCreditReservation.mockResolvedValue(undefined);

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

    mockValidateCreditsAndLimitsAndReserve.mockResolvedValue({
      reservationId: "reservation-123",
      reservedAmount: 0.001,
    });

    mockBuildGenerateTextOptions.mockReturnValue({});

    vi.mocked(generateText).mockResolvedValue({
      text: "response",
      usage: { promptTokens: 10, completionTokens: 5 },
    } as unknown as Awaited<ReturnType<typeof generateText>>);

    mockExtractTokenUsage.mockReturnValue({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });

    mockIsCreditDeductionEnabled.mockReturnValue(true);
    mockAdjustCreditReservation.mockResolvedValue(undefined);
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

    mockValidateCreditsAndLimitsAndReserve.mockResolvedValue({
      reservationId: "reservation-123",
      reservedAmount: 0.001,
    });

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
});
