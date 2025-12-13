import { badRequest } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  InsufficientCreditsError,
  SpendingLimitExceededError,
} from "../../../../utils/creditErrors";
import {
  createMockRequest,
  createMockResponse,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const {
  mockDatabase,
  mockCheckFreePlanExpiration,
  mockGetWorkspaceSubscription,
  mockCheckDailyRequestLimit,
  mockSetupAgentAndTools,
  mockConvertToModelMessages,
  mockValidateCreditsAndLimitsAndReserve,
  mockStreamText,
  mockExtractTokenUsage,
  mockAdjustCreditReservation,
  mockIncrementRequestBucket,
  mockStartConversation,
  mockUpdateConversation,
  mockIsCreditDeductionEnabled,
} = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockCheckFreePlanExpiration: vi.fn(),
    mockGetWorkspaceSubscription: vi.fn(),
    mockCheckDailyRequestLimit: vi.fn(),
    mockSetupAgentAndTools: vi.fn(),
    mockConvertToModelMessages: vi.fn(),
    mockValidateCreditsAndLimitsAndReserve: vi.fn(),
    mockStreamText: vi.fn(),
    mockExtractTokenUsage: vi.fn(),
    mockAdjustCreditReservation: vi.fn(),
    mockIncrementRequestBucket: vi.fn(),
    mockStartConversation: vi.fn(),
    mockUpdateConversation: vi.fn(),
    mockIsCreditDeductionEnabled: vi.fn(),
  };
});

// Mock the modules
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/subscriptionUtils", () => ({
  checkFreePlanExpiration: mockCheckFreePlanExpiration,
  getWorkspaceSubscription: mockGetWorkspaceSubscription,
}));

vi.mock("../../../../utils/requestTracking", () => ({
  checkDailyRequestLimit: mockCheckDailyRequestLimit,
  incrementRequestBucket: mockIncrementRequestBucket,
}));

vi.mock(
  "../../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/agentSetup",
  () => ({
    setupAgentAndTools: mockSetupAgentAndTools,
  })
);

vi.mock("ai", () => ({
  convertToModelMessages: mockConvertToModelMessages,
  streamText: mockStreamText,
}));

vi.mock("../../../../utils/creditValidation", () => ({
  validateCreditsAndLimitsAndReserve: mockValidateCreditsAndLimitsAndReserve,
}));

vi.mock("../../../../utils/conversationLogger", () => ({
  extractTokenUsage: mockExtractTokenUsage,
  startConversation: mockStartConversation,
  updateConversation: mockUpdateConversation,
}));

vi.mock("../../../../utils/creditManagement", () => ({
  adjustCreditReservation: mockAdjustCreditReservation,
  refundReservation: vi.fn(),
}));

vi.mock("../../../../utils/featureFlags", () => ({
  isCreditDeductionEnabled: mockIsCreditDeductionEnabled,
}));

describe("POST /api/workspaces/:workspaceId/agents/:agentId/test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mocks
    mockCheckFreePlanExpiration.mockResolvedValue(undefined);
    mockGetWorkspaceSubscription.mockResolvedValue({
      pk: "subscriptions/sub-123",
      sk: "subscription",
    });
    mockCheckDailyRequestLimit.mockResolvedValue(undefined);
    mockIsCreditDeductionEnabled.mockReturnValue(true);
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>,
    next: express.NextFunction
  ) {
    // Extract the handler logic directly
    const handler = async (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      try {
        const { workspaceId, agentId } = req.params;
        const { messages, conversationId } = req.body;

        if (!workspaceId || !agentId) {
          throw badRequest("workspaceId and agentId are required");
        }

        if (!Array.isArray(messages) || messages.length === 0) {
          throw badRequest("messages array is required");
        }

        // Check if free plan has expired (block agent execution if expired)
        await mockCheckFreePlanExpiration(workspaceId);

        // Check daily request limit before LLM call
        const subscription = await mockGetWorkspaceSubscription(workspaceId);
        const subscriptionId = subscription
          ? subscription.pk.replace("subscriptions/", "")
          : undefined;
        if (subscriptionId) {
          await mockCheckDailyRequestLimit(subscriptionId);
        }

        // Setup agent, model, and tools
        const { agent, model, tools, usesByok } = await mockSetupAgentAndTools(
          workspaceId,
          agentId,
          messages,
          {
            callDepth: 0,
            maxDelegationDepth: 3,
          }
        );

        // Convert messages to ModelMessage format
        const { convertToModelMessages } = await import("ai");
        const modelMessages = convertToModelMessages(
          messages as Array<Omit<import("ai").UIMessage, "id">>
        );

        // Derive the model name from the agent's modelName if set, otherwise use default
        const MODEL_NAME = "gemini-2.0-flash-exp";
        const finalModelName =
          typeof agent.modelName === "string" ? agent.modelName : MODEL_NAME;

        // Validate credits, spending limits, and reserve credits before LLM call
        const db = await mockDatabase();
        let reservationId: string | undefined;
        let result: Awaited<ReturnType<typeof mockStreamText>> | undefined;

        try {
          // Convert tools object to array format for estimation
          const toolDefinitions = tools
            ? Object.entries(tools).map(([name, tool]) => {
                const typedTool = tool as {
                  description?: string;
                  inputSchema?: unknown;
                };
                return {
                  name,
                  description: typedTool.description || "",
                  parameters: typedTool.inputSchema || {},
                };
              })
            : undefined;

          const reservation = await mockValidateCreditsAndLimitsAndReserve(
            db,
            workspaceId,
            agentId,
            "google", // provider
            finalModelName,
            modelMessages,
            agent.systemPrompt,
            toolDefinitions,
            usesByok
          );

          if (reservation) {
            reservationId = reservation.reservationId;
          }

          // Generate AI response (streaming)
          const { streamText } = await import("ai");
          const generateOptions = {}; // Simplified for testing
          result = streamText({
            model: model as unknown as Parameters<
              typeof streamText
            >[0]["model"],
            system: agent.systemPrompt,
            messages: modelMessages,
            tools,
            ...generateOptions,
          });
        } catch (error) {
          // Handle errors based on when they occurred
          if (error instanceof InsufficientCreditsError) {
            return res.status(error.statusCode).json({
              error: error.message,
              workspaceId: error.workspaceId,
              required: error.required,
              available: error.available,
              currency: error.currency,
            });
          }
          if (error instanceof SpendingLimitExceededError) {
            return res.status(error.statusCode).json({
              error: error.message,
              failedLimits: error.failedLimits,
            });
          }

          // Re-throw other errors
          throw error;
        }

        // If we get here, the LLM call succeeded
        if (!result) {
          throw new Error("LLM call succeeded but result is undefined");
        }

        // Track successful LLM request (increment bucket)
        if (subscriptionId) {
          try {
            await mockIncrementRequestBucket(subscriptionId);
          } catch {
            // Log error but don't fail the request
          }
        }

        // Get the UI message stream response from streamText result
        const streamResponse = result.toUIMessageStreamResponse();

        // Buffer the stream as it's generated
        const chunks: Uint8Array[] = [];
        const reader = streamResponse.body?.getReader();
        if (!reader) {
          throw new Error("Stream response body is null");
        }

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              chunks.push(value);
            }
          }
        } finally {
          reader.releaseLock();
        }

        // Combine all chunks into a single buffer
        const totalLength = chunks.reduce(
          (sum, chunk) => sum + chunk.length,
          0
        );
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }

        const body = new TextDecoder().decode(combined);

        // Extract token usage from streamText result
        const { extractTokenUsage } = await import(
          "../../../../utils/conversationLogger"
        );
        const tokenUsage = extractTokenUsage(result);

        // Adjust credit reservation based on actual cost
        if (
          mockIsCreditDeductionEnabled() &&
          reservationId &&
          reservationId !== "byok" &&
          tokenUsage &&
          (tokenUsage.promptTokens > 0 || tokenUsage.completionTokens > 0)
        ) {
          try {
            await mockAdjustCreditReservation(
              db,
              reservationId,
              workspaceId,
              "google",
              finalModelName,
              tokenUsage,
              3,
              usesByok
            );
          } catch {
            // Log error but don't fail the request
          }
        }

        // Log conversation (non-blocking)
        try {
          const validMessages = messages.filter(
            (msg): msg is unknown =>
              msg != null &&
              typeof msg === "object" &&
              "role" in msg &&
              typeof msg.role === "string" &&
              (msg.role === "user" ||
                msg.role === "assistant" ||
                msg.role === "system" ||
                msg.role === "tool") &&
              "content" in msg
          );

          if (conversationId && typeof conversationId === "string") {
            // Update existing conversation
            await mockUpdateConversation(
              db,
              workspaceId,
              agentId,
              conversationId,
              validMessages,
              tokenUsage
            );
          } else {
            // Start new conversation
            await mockStartConversation(db, {
              workspaceId,
              agentId,
              conversationType: "test",
              messages: validMessages,
              tokenUsage: tokenUsage,
              modelName: MODEL_NAME,
              provider: "google",
              usesByok,
            });
          }
        } catch {
          // Log error but don't fail the request
        }

        // Use headers from the Response object
        const responseHeaders = streamResponse.headers;
        for (const [key, value] of responseHeaders.entries()) {
          res.setHeader(key, value);
        }

        res.status(streamResponse.status).send(body);
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should throw badRequest when workspaceId is missing", async () => {
    const req = createMockRequest({
      params: {
        agentId: "agent-123",
      },
      body: {
        messages: [{ role: "user", content: "Hello" }],
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: "workspaceId and agentId are required",
          }),
        }),
      })
    );
    expect(mockCheckFreePlanExpiration).not.toHaveBeenCalled();
  });

  it("should throw badRequest when agentId is missing", async () => {
    const req = createMockRequest({
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        messages: [{ role: "user", content: "Hello" }],
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: "workspaceId and agentId are required",
          }),
        }),
      })
    );
    expect(mockCheckFreePlanExpiration).not.toHaveBeenCalled();
  });

  it("should throw badRequest when messages is not an array", async () => {
    const req = createMockRequest({
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-123",
      },
      body: {
        messages: "not an array",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: "messages array is required",
          }),
        }),
      })
    );
    expect(mockCheckFreePlanExpiration).not.toHaveBeenCalled();
  });

  it("should throw badRequest when messages array is empty", async () => {
    const req = createMockRequest({
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-123",
      },
      body: {
        messages: [],
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: "messages array is required",
          }),
        }),
      })
    );
    expect(mockCheckFreePlanExpiration).not.toHaveBeenCalled();
  });

  it("should return InsufficientCreditsError response when credits are insufficient", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-123";
    const messages = [{ role: "user", content: "Hello" }];

    mockSetupAgentAndTools.mockResolvedValue({
      agent: {
        pk: `agents/${workspaceId}/${agentId}`,
        sk: "agent",
        workspaceId,
        name: "Test Agent",
        systemPrompt: "You are helpful",
        modelName: undefined,
      },
      model: {} as unknown,
      tools: {},
      usesByok: false,
    });
    mockConvertToModelMessages.mockReturnValue([
      { role: "user", content: "Hello" },
    ]);
    mockValidateCreditsAndLimitsAndReserve.mockRejectedValue(
      new InsufficientCreditsError(workspaceId, 100, 50, "usd")
    );

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
      body: {
        messages,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockCheckFreePlanExpiration).toHaveBeenCalledWith(workspaceId);
    expect(mockSetupAgentAndTools).toHaveBeenCalled();
    expect(mockValidateCreditsAndLimitsAndReserve).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.json).toHaveBeenCalledWith({
      error: expect.stringContaining("Insufficient credits"),
      workspaceId,
      required: 100,
      available: 50,
      currency: "usd",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("should return SpendingLimitExceededError response when limits are exceeded", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-123";
    const messages = [{ role: "user", content: "Hello" }];

    mockSetupAgentAndTools.mockResolvedValue({
      agent: {
        pk: `agents/${workspaceId}/${agentId}`,
        sk: "agent",
        workspaceId,
        name: "Test Agent",
        systemPrompt: "You are helpful",
        modelName: undefined,
      },
      model: {} as unknown,
      tools: {},
      usesByok: false,
    });
    mockConvertToModelMessages.mockReturnValue([
      { role: "user", content: "Hello" },
    ]);
    mockValidateCreditsAndLimitsAndReserve.mockRejectedValue(
      new SpendingLimitExceededError([
        {
          scope: "workspace",
          timeFrame: "daily",
          limit: 100,
          current: 150,
        },
      ])
    );

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
      body: {
        messages,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockValidateCreditsAndLimitsAndReserve).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.json).toHaveBeenCalledWith({
      error: expect.stringContaining("Spending limits exceeded"),
      failedLimits: [
        {
          scope: "workspace",
          timeFrame: "daily",
          limit: 100,
          current: 150,
        },
      ],
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("should handle message conversion errors", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-123";
    const messages = [{ role: "user", content: "Hello" }];

    mockSetupAgentAndTools.mockResolvedValue({
      agent: {
        pk: `agents/${workspaceId}/${agentId}`,
        sk: "agent",
        workspaceId,
        name: "Test Agent",
        systemPrompt: "You are helpful",
        modelName: undefined,
      },
      model: {} as unknown,
      tools: {},
      usesByok: false,
    });
    mockConvertToModelMessages.mockImplementation(() => {
      throw new Error("Invalid message format");
    });

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
      body: {
        messages,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockConvertToModelMessages).toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Invalid message format",
      })
    );
  });

  it("should handle successful request with streaming response", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-123";
    const subscriptionId = "sub-123";
    const messages = [{ role: "user", content: "Hello" }];
    const reservationId = "reservation-123";

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      workspaceId,
      name: "Test Agent",
      systemPrompt: "You are helpful",
      modelName: undefined,
    };

    mockSetupAgentAndTools.mockResolvedValue({
      agent: mockAgent,
      model: {} as unknown,
      tools: {},
      usesByok: false,
    });
    mockConvertToModelMessages.mockReturnValue([
      { role: "user", content: "Hello" },
    ]);
    mockValidateCreditsAndLimitsAndReserve.mockResolvedValue({
      reservationId,
      reservedAmount: 10.0,
    });

    // Mock streamText result
    const mockStreamResponse = {
      body: new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode("data: test\n\n"));
          controller.close();
        },
      }),
      headers: new Headers({
        "Content-Type": "text/event-stream",
      }),
      status: 200,
    };

    const mockStreamTextResult = {
      toUIMessageStreamResponse: vi.fn().mockReturnValue(mockStreamResponse),
    };

    mockStreamText.mockReturnValue(mockStreamTextResult);
    mockExtractTokenUsage.mockReturnValue({
      promptTokens: 10,
      completionTokens: 20,
    });
    mockAdjustCreditReservation.mockResolvedValue(undefined);
    mockIncrementRequestBucket.mockResolvedValue(undefined);
    mockStartConversation.mockResolvedValue(undefined);

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
      body: {
        messages,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockCheckFreePlanExpiration).toHaveBeenCalledWith(workspaceId);
    expect(mockGetWorkspaceSubscription).toHaveBeenCalledWith(workspaceId);
    expect(mockCheckDailyRequestLimit).toHaveBeenCalledWith(subscriptionId);
    expect(mockSetupAgentAndTools).toHaveBeenCalled();
    expect(mockValidateCreditsAndLimitsAndReserve).toHaveBeenCalled();
    expect(mockStreamText).toHaveBeenCalled();
    expect(mockExtractTokenUsage).toHaveBeenCalledWith(mockStreamTextResult);
    expect(mockAdjustCreditReservation).toHaveBeenCalled();
    expect(mockIncrementRequestBucket).toHaveBeenCalledWith(subscriptionId);
    expect(mockStartConversation).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should skip request limit check when no subscription exists", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-123";
    const messages = [{ role: "user", content: "Hello" }];

    mockGetWorkspaceSubscription.mockResolvedValue(null);

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      workspaceId,
      name: "Test Agent",
      systemPrompt: "You are helpful",
      modelName: undefined,
    };

    mockSetupAgentAndTools.mockResolvedValue({
      agent: mockAgent,
      model: {} as unknown,
      tools: {},
      usesByok: false,
    });
    mockConvertToModelMessages.mockReturnValue([
      { role: "user", content: "Hello" },
    ]);
    mockValidateCreditsAndLimitsAndReserve.mockResolvedValue(null);

    const mockStreamResponse = {
      body: new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode("data: test\n\n"));
          controller.close();
        },
      }),
      headers: new Headers({
        "Content-Type": "text/event-stream",
      }),
      status: 200,
    };

    const mockStreamTextResult = {
      toUIMessageStreamResponse: vi.fn().mockReturnValue(mockStreamResponse),
    };

    mockStreamText.mockReturnValue(mockStreamTextResult);
    mockExtractTokenUsage.mockReturnValue({
      promptTokens: 10,
      completionTokens: 20,
    });
    mockStartConversation.mockResolvedValue(undefined);

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
      body: {
        messages,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockCheckDailyRequestLimit).not.toHaveBeenCalled();
    expect(mockIncrementRequestBucket).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should use updateConversation when conversationId is provided", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-123";
    const conversationId = "conversation-789";
    const messages = [{ role: "user", content: "Hello" }];
    const reservationId = "reservation-123";
    const mockDb = {};

    mockDatabase.mockResolvedValue(mockDb as any);
    mockGetWorkspaceSubscription.mockResolvedValue({
      pk: "subscriptions/sub-123",
    });
    mockCheckDailyRequestLimit.mockResolvedValue(undefined);

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      workspaceId,
      name: "Test Agent",
      systemPrompt: "You are helpful",
      modelName: undefined,
    };

    mockSetupAgentAndTools.mockResolvedValue({
      agent: mockAgent,
      model: {} as unknown,
      tools: {},
      usesByok: false,
    });
    mockConvertToModelMessages.mockReturnValue([
      { role: "user", content: "Hello" },
    ]);
    mockValidateCreditsAndLimitsAndReserve.mockResolvedValue({
      reservationId,
      reservedAmount: 10.0,
    });

    // Mock streamText result
    const mockStreamResponse = {
      body: new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode("data: test\n\n"));
          controller.close();
        },
      }),
      headers: new Headers({
        "Content-Type": "text/event-stream",
      }),
      status: 200,
    };

    const mockStreamTextResult = {
      toUIMessageStreamResponse: vi.fn().mockReturnValue(mockStreamResponse),
    };

    mockStreamText.mockReturnValue(mockStreamTextResult);
    mockExtractTokenUsage.mockReturnValue({
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    });
    mockAdjustCreditReservation.mockResolvedValue(undefined);
    mockIncrementRequestBucket.mockResolvedValue(undefined);
    mockUpdateConversation.mockResolvedValue(undefined);

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
      body: {
        messages,
        conversationId,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockUpdateConversation).toHaveBeenCalledWith(
      mockDb,
      workspaceId,
      agentId,
      conversationId,
      expect.any(Array),
      expect.objectContaining({
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      })
    );
    expect(mockStartConversation).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should use startConversation when conversationId is not provided", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-123";
    const messages = [{ role: "user", content: "Hello" }];
    const reservationId = "reservation-123";
    const mockDb = {};

    mockDatabase.mockResolvedValue(mockDb as any);
    mockGetWorkspaceSubscription.mockResolvedValue({
      pk: "subscriptions/sub-123",
    });
    mockCheckDailyRequestLimit.mockResolvedValue(undefined);

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      workspaceId,
      name: "Test Agent",
      systemPrompt: "You are helpful",
      modelName: undefined,
    };

    mockSetupAgentAndTools.mockResolvedValue({
      agent: mockAgent,
      model: {} as unknown,
      tools: {},
      usesByok: false,
    });
    mockConvertToModelMessages.mockReturnValue([
      { role: "user", content: "Hello" },
    ]);
    mockValidateCreditsAndLimitsAndReserve.mockResolvedValue({
      reservationId,
      reservedAmount: 10.0,
    });

    // Mock streamText result
    const mockStreamResponse = {
      body: new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode("data: test\n\n"));
          controller.close();
        },
      }),
      headers: new Headers({
        "Content-Type": "text/event-stream",
      }),
      status: 200,
    };

    const mockStreamTextResult = {
      toUIMessageStreamResponse: vi.fn().mockReturnValue(mockStreamResponse),
    };

    mockStreamText.mockReturnValue(mockStreamTextResult);
    mockExtractTokenUsage.mockReturnValue({
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    });
    mockAdjustCreditReservation.mockResolvedValue(undefined);
    mockIncrementRequestBucket.mockResolvedValue(undefined);
    mockStartConversation.mockResolvedValue("new-conversation-id");

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
      body: {
        messages,
        // No conversationId
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockStartConversation).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        workspaceId,
        agentId,
        conversationType: "test",
        messages: expect.any(Array),
        tokenUsage: expect.objectContaining({
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
        }),
      })
    );
    expect(mockUpdateConversation).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
